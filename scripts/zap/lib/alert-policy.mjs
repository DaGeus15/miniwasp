import { readJson } from '../../security/lib/trusted-files.mjs';

const MIN_JUSTIFICATION_LENGTH = 40;
const MAX_INFORMATIONAL_TYPES = 1;
const INFORMATIONAL = 0;

function assertJustified(entry) {
  if (!entry.pluginId || (entry.justification ?? '').trim().length < MIN_JUSTIFICATION_LENGTH) {
    throw new Error(`accepted-alerts.json: la entrada ${JSON.stringify(entry)} necesita pluginId y justificacion tecnica`);
  }
}

export function loadAcceptedAlerts(file) {
  const { alerts = [] } = readJson(file);
  alerts.forEach(assertJustified);
  return alerts;
}

function pathnameOf(uri) {
  return URL.canParse(uri) ? new URL(uri).pathname : uri;
}

// Si la entrada nombra rutas, solo se acepta cuando todas las instancias ocurren en esas rutas
// exactas: un falso positivo aceptado en una ruta nunca oculta la misma alerta en otra.
function occursOnlyIn(alert, paths) {
  return alert.instances.length > 0 && alert.instances.every((instance) => paths.includes(pathnameOf(instance.uri)));
}

// Una entrada aceptada se identifica por pluginId y, opcionalmente, alertRef y rutas.
function isAccepted(alert, accepted) {
  return accepted.some(
    (entry) =>
      entry.pluginId === alert.pluginId &&
      (!entry.alertRef || entry.alertRef === alert.alertRef) &&
      (!entry.paths || occursOnlyIn(alert, entry.paths)),
  );
}

// Cada alertRef es un tipo distinto en el informe de ZAP (por ejemplo 10049-1 y 10049-2).
function countTypes(alerts) {
  return new Set(alerts.map((alert) => alert.alertRef)).size;
}

// Regla del proyecto: nada Low o superior y como maximo un tipo informativo.
export function evaluateAlerts(alerts, accepted) {
  const pending = alerts.filter((alert) => !isAccepted(alert, accepted));
  const risky = pending.filter((alert) => alert.risk > INFORMATIONAL);
  const informational = pending.filter((alert) => alert.risk === INFORMATIONAL);
  const tooManyInformational = countTypes(informational) > MAX_INFORMATIONAL_TYPES;
  return {
    passed: risky.length === 0 && !tooManyInformational,
    riskyCount: risky.length,
    informationalTypes: countTypes(informational),
    acceptedCount: alerts.length - pending.length,
  };
}
