import { join } from 'node:path';
import { describeLocation } from './finding.mjs';
import { SEVERITY_ORDER, countBySeverity } from './severity.mjs';
import { writeJson, writeText } from './trusted-files.mjs';

const MAX_MESSAGE_LENGTH = 180;

function cell(value) {
  const text = String(value ?? '').replaceAll('|', '\\|');
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 3)}...` : text;
}

function row(values) {
  return `| ${values.map(cell).join(' | ')} |`;
}

function table(headers, rows) {
  return [row(headers), row(headers.map(() => '---')), ...rows.map(row)].join('\n');
}

function reportLinks(result) {
  return [result.reportFile, ...result.extraReports].join(', ');
}

function overviewSection(results) {
  const rows = results.map((result) => {
    const counts = countBySeverity(result.findings);
    return [result.name, result.status, ...SEVERITY_ORDER.map((severity) => counts.get(severity)), reportLinks(result)];
  });
  return `## Resumen por herramienta\n\n${table(['Herramienta', 'Estado', ...SEVERITY_ORDER, 'Reporte'], rows)}`;
}

function toolDetail(result) {
  if (result.status !== 'ok') {
    return `### ${result.name}\n\n- Estado: **error**\n- Detalle: \`${cell(result.error)}\``;
  }
  const lines = [
    `### ${result.name}`,
    '',
    `- Imagen: \`${result.image}\``,
    `- Version: \`${result.version}\``,
    `- Codigo de salida: ${result.exitCode} (${(result.durationMs / 1000).toFixed(1)} s)`,
    `- Reporte: \`${reportLinks(result)}\``,
  ];
  if (result.notes) {
    lines.push(`- Notas: ${result.notes}`);
  }
  if (result.toolErrors.length > 0) {
    lines.push(`- Avisos internos de la herramienta: ${result.toolErrors.length} (ver reporte)`);
  }
  lines.push('', '```text', result.command, '```');
  return lines.join('\n');
}

function findingRows(findings) {
  const rank = (finding) => SEVERITY_ORDER.indexOf(finding.severity);
  return [...findings]
    .sort((left, right) => rank(left) - rank(right))
    .map((finding) => [finding.severity, finding.tool, finding.ruleId, describeLocation(finding), finding.message]);
}

function findingsTable(findings) {
  if (findings.length === 0) {
    return 'Ninguno.';
  }
  return table(['Severidad', 'Herramienta', 'Regla', 'Ubicacion', 'Mensaje'], findingRows(findings));
}

function gateSection(gate) {
  const failures = gate.toolFailures.map((result) => `- Herramienta sin resultado: ${result.name}`);
  const allowlistErrors = gate.allowlistErrors.map((error) => `- accepted-findings.json: ${error}`);
  const expired = gate.expiredAcceptances.map((entry) => `- Excepcion vencida (${entry.expires}): ${entry.tool} ${entry.ruleId}`);
  const accepted = gate.accepted.map(({ finding, acceptance }) =>
    `- ${finding.tool} ${finding.ruleId} en ${describeLocation(finding)}: ${acceptance.reason} (vence ${acceptance.expires})`,
  );
  return [
    `## Resultado de la compuerta: ${gate.passed ? 'APROBADO' : 'RECHAZADO'}`,
    '',
    'Bloquean: hallazgos CRITICAL, HIGH o UNRATED sin excepcion vigente en `scripts/security/accepted-findings.json`, herramientas que no produjeron reporte y excepciones mal formadas.',
    '',
    ...failures,
    ...allowlistErrors,
    ...expired,
    '',
    `### Hallazgos bloqueantes (${gate.blocking.length})`,
    '',
    findingsTable(gate.blocking),
    '',
    `### Excepciones aplicadas (${gate.accepted.length})`,
    '',
    accepted.length > 0 ? accepted.join('\n') : 'Ninguna.',
  ].join('\n');
}

function header(environment) {
  return [
    '# Evidencia de escaneo de seguridad',
    '',
    `- Fecha (UTC): ${environment.date}`,
    '- Comando: `npm run scan:security` (`node scripts/security/run-security-scans.mjs`)',
    `- Docker Engine: ${environment.dockerVersion}; Node.js del host: ${environment.nodeVersion}`,
    '- Proyecto montado en solo lectura en `/src`; `.env` y `certs/` se ocultan con montajes vacios.',
    '- Severidad normalizada: Semgrep ERROR=HIGH, WARNING=MEDIUM, INFO=LOW; OSV por puntaje CVSS; Gitleaks siempre HIGH; Checkov sin severidad = UNRATED.',
    '- Archivo generado automaticamente. No editar a mano.',
  ].join('\n');
}

export function writeSummary(context, results, gate, environment) {
  const allFindings = results.flatMap((result) => result.findings);
  const markdown = [
    header(environment),
    gateSection(gate),
    overviewSection(results),
    '## Detalle por herramienta',
    ...results.map(toolDetail),
    `## Todos los hallazgos (${allFindings.length})`,
    findingsTable(allFindings),
  ].join('\n\n');
  writeText(join(context.outputDirectory, 'summary.md'), `${markdown}\n`);
  const normalized = { generatedAt: environment.date, passed: gate.passed, blocking: gate.blocking, findings: allFindings };
  writeJson(join(context.outputDirectory, 'findings.json'), normalized);
}
