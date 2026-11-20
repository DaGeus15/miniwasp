import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g;

async function compose(projectRoot, args) {
  const { stdout, stderr } = await run('docker', ['compose', '--profile', 'tunnel', ...args], { cwd: projectRoot });
  return `${stdout}\n${stderr}`;
}

// Devuelve la URL publica solo si el contenedor del tunel esta corriendo ahora mismo.
export async function findRunningTunnelUrl(projectRoot) {
  const running = await compose(projectRoot, ['ps', '--status', 'running', '--services']);
  if (!running.split(/\s+/).includes('tunnel')) {
    return null;
  }
  const matches = (await compose(projectRoot, ['logs', 'tunnel'])).match(TUNNEL_URL_PATTERN);
  return matches?.at(-1) ?? null;
}
