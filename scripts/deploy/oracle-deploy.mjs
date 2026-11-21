// Redespliegue en un paso: `npm run deploy`.
// Empaqueta lo que necesita la imagen (Dockerfile, .dockerignore, package*.json y src/), lo sube por
// SSH al servidor de Oracle, ejecuta ~/miniwasp/deploy.sh (recompila la imagen y recrea la app y el
// tunel de Cloudflare) y comprueba que la URL publica responde en /healthz.
// Requisitos: ORACLE_SSH_KEY (ruta de la clave privada) y ORACLE_SSH_TARGET (usuario@host), por
// ejemplo en el .env local, que npm run deploy carga si existe. Nada de esto va al repositorio.
import { spawn } from 'node:child_process';

const PUBLIC_URL = 'https://miniwasp.dayle.dev';
const FILES = ['Dockerfile', '.dockerignore', 'package.json', 'package-lock.json', 'src'];
// src/ se reemplaza entero: un archivo borrado del repositorio no debe quedar vivo en el servidor.
const REMOTE_COMMAND = 'cd ~/miniwasp && rm -rf src && tar xzf - && ./deploy.sh';
const TARGET_PATTERN = /^[\w.-]+@[\w.-]+$/;
const HEALTH_ATTEMPTS = 30;
const HEALTH_DELAY_MS = 5000;
const TAR_COMMAND = 'tar';
const SSH_COMMAND = 'ssh';

function readTarget() {
  const { ORACLE_SSH_KEY: key, ORACLE_SSH_TARGET: target } = process.env;
  if (!key || !TARGET_PATTERN.test(target ?? '')) {
    throw new Error('Define ORACLE_SSH_KEY (ruta de la clave) y ORACLE_SSH_TARGET (usuario@host)');
  }
  return { key, target };
}

// Sin shell: cada argumento va por separado, asi que ninguna variable puede inyectar comandos.
function start(command, args, stdio) {
  return spawn(command, args, { stdio, windowsHide: true });
}

function uploadAndDeploy({ key, target }) {
  return new Promise((resolve, reject) => {
    const archive = start(TAR_COMMAND, ['czf', '-', ...FILES], ['ignore', 'pipe', 'inherit']);
    const remote = start(SSH_COMMAND, ['-o', 'BatchMode=yes', '-i', key, target, REMOTE_COMMAND], ['pipe', 'inherit', 'inherit']);
    archive.stdout.pipe(remote.stdin);
    archive.on('error', reject);
    remote.on('error', reject);
    remote.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`El despliegue remoto termino con codigo ${code}`));
      }
    });
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealthy() {
  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${PUBLIC_URL}/healthz`, { cache: 'no-store' });
      if (response.ok) {
        return;
      }
    } catch {
      // El tunel puede tardar unos segundos en volver a conectar con la app nueva.
    }
    await wait(HEALTH_DELAY_MS);
  }
  throw new Error(`${PUBLIC_URL}/healthz no respondio a tiempo`);
}

await uploadAndDeploy(readTarget());
await waitForHealthy();
console.log(`Desplegado y sano: ${PUBLIC_URL}`);
