// Arranca la app real (src/server/index.js) como proceso hijo para las pruebas E2E y de carga.
// No modifica nada de src: solo le pasa variables de entorno.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { appendEvidence, writeEvidence } from './evidence-files.mjs';

const LOOPBACK_HOST = '127.0.0.1';
const START_TIMEOUT_MS = 15000;
const START_ATTEMPTS = 10;
const RETRY_DELAY_MS = 500;
const INSPECTOR_URL_PATTERN = /Debugger listening on (ws:\/\/\S+)/;

export async function findFreePort() {
  const probe = createServer();
  probe.listen(0, LOOPBACK_HOST);
  await once(probe, 'listening');
  const { port } = probe.address();
  probe.close();
  await once(probe, 'close');
  return port;
}

function parseLogLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return { level: 'raw', event: 'stdout.raw', text: line };
  }
}

// Variables que la prueba controla: no se heredan del entorno de quien la ejecuta.
const CONTROLLED_VARIABLES = ['TLS_CERT_FILE', 'TLS_KEY_FILE', 'TRUSTED_PROXY_HEADER'];

function buildEnvironment({ rootDirectory, port, useTls }) {
  const inherited = Object.entries(process.env).filter(([name]) => !CONTROLLED_VARIABLES.includes(name));
  const environment = {
    ...Object.fromEntries(inherited),
    PORT: String(port),
    HOST: LOOPBACK_HOST,
    // Sin STUN externo: la prueba no depende de Internet y los candidatos son locales.
    STUN_URLS: '',
  };
  if (useTls) {
    environment.TLS_CERT_FILE = join(rootDirectory, 'certs', 'dev-cert.pem');
    environment.TLS_KEY_FILE = join(rootDirectory, 'certs', 'dev-key.pem');
  }
  return environment;
}

export class AppProcess {
  #rootDirectory;
  #environment;
  #logFile;
  #port;
  #child = null;
  #logEntries = [];
  #stderr = '';
  #startCount = 0;
  #nodeArguments;
  inspectorUrl = null;

  constructor({ rootDirectory, port, logFile, useTls = true, nodeArguments = [] }) {
    this.#rootDirectory = rootDirectory;
    this.#nodeArguments = nodeArguments;
    this.#port = port;
    this.#logFile = logFile;
    this.#environment = buildEnvironment({ rootDirectory, port, useTls });
    writeEvidence(logFile, '');
  }

  get pid() {
    return this.#child?.pid ?? null;
  }

  get port() {
    return this.#port;
  }

  get logEntries() {
    return [...this.#logEntries];
  }

  errorLogEntries() {
    return this.#logEntries.filter((entry) => entry.level === 'error');
  }

  // Reintenta si el puerto sigue ocupado justo despues de matar el proceso anterior.
  async start() {
    for (let attempt = 1; attempt <= START_ATTEMPTS; attempt += 1) {
      try {
        await this.#spawnOnce();
        return;
      } catch (error) {
        if (!this.#stderr.includes('EADDRINUSE') || attempt === START_ATTEMPTS) {
          throw error;
        }
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  // Termina el proceso de golpe, como una caida real del servidor.
  async kill() {
    const child = this.#child;
    if (!child || child.exitCode !== null) {
      this.#child = null;
      return;
    }
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    this.#child = null;
    this.#record({ level: 'harness', event: 'harness.process.killed' });
  }

  #spawnOnce() {
    this.#stderr = '';
    const child = spawn(process.execPath, [...this.#nodeArguments, 'src/server/index.js'], {
      cwd: this.#rootDirectory,
      env: this.#environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.#child = child;
    this.#pipeOutput(child);
    return this.#waitUntilStarted(child);
  }

  #pipeOutput(child) {
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop();
      lines.filter((line) => line.trim()).forEach((line) => this.#record(parseLogLine(line)));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      this.#stderr += chunk;
      this.inspectorUrl ??= INSPECTOR_URL_PATTERN.exec(this.#stderr)?.[1] ?? null;
      this.#record({ level: 'stderr', event: 'stderr', text: chunk.trim() });
    });
  }

  #record(entry) {
    if (entry.event === 'server.started') {
      this.#startCount += 1;
    }
    this.#logEntries.push(entry);
    appendEvidence(this.#logFile, `${JSON.stringify(entry)}\n`);
  }

  #waitUntilStarted(child) {
    const startsBefore = this.#startCount;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('La app no arranco a tiempo')), START_TIMEOUT_MS);
      const onData = () => {
        if (this.#startCount > startsBefore) {
          clearTimeout(timer);
          child.stdout.off('data', onData);
          resolve();
        }
      };
      child.stdout.on('data', onData);
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`La app termino al arrancar (codigo ${code}): ${this.#stderr.trim()}`));
      });
    });
  }
}
