import { ContainerPath } from '../lib/docker.mjs';
import { createFinding } from '../lib/finding.mjs';
import { normalizeSeverity } from '../lib/severity.mjs';

// Las reglas propias de docker-compose suplen a p/docker-compose, que exige la clave obsoleta
// version: y por eso no analiza el docker-compose.yml de este proyecto.
const LOCAL_COMPOSE_RULES = 'scripts/security/semgrep-rules/docker-compose.yml';
const RULESETS = ['p/javascript', 'p/nodejs', 'p/owasp-top-ten', 'p/secrets', 'p/dockerfile', LOCAL_COMPOSE_RULES];
// src y scripts son el codigo; Dockerfile y docker-compose.yml se agregan para que
// p/dockerfile y las reglas de docker-compose tengan algo que analizar.
const TARGETS = ['src', 'scripts', 'Dockerfile', 'docker-compose.yml'];

function toFinding(result) {
  return createFinding({
    tool: 'semgrep',
    ruleId: result.check_id,
    severity: normalizeSeverity(result.extra?.severity),
    file: result.path,
    line: result.start?.line,
    message: result.extra?.message,
  });
}

export const semgrepTool = {
  id: 'semgrep',
  name: 'Semgrep (SAST)',
  imageKey: 'semgrep',
  reportFile: 'semgrep.json',
  extraReports: ['semgrep.sarif'],
  okExitCodes: [0],
  versionCommand: ['semgrep', '--version'],
  mounts: (context) => [...context.sourceMounts, context.outputMount],
  command: () => [
    'semgrep',
    'scan',
    ...RULESETS.flatMap((ruleset) => ['--config', ruleset]),
    '--metrics=off',
    '--disable-version-check',
    `--json-output=${ContainerPath.OUTPUT}/semgrep.json`,
    `--sarif-output=${ContainerPath.OUTPUT}/semgrep.sarif`,
    ...TARGETS,
  ],
  parse: (report) => (report.results ?? []).map(toFinding),
  errors: (report) => (report.errors ?? []).map((error) => error.message ?? error.type),
};
