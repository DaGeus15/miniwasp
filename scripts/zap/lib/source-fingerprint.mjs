import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readText } from '../../security/lib/trusted-files.mjs';

// La app lee los archivos del cliente en cada peticion: si alguien edita src durante el
// escaneo, ZAP compara respuestas distintas y produce alertas falsas (User Agent Fuzzer,
// Cookie Slack Detector). La huella permite detectar ese caso e invalidar la corrida.
export function fingerprintSources(appRoot) {
  const sourceDirectory = join(appRoot, 'src');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- carpeta src fija de la app escaneada
  const files = readdirSync(sourceDirectory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(sourceDirectory, file)).update('\0').update(readText(file)).update('\0');
  }
  return hash.digest('hex');
}
