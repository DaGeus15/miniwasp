import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const HEALTH_TIMEOUT_MS = 20000;
const HEALTH_POLL_MS = 250;
const STOP_TIMEOUT_MS = 5000;
const ALL_INTERFACES = '0.0.0.0';

export async function findFreePort() {
  const probe = createServer();
  probe.listen(0, ALL_INTERFACES);
  await once(probe, 'listening');
  const { port } = probe.address();
  probe.close();
  await once(probe, 'close');
  return port;
}

// Variables heredadas que cambiarian el comportamiento de la app durante el escaneo.
const IGNORED_VARIABLES = new Set(['TRUSTED_PROXY_HEADER', 'TRUST_CLOUDFLARE', 'STUN_URLS']);

// El entorno se arma explicitamente: no se lee .env. HOST=0.0.0.0 es necesario porque ZAP
// llega desde el contenedor por host.docker.internal.
function buildAppEnvironment({ port, certFile, keyFile }) {
  const inherited = Object.entries(process.env).filter(([name]) => !IGNORED_VARIABLES.has(name));
  return {
    ...Object.fromEntries(inherited),
    PORT: String(port),
    HOST: ALL_INTERFACES,
    TLS_CERT_FILE: certFile,
    TLS_KEY_FILE: keyFile,
  };
}

// Devuelve el proceso y una funcion que entrega todo lo que la app escribio en consola.
export function startApp({ projectRoot, ...settings }) {
  const output = [];
  const child = spawn(process.execPath, ['src/server/index.js'], {
    cwd: projectRoot,
    env: buildAppEnvironment(settings),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => output.push(chunk));
  child.stderr.on('data', (chunk) => output.push(chunk));
  return { child, readLog: () => Buffer.concat(output).toString('utf8') };
}

async function isHealthy(client) {
  try {
    const { status } = await client('/healthz');
    return status === 200;
  } catch {
    return false;
  }
}

export async function waitForHealth(child, client) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`La app termino al arrancar (codigo ${child.exitCode}); revisa el log`);
    }
    if (await isHealthy(client)) {
      return;
    }
    await delay(HEALTH_POLL_MS);
  }
  throw new Error('La app no respondio /healthz a tiempo');
}

export async function stopApp(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([exited, delay(STOP_TIMEOUT_MS)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}
