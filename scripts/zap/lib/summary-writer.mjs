import { join } from 'node:path';
import { pathExists, readJson, writeText } from '../../security/lib/trusted-files.mjs';
import { readZapReport } from './zap-report.mjs';

const MAX_LISTED_URLS = 10;
const MAX_LISTED_EVIDENCE = 5;
const MAX_TEXT_LENGTH = 300;
const MAX_AUTH_LINES = 30;
const BACKTICK = '`';

function cell(text) {
  const flat = String(text ?? '').replaceAll(/\s+/g, ' ').replaceAll('|', '\\|').trim();
  return flat.length > MAX_TEXT_LENGTH ? `${flat.slice(0, MAX_TEXT_LENGTH)}...` : flat;
}

function code(text) {
  return BACKTICK + cell(text) + BACKTICK;
}

function codeList(values, limit = values.length) {
  return values.slice(0, limit).map(code).join(', ') || '-';
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== ''))];
}

function byRiskDescending(left, right) {
  return right.risk - left.risk || left.pluginId.localeCompare(right.pluginId);
}

function alertTable(alerts) {
  if (alerts.length === 0) {
    return ['Sin alertas para el objetivo.'];
  }
  const header = ['| Riesgo | Confianza | Plugin | alertRef | Nombre | Instancias |', '|---|---|---|---|---|---|'];
  const rows = alerts.map(
    (alert) =>
      `| ${alert.riskLabel} | ${alert.confidenceLabel} | ${alert.pluginId} | ${alert.alertRef} | ${cell(alert.name)} | ${alert.count} |`,
  );
  return [...header, ...rows];
}

function alertDetail(alert) {
  const urls = unique(alert.instances.map((instance) => `${instance.method} ${instance.uri}`));
  const evidence = unique(alert.instances.map((instance) => instance.evidence));
  const params = unique(alert.instances.map((instance) => instance.param));
  return [
    `#### [${alert.riskLabel}] ${alert.pluginId} (${alert.alertRef}) ${alert.name}`,
    '',
    `- Confianza: ${alert.confidenceLabel}; CWE: ${alert.cweId || '-'}`,
    `- URLs (${urls.length}): ${codeList(urls, MAX_LISTED_URLS)}`,
    `- Parametros: ${codeList(params)}`,
    `- Evidencia: ${codeList(evidence, MAX_LISTED_EVIDENCE)}`,
    `- Otra info: ${cell(alert.instances[0]?.otherInfo) || '-'}`,
    '',
  ];
}

function readAuthCheck(workDir, runId) {
  const file = join(workDir, `${runId}-auth-check.json`);
  return pathExists(file) ? readJson(file) : null;
}

function authSection(authCheck) {
  if (!authCheck) {
    return ['- Verificacion de autenticacion: no disponible para esta corrida', ''];
  }
  const entries = Object.entries(authCheck.responses).sort((left, right) => right[1] - left[1]);
  const lines = entries.slice(0, MAX_AUTH_LINES).map(([key, count]) => `  - ${code(key)}: ${count}`);
  const omitted = entries.length > MAX_AUTH_LINES ? [`  - (${entries.length - MAX_AUTH_LINES} variantes mas en el archivo auth-check)`] : [];
  return [
    `- Peticiones a /session, /metrics y /api/v1 registradas por ZAP (con cookie o Bearer: ${authCheck.withSessionCookie}):`,
    ...lines,
    ...omitted,
    '',
  ];
}

function verdictLine({ verdict, sourceStable }) {
  const status = verdict.passed && sourceStable !== false ? 'APROBADO' : 'NO APROBADO';
  return `- Veredicto: **${status}** (alertas Low+ pendientes: ${verdict.riskyCount}, tipos informativos pendientes: ${verdict.informationalTypes}, aceptadas: ${verdict.acceptedCount})`;
}

function runSection(workDir, meta) {
  const report = readZapReport(join(workDir, `${meta.id}-report.json`), meta.target);
  const alerts = [...report.alerts].sort(byRiskDescending);
  return [
    `## ${meta.title}`,
    '',
    `- Objetivo: ${code(meta.target)}`,
    `- Inicio: ${meta.startedAt}; fin: ${meta.finishedAt}`,
    `- ZAP ${report.version}; codigo de salida del script de ZAP: ${meta.zapExitCode}`,
    `- Comando: ${BACKTICK}${meta.command}${BACKTICK}`,
    verdictLine(meta),
    `- Codigo fuente sin cambios durante el escaneo: ${meta.sourceStable === false ? '**NO** (resultado no valido, repetir)' : 'si'}`,
    `- Sitios ajenos excluidos de la evaluacion: ${report.foreignSites.join(', ') || 'ninguno'}`,
    ...authSection(readAuthCheck(workDir, meta.id)),
    ...alertTable(alerts),
    '',
    '### Detalle',
    '',
    ...alerts.flatMap(alertDetail),
  ];
}

function readMetas(workDir, runIds) {
  return runIds
    .map((id) => join(workDir, `${id}-meta.json`))
    .filter((file) => pathExists(file))
    .map((file) => readJson(file));
}

// Se regenera con todas las corridas presentes, asi corridas separadas no se pisan.
export function writeSummary(workDir, runIds) {
  const sections = readMetas(workDir, runIds).map((meta) => runSection(workDir, meta));
  const lines = [
    '# Resumen de escaneos OWASP ZAP',
    '',
    `Generado: ${new Date().toISOString()}. Politica: ninguna alerta Low o superior y como maximo un tipo informativo, salvo las justificadas en ${code('scripts/zap/accepted-alerts.json')}.`,
    '',
    ...sections.flat(),
  ];
  writeText(join(workDir, 'summary.md'), lines.join('\n'));
}
