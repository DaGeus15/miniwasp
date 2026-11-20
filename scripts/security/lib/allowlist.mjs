import { pathExists, readJson } from './trusted-files.mjs';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function requiredFields({ tool, ruleId, reason, expires }) {
  return Object.entries({ tool, ruleId, reason, expires });
}

function validationErrors(entry, index) {
  const missing = requiredFields(entry).filter(([, value]) => !String(value ?? '').trim());
  const errors = missing.map(([field]) => `entrada ${index}: falta "${field}"`);
  if (entry.expires && !ISO_DATE.test(entry.expires)) {
    errors.push(`entrada ${index}: "expires" debe tener formato AAAA-MM-DD`);
  }
  return errors;
}

function isExpired(entry, today) {
  return entry.expires < today;
}

export function loadAllowlist(path, today = new Date().toISOString().slice(0, 10)) {
  if (!pathExists(path)) {
    return { active: [], expired: [], errors: [`no existe ${path}`] };
  }
  const entries = readJson(path).findings ?? [];
  const errors = entries.flatMap(validationErrors);
  const valid = entries.filter((entry, index) => validationErrors(entry, index).length === 0);
  return {
    active: valid.filter((entry) => !isExpired(entry, today)),
    expired: valid.filter((entry) => isExpired(entry, today)),
    errors,
  };
}

// Una excepcion se limita a herramienta + regla y, si se indica, a un archivo concreto.
function matches(entry, finding) {
  const sameRule = entry.tool === finding.tool && entry.ruleId === finding.ruleId;
  return sameRule && (!entry.file || entry.file === finding.file);
}

export function findAcceptance(allowlist, finding) {
  return allowlist.active.find((entry) => matches(entry, finding)) ?? null;
}
