// Describe la maquina donde se tomo la evidencia, para que el resultado sea reproducible.
import os from 'node:os';

const BYTES_PER_GIB = 1024 ** 3;

export function describeEnvironment(extra = {}) {
  const cpus = os.cpus();
  return {
    os: `${os.type()} ${os.release()} (${os.platform()} ${os.arch()})`,
    osVersion: os.version(),
    cpuModel: cpus[0]?.model.trim() ?? 'desconocido',
    logicalCores: cpus.length,
    totalMemoryGiB: Number((os.totalmem() / BYTES_PER_GIB).toFixed(1)),
    nodeVersion: process.version,
    date: new Date().toISOString(),
    ...extra,
  };
}

export function environmentMarkdown(environment) {
  return Object.entries(environment)
    .map(([key, value]) => `| ${key} | ${value} |`)
    .join('\n');
}
