import { ContainerPath } from '../lib/docker.mjs';
import { createFinding } from '../lib/finding.mjs';
import { normalizeSeverity } from '../lib/severity.mjs';

// 7.0.0 tenia dos dias de publicada al fijar la version: se usa la anterior, con meses
// de uso, para no adoptar una version recien publicada de la cadena de suministro.
const CYCLONEDX_PACKAGE = '@cyclonedx/cyclonedx-npm@6.0.1';
const CYCLONEDX_SPEC_VERSION = '1.6';

function advisoryIds(entry) {
  const advisories = entry.via.filter((cause) => typeof cause === 'object');
  if (advisories.length === 0) {
    return `via:${entry.via.join(',')}`;
  }
  return advisories.map((cause) => cause.url?.split('/').pop() ?? cause.source).join(',');
}

// Un hallazgo por paquete afectado, igual que los totales que imprime npm audit.
function toFinding(entry) {
  const titles = entry.via.filter((cause) => typeof cause === 'object').map((cause) => cause.title);
  return createFinding({
    tool: 'npm-audit',
    ruleId: advisoryIds(entry),
    severity: normalizeSeverity(entry.severity),
    file: 'package-lock.json',
    message: `${entry.name} ${entry.range}: ${titles.join('; ') || 'dependencia transitiva vulnerable'}`,
  });
}

export const npmAuditTool = {
  id: 'npm-audit',
  name: 'npm audit (incluye devDependencies)',
  imageKey: 'node',
  reportFile: 'npm-audit.json',
  stdoutReport: true,
  // npm audit sale con 1 cuando encuentra vulnerabilidades; el JSON sigue siendo valido.
  okExitCodes: [0, 1],
  versionCommand: ['npm', '--version'],
  mounts: (context) => context.sourceMounts,
  command: () => ['npm', 'audit', '--json', '--include=dev'],
  parse: (report) => Object.values(report.vulnerabilities ?? {}).map(toFinding),
  describe: (report) => `dependencias analizadas: ${report.metadata?.dependencies?.total ?? '?'}`,
};

export const cyclonedxTool = {
  id: 'cyclonedx',
  name: `CycloneDX SBOM (${CYCLONEDX_PACKAGE})`,
  imageKey: 'node',
  reportFile: 'sbom.cdx.json',
  okExitCodes: [0],
  versionCommand: ['npm', '--version'],
  environment: { NPM_CONFIG_IGNORE_SCRIPTS: 'true', NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
  mounts: (context) => [...context.sourceMounts, context.outputMount],
  // --package-lock-only: el SBOM sale del lockfile, no de un node_modules local.
  command: () => [
    'npx',
    '--yes',
    CYCLONEDX_PACKAGE,
    '--package-lock-only',
    '--spec-version',
    CYCLONEDX_SPEC_VERSION,
    '--output-format',
    'JSON',
    '--output-file',
    `${ContainerPath.OUTPUT}/sbom.cdx.json`,
  ],
  parse: () => [],
  describe: (report) =>
    `componentes: ${report.components?.length ?? 0}, especificacion CycloneDX ${report.specVersion}`,
};
