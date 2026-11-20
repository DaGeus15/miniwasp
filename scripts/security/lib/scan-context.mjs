import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ContainerPath, bindMount, tmpfsMount } from './docker.mjs';
import { ensureDirectory, isDirectory, pathExists, writeText } from './trusted-files.mjs';

const EVIDENCE_DIRECTORY = 'docs/evidence/security';
const SECRET_FILE = '.env';
const LOCAL_CERTS_DIRECTORY = 'certs';

// Defensa en profundidad: aunque una regla de exclusion falle, el contenedor ve un .env
// vacio y una carpeta certs vacia, asi ninguna imagen de terceros lee secretos reales.
function shadowMounts(rootDirectory, emptyFile) {
  const mounts = [];
  if (pathExists(join(rootDirectory, SECRET_FILE))) {
    mounts.push(bindMount(emptyFile, `${ContainerPath.SOURCE}/${SECRET_FILE}`));
  }
  if (isDirectory(join(rootDirectory, LOCAL_CERTS_DIRECTORY))) {
    mounts.push(tmpfsMount(`${ContainerPath.SOURCE}/${LOCAL_CERTS_DIRECTORY}`));
  }
  return mounts;
}

export function createScanContext(rootDirectory) {
  const root = resolve(rootDirectory);
  const outputDirectory = join(root, EVIDENCE_DIRECTORY);
  const workDirectory = mkdtempSync(join(tmpdir(), 'miniwasp-security-'));
  const emptyFile = join(workDirectory, 'empty.env');
  ensureDirectory(outputDirectory);
  writeText(emptyFile, '');

  return {
    root,
    outputDirectory,
    workDirectory,
    evidenceDirectory: EVIDENCE_DIRECTORY,
    sourceMounts: [bindMount(root, ContainerPath.SOURCE), ...shadowMounts(root, emptyFile)],
    outputMount: bindMount(outputDirectory, ContainerPath.OUTPUT, { readonly: false }),
    workMount: bindMount(workDirectory, ContainerPath.WORK),
  };
}

export function disposeScanContext(context) {
  rmSync(context.workDirectory, { recursive: true, force: true });
}
