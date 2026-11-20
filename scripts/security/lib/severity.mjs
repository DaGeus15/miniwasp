// Escala comun de severidad para comparar herramientas que usan vocabularios distintos.
export const Severity = Object.freeze({
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  INFO: 'INFO',
  // Checkov OSS no publica severidad: un control fallido sin calificar tambien bloquea.
  UNRATED: 'UNRATED',
});

export const SEVERITY_ORDER = Object.freeze([
  Severity.CRITICAL,
  Severity.HIGH,
  Severity.MEDIUM,
  Severity.LOW,
  Severity.INFO,
  Severity.UNRATED,
]);

const BLOCKING_SEVERITIES = new Set([Severity.CRITICAL, Severity.HIGH, Severity.UNRATED]);

const ALIASES = new Map([
  ['CRITICAL', Severity.CRITICAL],
  ['HIGH', Severity.HIGH],
  ['ERROR', Severity.HIGH],
  ['MEDIUM', Severity.MEDIUM],
  ['MODERATE', Severity.MEDIUM],
  ['WARNING', Severity.MEDIUM],
  ['LOW', Severity.LOW],
  ['INFO', Severity.INFO],
  ['INFORMATIONAL', Severity.INFO],
]);

const CVSS_THRESHOLDS = Object.freeze([
  [9, Severity.CRITICAL],
  [7, Severity.HIGH],
  [4, Severity.MEDIUM],
  [0.1, Severity.LOW],
]);

export function normalizeSeverity(rawSeverity) {
  return ALIASES.get(String(rawSeverity ?? '').toUpperCase()) ?? Severity.UNRATED;
}

// Rangos de CVSS v3 publicados por FIRST.
export function severityFromCvss(rawScore) {
  const score = Number.parseFloat(rawScore);
  if (Number.isNaN(score)) {
    return Severity.UNRATED;
  }
  const match = CVSS_THRESHOLDS.find(([minimum]) => score >= minimum);
  return match ? match[1] : Severity.INFO;
}

export function isBlocking(severity) {
  return BLOCKING_SEVERITIES.has(severity);
}

export function countBySeverity(findings) {
  const counts = new Map(SEVERITY_ORDER.map((severity) => [severity, 0]));
  for (const finding of findings) {
    counts.set(finding.severity, counts.get(finding.severity) + 1);
  }
  return counts;
}
