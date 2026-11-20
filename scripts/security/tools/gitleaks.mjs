import { ContainerPath } from '../lib/docker.mjs';
import { createFinding } from '../lib/finding.mjs';
import { Severity } from '../lib/severity.mjs';

const CONFIG_FILE = '.gitleaks.toml';

// Gitleaks no asigna severidad: un secreto expuesto siempre se trata como HIGH.
function toFinding(leak) {
  return createFinding({
    tool: 'gitleaks',
    ruleId: leak.RuleID,
    severity: Severity.HIGH,
    file: leak.File,
    line: leak.StartLine,
    message: `${leak.Description} (fingerprint ${leak.Fingerprint})`,
  });
}

export const gitleaksTool = {
  id: 'gitleaks',
  name: 'Gitleaks (secretos, modo directorio sin git)',
  imageKey: 'gitleaks',
  reportFile: 'gitleaks.json',
  okExitCodes: [0],
  versionCommand: ['version'],
  mounts: (context) => [...context.sourceMounts, context.outputMount],
  // "dir" es el reemplazo oficial de "detect --no-git": la carpeta no es un repositorio.
  command: () => [
    'dir',
    ContainerPath.SOURCE,
    '--config',
    `${ContainerPath.SOURCE}/${CONFIG_FILE}`,
    '--report-format',
    'json',
    '--report-path',
    `${ContainerPath.OUTPUT}/gitleaks.json`,
    '--redact',
    '--no-banner',
    '--exit-code',
    '0',
  ],
  parse: (report) => (Array.isArray(report) ? report : []).map(toFinding),
};
