// Escribe report.json y report.md con el resultado de los escenarios E2E.
import { join } from 'node:path';
import { environmentMarkdown } from './environment.mjs';
import { writeEvidence } from './evidence-files.mjs';

function escapeCell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function keyMetrics(result) {
  const { metrics } = result;
  if (metrics.timeline) {
    return `setup ${metrics.timeline.callSetupMs} ms; RTT ${metrics.statsAna?.currentRoundTripTimeMs} ms`;
  }
  if (metrics.serverDowntimeMs !== undefined) {
    return `caida ${metrics.serverDowntimeMs} ms; inicio tras reinicio ${metrics.restartToHomeShownMs} ms`;
  }
  if (metrics.clickSkewMs !== undefined) {
    return `desfase de clics ${metrics.clickSkewMs} ms`;
  }
  return '';
}

function summaryTable(results) {
  const rows = results.map(
    (result) =>
      `| ${result.id} | ${result.type} | ${escapeCell(result.title)} | **${result.status}** | ${escapeCell(keyMetrics(result))} | ${result.durationMs} |`,
  );
  return ['| ID | Tipo | Escenario | Resultado | Metricas clave | Duracion (ms) |', '|---|---|---|---|---|---|', ...rows].join('\n');
}

function consoleSection(consoleReview) {
  const describe = (entry) => `  - ${entry.person} (${entry.source}): \`${escapeCell(entry.text)}\``;
  const lines = [`- Errores de consola esperados: ${consoleReview.expected.length}`];
  lines.push(...consoleReview.expected.map(describe));
  lines.push(`- Errores de consola NO esperados: ${consoleReview.unexpected.length}`);
  lines.push(...consoleReview.unexpected.map(describe));
  return lines.join('\n');
}

function scenarioSection(result) {
  const steps = result.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
  const checks = result.checks.map((check) => `- [${check.passed ? 'x' : ' '}] ${check.description}`).join('\n');
  const images = result.evidence.map((path) => `![${path}](${path})`).join('\n');
  return [
    `### ${result.id} - ${result.title} (${result.type}) - **${result.status}**`,
    `**Pasos**\n\n${steps}`,
    `**Esperado:** ${result.expected}`,
    `**Observado:** ${result.observed || '(sin observacion: el escenario fallo antes)'}`,
    result.failure ? `**Motivo del fallo:** ${result.failure}` : '',
    `**Verificaciones**\n\n${checks || '- (ninguna)'}`,
    consoleSection(result.console),
    `**Metricas**\n\n\`\`\`json\n${JSON.stringify(result.metrics, null, 2)}\n\`\`\``,
    images ? `**Evidencia**\n\n${images}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function writeE2eReport({ directory, environment, commands, results }) {
  const failed = results.filter((result) => result.status === 'FAIL').length;
  const report = { environment, commands, summary: { total: results.length, passed: results.length - failed, failed }, results };
  writeEvidence(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

  const markdown = [
    '# Evidencia E2E de videollamadas MiniWasp',
    `Generado por \`npm run e2e\` (scripts/e2e/run-e2e.mjs) el ${environment.date}.`,
    '## Entorno',
    `| Dato | Valor |\n|---|---|\n${environmentMarkdown(environment)}`,
    '## Como reproducir',
    commands.map((command) => `- \`${command}\``).join('\n'),
    '## Resumen',
    `Total ${results.length}, PASS ${results.length - failed}, FAIL ${failed}.`,
    summaryTable(results),
    '## Detalle por escenario',
    ...results.map(scenarioSection),
  ].join('\n\n');
  writeEvidence(join(directory, 'report.md'), `${markdown}\n`);
  return report.summary;
}
