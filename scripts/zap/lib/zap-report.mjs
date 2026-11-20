import { readJson } from '../../security/lib/trusted-files.mjs';

export const RISK_LABELS = ['Informational', 'Low', 'Medium', 'High'];
const CONFIDENCE_LABELS = ['False Positive', 'Low', 'Medium', 'High', 'Confirmed'];

function normalizeInstance(instance) {
  return {
    method: instance.method ?? '',
    uri: instance.uri ?? '',
    param: instance.param ?? '',
    attack: instance.attack ?? '',
    evidence: instance.evidence ?? '',
    otherInfo: instance.otherinfo ?? '',
  };
}

function normalizeAlert(raw, site) {
  const risk = Number(raw.riskcode);
  const confidence = Number(raw.confidence);
  return {
    site,
    pluginId: String(raw.pluginid),
    alertRef: String(raw.alertRef ?? raw.pluginid),
    name: raw.name ?? raw.alert,
    risk,
    riskLabel: RISK_LABELS.at(risk) ?? String(risk),
    confidenceLabel: CONFIDENCE_LABELS.at(confidence) ?? String(confidence),
    cweId: raw.cweid ?? '',
    count: Number(raw.count ?? raw.instances?.length ?? 0),
    instances: (raw.instances ?? []).map(normalizeInstance),
  };
}

function sameOrigin(siteName, target) {
  return new URL(siteName).origin === new URL(target).origin;
}

// El navegador del spider tambien genera trafico propio (servicios de Firefox): esas
// alertas no son de la app y se reportan aparte.
export function readZapReport(jsonFile, target) {
  const report = readJson(jsonFile);
  const sites = report.site ?? [];
  const targetSites = sites.filter((site) => sameOrigin(site['@name'], target));
  return {
    version: report['@version'] ?? 'desconocida',
    generated: report['@generated'] ?? '',
    foreignSites: sites.filter((site) => !targetSites.includes(site)).map((site) => site['@name']),
    alerts: targetSites.flatMap((site) => (site.alerts ?? []).map((raw) => normalizeAlert(raw, site['@name']))),
  };
}
