import { ContainerPath, runDocker, volumeMount } from '../lib/docker.mjs';
import { createFinding } from '../lib/finding.mjs';
import { lastLines } from '../lib/process-runner.mjs';
import { normalizeSeverity } from '../lib/severity.mjs';

const CACHE_VOLUME = 'miniwasp-trivy-cache';
const SCAN_IMAGE_TAG = 'miniwasp-app:security-scan';
const IMAGE_ARCHIVE = 'miniwasp-image.tar';
// Dependencias, secretos locales y reportes generados no son codigo del proyecto.
const SKIPPED_DIRECTORIES = ['node_modules', 'certs', 'coverage', 'reports', 'docs/evidence', '.scannerwork', '.stryker-tmp'];
const SKIPPED_FILES = ['.env'];

function vulnerabilityFinding(target, item) {
  const fix = item.FixedVersion ? ` (corregido en ${item.FixedVersion})` : '';
  return createFinding({
    tool: 'trivy',
    ruleId: item.VulnerabilityID,
    severity: normalizeSeverity(item.Severity),
    file: target,
    message: `${item.PkgName}@${item.InstalledVersion}: ${item.Title ?? ''}${fix}`,
  });
}

function secretFinding(target, item) {
  return createFinding({
    tool: 'trivy',
    ruleId: item.RuleID,
    severity: normalizeSeverity(item.Severity),
    file: target,
    line: item.StartLine,
    message: item.Title,
  });
}

function misconfigurationFinding(target, item) {
  return createFinding({
    tool: 'trivy',
    ruleId: item.AVDID ?? item.ID,
    severity: normalizeSeverity(item.Severity),
    file: target,
    line: item.CauseMetadata?.StartLine,
    message: `${item.Title}: ${item.Message ?? ''}`,
  });
}

function resultFindings(result) {
  const failedMisconfigurations = (result.Misconfigurations ?? []).filter((item) => item.Status !== 'PASS');
  return [
    ...(result.Vulnerabilities ?? []).map((item) => vulnerabilityFinding(result.Target, item)),
    ...(result.Secrets ?? []).map((item) => secretFinding(result.Target, item)),
    ...failedMisconfigurations.map((item) => misconfigurationFinding(result.Target, item)),
  ];
}

function parseTrivyReport(report) {
  return (report.Results ?? []).flatMap(resultFindings);
}

// Deja constancia de que se analizo cada objetivo, aunque no tenga hallazgos.
function describeTargets(report) {
  return (report.Results ?? []).map((result) => `${result.Target} (${result.Type})`).join(', ');
}

function commonOptions(reportFile) {
  return [
    '--cache-dir',
    ContainerPath.CACHE,
    '--format',
    'json',
    '--output',
    `${ContainerPath.OUTPUT}/${reportFile}`,
    '--exit-code',
    '0',
  ];
}

function cacheMount() {
  return volumeMount(CACHE_VOLUME, ContainerPath.CACHE);
}

export const trivyFilesystemTool = {
  id: 'trivy-fs',
  name: 'Trivy filesystem (vuln, secret, misconfig)',
  imageKey: 'trivy',
  reportFile: 'trivy-fs.json',
  okExitCodes: [0],
  versionCommand: ['--version'],
  mounts: (context) => [...context.sourceMounts, context.outputMount, cacheMount()],
  command: () => [
    'fs',
    ...commonOptions('trivy-fs.json'),
    '--scanners',
    'vuln,secret,misconfig',
    '--include-dev-deps',
    ...SKIPPED_DIRECTORIES.flatMap((directory) => ['--skip-dirs', directory]),
    ...SKIPPED_FILES.flatMap((file) => ['--skip-files', file]),
    ContainerPath.SOURCE,
  ],
  parse: parseTrivyReport,
  describe: describeTargets,
};

// Se construye la imagen desde el Dockerfile del repositorio y se exporta a un tar:
// asi Trivy no necesita el socket de Docker, que equivale a acceso root al host.
function buildAndExportImage(context) {
  const build = runDocker(['build', '--pull=false', '--tag', SCAN_IMAGE_TAG, context.root]);
  if (build.status !== 0) {
    return `docker build fallo: ${lastLines(build.stderr)}`;
  }
  const archive = `${context.workDirectory}/${IMAGE_ARCHIVE}`;
  const saved = runDocker(['save', '--output', archive, SCAN_IMAGE_TAG]);
  return saved.status === 0 ? null : `docker save fallo: ${lastLines(saved.stderr)}`;
}

export const trivyImageTool = {
  id: 'trivy-image',
  name: `Trivy image (${SCAN_IMAGE_TAG} construida desde Dockerfile)`,
  imageKey: 'trivy',
  reportFile: 'trivy-image.json',
  okExitCodes: [0],
  versionCommand: ['--version'],
  prepare: buildAndExportImage,
  mounts: (context) => [context.workMount, context.outputMount, cacheMount()],
  command: () => [
    'image',
    ...commonOptions('trivy-image.json'),
    '--scanners',
    'vuln,secret',
    '--input',
    `${ContainerPath.WORK}/${IMAGE_ARCHIVE}`,
  ],
  parse: parseTrivyReport,
  describe: describeTargets,
};
