// Escribe report.json y report.md de la prueba de carga de senalizacion.
import { join } from 'node:path';
import { environmentMarkdown } from '../../e2e/lib/environment.mjs';
import { writeEvidence } from '../../e2e/lib/evidence-files.mjs';

function percentiles(summary) {
  return summary?.count ? `${summary.p50} / ${summary.p95} / ${summary.p99} (n=${summary.count})` : 'n/a';
}

function memory(sample) {
  return sample ? (sample.workingSetBytes / 1024 ** 2).toFixed(1) : 'n/a';
}

function stageRow(stage) {
  return [
    stage.name,
    stage.clients,
    stage.sourceAddresses,
    `${stage.connected}/${stage.clients}`,
    percentiles(stage.connectMs),
    stage.presenceConvergenceMs,
    `${stage.calls.completed}/${stage.calls.attempted}`,
    percentiles(stage.latencies.probeRoundTripMs),
    percentiles(stage.latencies.inviteRoundTripMs),
    percentiles(stage.latencies.oneWayRelayMs),
    `${stage.serverDuringActivity.avgCpuPercentOneCore} / ${stage.serverDuringActivity.peakCpuPercentOneCore}`,
    stage.serverDuringActivity.peakWorkingSetMiB,
    memory(stage.serverAfterDrain),
    stage.serverErrorEvents + stage.unexpectedCloses + stage.connectFailures.length,
    `${stage.metricsAfterDrain.connectionsActive} / ${stage.metricsAfterDrain.callsActive ?? 0}`,
  ].join(' | ');
}

function stageTable(stages) {
  const header =
    '| Etapa | Clientes | IPs origen | Conectados | Conexion ms p50/p95/p99 | Presencia converge (ms) | Ciclos OK | RTT senal A->B->A ms p50/p95/p99 | invite->ringing ms p50/p95/p99 | Relevo 1 sentido ms p50/p95/p99 | CPU % 1 nucleo prom/pico | WS pico MiB | WS tras desconectar MiB | Errores | conn/calls tras desconectar |';
  const divider = `|${'---|'.repeat(15)}`;
  return [header, divider, ...stages.map((stage) => `| ${stageRow(stage)} |`)].join('\n');
}

function boundaryTable(boundaries) {
  const rows = boundaries.map(
    (boundary) =>
      `| ${boundary.name} | ${boundary.description} | ${boundary.attempted} | ${boundary.sourceAddresses} | ${boundary.connected} (esperado ${boundary.expectedConnected}) | ${JSON.stringify(boundary.rejectedStatuses)} | ${boundary.metricsAfterDrain.connectionsActive} | **${boundary.passed ? 'PASS' : 'FAIL'}** |`,
  );
  return ['| Prueba | Descripcion | Intentos | IPs origen | Aceptadas | Rechazos por codigo HTTP | connectionsActive al final | Resultado |', '|---|---|---|---|---|---|---|---|', ...rows].join('\n');
}

function memoryTable(memoryCheck) {
  const rows = memoryCheck.points.map(
    (point) => `| ${point.label} | ${point.heapUsedMiB} | ${point.heapTotalMiB} | ${point.workingSetMiB} | ${point.privateMiB ?? 'n/a'} |`,
  );
  const header = '| Momento | Heap usado tras GC forzado MiB | Heap total MiB | Working set MiB | Privada MiB |';
  return [header, '|---|---|---|---|---|', ...rows].join('\n');
}

export function writeLoadReport({ directory, report }) {
  writeEvidence(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const { memoryCheck } = report;
  const markdown = [
    '# Prueba de carga de senalizacion MiniWasp',
    `Generado por \`npm run load\` (scripts/load/run-signaling-load.mjs) el ${report.environment.date}.`,
    '## Entorno',
    `| Dato | Valor |\n|---|---|\n${environmentMarkdown(report.environment)}`,
    '## Como reproducir',
    report.commands.map((command) => `- \`${command}\``).join('\n'),
    '## Diseno y limites',
    report.design.map((line) => `- ${line}`).join('\n'),
    '## Resultados por etapa',
    stageTable(report.stages),
    'RTT senal A->B->A: candidato de sondeo enviado por A, reenviado por el servidor a B, devuelto por B y reenviado a A (dos pasos por el servidor). Relevo 1 sentido: invite->incoming, accept->accepted, offer y answer medidos en el mismo proceso.',
    '## Topes de conexion',
    boundaryTable(report.boundaries),
    '## Memoria y fugas',
    memoryTable(memoryCheck),
    `Criterio: ${memoryCheck.criterion} Resultado: **${memoryCheck.passed ? 'PASS' : 'FAIL'}** (${memoryCheck.detail}).`,
    '## Veredicto',
    `**${report.verdict.passed ? 'PASS' : 'FAIL'}**: ${report.verdict.reasons.length ? report.verdict.reasons.join('; ') : 'todas las etapas completaron sus ciclos sin errores y los contadores volvieron a 0'}.`,
  ].join('\n\n');
  writeEvidence(join(directory, 'report.md'), `${markdown}\n`);
}
