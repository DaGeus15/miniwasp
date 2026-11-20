import { spawnSync } from 'node:child_process';

const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

// Sin shell: los argumentos llegan intactos aunque la ruta del proyecto tenga espacios.
// El limite de tiempo evita que una herramienta colgada deje el escaneo esperando para siempre.
export function runCommand(command, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message ?? null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    durationMs: Date.now() - startedAt,
  };
}

export function lastLines(text, count = 15) {
  return String(text).trim().split(/\r?\n/).slice(-count).join('\n');
}
