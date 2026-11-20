import { rmSync } from 'node:fs';
import { join } from 'node:path';

const RUN_FILE_SUFFIXES = ['report.html', 'report.json', 'report.md', 'auth-check.json', 'meta.json', 'app.log'];
// ZAP deja este plan del Automation Framework en la carpeta montada.
const ZAP_LEFTOVERS = ['zap.yaml'];

function removeIfPresent(path) {
  rmSync(path, { force: true });
}

// Antes de cada corrida se borra la evidencia anterior de esa corrida: si ZAP falla, el
// veredicto nunca debe calcularse con un informe viejo.
export function removeStaleEvidence(workDir, runId) {
  for (const suffix of RUN_FILE_SUFFIXES) {
    removeIfPresent(join(workDir, `${runId}-${suffix}`));
  }
}

export function removeZapLeftovers(workDir) {
  ZAP_LEFTOVERS.forEach((name) => removeIfPresent(join(workDir, name)));
}
