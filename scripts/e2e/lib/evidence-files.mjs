// Unico punto que escribe archivos de evidencia. Rechaza cualquier ruta fuera de
// docs/evidence, asi un nombre mal formado nunca puede escribir en otro lugar del disco.
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const EVIDENCE_ROOT = resolve(import.meta.dirname, '..', '..', '..', 'docs', 'evidence');

function insideEvidence(path) {
  const fullPath = resolve(path);
  if (!fullPath.startsWith(`${EVIDENCE_ROOT}${sep}`)) {
    throw new Error(`Ruta de evidencia fuera de docs/evidence: ${fullPath}`);
  }
  return fullPath;
}

export function writeEvidence(path, text) {
  const target = insideEvidence(path);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- insideEvidence limita la ruta a docs/evidence
  writeFileSync(target, text);
}

export function appendEvidence(path, text) {
  const target = insideEvidence(path);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- insideEvidence limita la ruta a docs/evidence
  appendFileSync(target, text);
}
