import { ContainerPath } from '../lib/docker.mjs';
import { createFinding } from '../lib/finding.mjs';
import { severityFromCvss } from '../lib/severity.mjs';

const LOCKFILE = 'package-lock.json';
const PACKAGE_COUNT = /found (\d+) packages/;

function summaryOf(entry, vulnerabilityId) {
  const vulnerability = (entry.vulnerabilities ?? []).find((item) => item.id === vulnerabilityId);
  return vulnerability?.summary ?? '';
}

// Un grupo reune los alias (GHSA, CVE) de una misma vulnerabilidad: se cuenta una vez.
function groupFindings(source, entry) {
  const { name, version } = entry.package;
  return (entry.groups ?? []).map((group) =>
    createFinding({
      tool: 'osv-scanner',
      ruleId: group.ids.join(','),
      severity: severityFromCvss(group.max_severity),
      file: source.path,
      message: `${name}@${version}: ${summaryOf(entry, group.ids[0])}`,
    }),
  );
}

export const osvScannerTool = {
  id: 'osv-scanner',
  name: 'OSV-Scanner (SCA)',
  imageKey: 'osvScanner',
  reportFile: 'osv-scanner.json',
  // 0 = sin vulnerabilidades, 1 = vulnerabilidades encontradas; ambos producen reporte.
  okExitCodes: [0, 1],
  versionCommand: ['--version'],
  mounts: (context) => [...context.sourceMounts, context.outputMount],
  command: () => [
    'scan',
    'source',
    '--lockfile',
    `${ContainerPath.SOURCE}/${LOCKFILE}`,
    '--format',
    'json',
    '--output',
    `${ContainerPath.OUTPUT}/osv-scanner.json`,
  ],
  parse: (report) =>
    (report.results ?? []).flatMap((result) =>
      (result.packages ?? []).flatMap((entry) => groupFindings(result.source, entry)),
    ),
  // El JSON solo lista paquetes vulnerables: el total analizado se toma de la salida.
  describe: (_report, run) => `paquetes analizados: ${PACKAGE_COUNT.exec(run?.stderr ?? '')?.[1] ?? '?'}`,
};
