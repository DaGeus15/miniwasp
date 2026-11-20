import { join } from 'node:path';
import { createFinding } from '../lib/finding.mjs';
import { readJson, writeJson } from '../lib/trusted-files.mjs';
import { Severity } from '../lib/severity.mjs';

const SBOM_FILE = 'sbom.cdx.json';
const REPORT_FILE = 'licenses.json';
const UNKNOWN_LICENSE = 'UNKNOWN';
// Copyleft fuerte o no comercial: incompatibles con distribuir la app sin abrir su codigo.
const DENIED_LICENSE = /\b(AGPL|GPL|LGPL|SSPL|EUPL|CC-BY-NC|BUSL)/i;
const DEVELOPMENT_PROPERTY = 'cdx:npm:package:development';

function licenseLabel(entry) {
  return entry.expression ?? entry.license?.id ?? entry.license?.name ?? UNKNOWN_LICENSE;
}

function componentLicense(component) {
  const labels = (component.licenses ?? []).map(licenseLabel);
  return labels.length > 0 ? labels.join(' AND ') : UNKNOWN_LICENSE;
}

// Una expresion SPDX "A OR B" se acepta si al menos una alternativa es permisiva.
function isDenied(license) {
  return license.split(' OR ').every((alternative) => DENIED_LICENSE.test(alternative));
}

function isDevelopmentOnly(component) {
  return (component.properties ?? []).some(
    (property) => property.name === DEVELOPMENT_PROPERTY && property.value === 'true',
  );
}

function severityFor(entry) {
  if (entry.license === UNKNOWN_LICENSE) {
    return Severity.MEDIUM;
  }
  if (!isDenied(entry.license)) {
    return null;
  }
  return entry.development ? Severity.LOW : Severity.HIGH;
}

function toFinding(entry, severity) {
  return createFinding({
    tool: 'license-policy',
    ruleId: `license:${entry.license}`,
    severity,
    file: 'package-lock.json',
    message: `${entry.name}@${entry.version} usa ${entry.license}${entry.development ? ' (solo desarrollo)' : ''}`,
  });
}

function summarizeLicenses(entries) {
  const totals = new Map();
  for (const entry of entries) {
    totals.set(entry.license, (totals.get(entry.license) ?? 0) + 1);
  }
  return Object.fromEntries([...totals].sort(([, left], [, right]) => right - left));
}

function buildReport(sbom) {
  const components = (sbom.components ?? []).map((component) => ({
    name: component.group ? `${component.group}/${component.name}` : component.name,
    version: component.version,
    license: componentLicense(component),
    development: isDevelopmentOnly(component),
  }));
  return { source: SBOM_FILE, summary: summarizeLicenses(components), components };
}

// Se deriva del SBOM ya generado: una sola fuente de verdad y ninguna dependencia extra.
function runLocal(context) {
  const sbom = readJson(join(context.outputDirectory, SBOM_FILE));
  const report = buildReport(sbom);
  writeJson(join(context.outputDirectory, REPORT_FILE), report);
  return report;
}

function parse(report) {
  return report.components
    .map((entry) => ({ entry, severity: severityFor(entry) }))
    .filter(({ severity }) => severity !== null)
    .map(({ entry, severity }) => toFinding(entry, severity));
}

export const licensePolicyTool = {
  id: 'license-policy',
  name: 'Politica de licencias (derivada del SBOM CycloneDX)',
  reportFile: REPORT_FILE,
  runLocal,
  parse,
  describe: (report) =>
    Object.entries(report.summary)
      .map(([license, count]) => `${license}: ${count}`)
      .join(', '),
};
