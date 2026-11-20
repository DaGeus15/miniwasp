import { ContainerPath } from '../lib/docker.mjs';
import { createFinding } from '../lib/finding.mjs';
import { normalizeSeverity } from '../lib/severity.mjs';

const IAC_FILES = ['Dockerfile', 'docker-compose.yml'];

// Sin API key de Prisma Cloud la severidad llega nula y queda como UNRATED (bloqueante).
function toFinding(check) {
  return createFinding({
    tool: 'checkov',
    ruleId: check.check_id,
    severity: normalizeSeverity(check.severity),
    file: check.file_path,
    line: check.file_line_range?.[0],
    message: check.check_name,
  });
}

// Con un solo framework Checkov devuelve un objeto; con varios, una lista.
function reportSections(report) {
  return Array.isArray(report) ? report : [report];
}

export const checkovTool = {
  id: 'checkov',
  name: 'Checkov (IaC: Dockerfile, docker-compose.yml)',
  imageKey: 'checkov',
  reportFile: 'checkov.json',
  stdoutReport: true,
  okExitCodes: [0],
  versionCommand: ['--version'],
  mounts: (context) => context.sourceMounts,
  command: () => [
    ...IAC_FILES.flatMap((file) => ['--file', `${ContainerPath.SOURCE}/${file}`]),
    '--output',
    'json',
    '--soft-fail',
    '--skip-download',
  ],
  parse: (report) =>
    reportSections(report).flatMap((section) => (section.results?.failed_checks ?? []).map(toFinding)),
  // Checkov no tiene framework para docker-compose: ese archivo lo cubren las reglas de Semgrep.
  describe: (report) =>
    reportSections(report)
      .map(({ check_type: type, summary = {} }) => `${type ?? 'sin recursos'}: ${summary.passed ?? 0} aprobados, ${summary.failed ?? 0} fallidos`)
      .join('; '),
};
