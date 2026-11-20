// Ejecuta SAST, SCA, SBOM, secretos e IaC con imagenes Docker oficiales fijadas por digest,
// guarda los reportes crudos en docs/evidence/security y falla si queda un hallazgo
// HIGH/CRITICAL sin una excepcion justificada en accepted-findings.json.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllowlist } from './lib/allowlist.mjs';
import { runDocker } from './lib/docker.mjs';
import { evaluateGate } from './lib/gate.mjs';
import { createScanContext, disposeScanContext } from './lib/scan-context.mjs';
import { countBySeverity, SEVERITY_ORDER } from './lib/severity.mjs';
import { writeSummary } from './lib/summary-writer.mjs';
import { runTool } from './lib/tool-runner.mjs';
import { readJson } from './lib/trusted-files.mjs';
import { checkovTool } from './tools/checkov.mjs';
import { gitleaksTool } from './tools/gitleaks.mjs';
import { licensePolicyTool } from './tools/license-policy.mjs';
import { cyclonedxTool, npmAuditTool } from './tools/npm-tools.mjs';
import { osvScannerTool } from './tools/osv-scanner.mjs';
import { semgrepTool } from './tools/semgrep.mjs';
import { trivyFilesystemTool, trivyImageTool } from './tools/trivy.mjs';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(SCRIPT_DIRECTORY, '..', '..');

// El SBOM va antes que la politica de licencias porque esta lo lee.
const TOOLS = [
  semgrepTool,
  osvScannerTool,
  trivyFilesystemTool,
  trivyImageTool,
  gitleaksTool,
  checkovTool,
  npmAuditTool,
  cyclonedxTool,
  licensePolicyTool,
];

function describeEnvironment() {
  const docker = runDocker(['version', '--format', '{{.Server.Version}}']);
  if (docker.status !== 0) {
    throw new Error('Docker no responde: inicia Docker Desktop y vuelve a intentar');
  }
  return { date: new Date().toISOString(), dockerVersion: docker.stdout.trim(), nodeVersion: process.version };
}

function formatCounts(findings) {
  const counts = countBySeverity(findings);
  return SEVERITY_ORDER.filter((severity) => counts.get(severity) > 0)
    .map((severity) => `${severity}=${counts.get(severity)}`)
    .join(' ');
}

function logResult(result) {
  const detail = result.status === 'ok' ? formatCounts(result.findings) || 'sin hallazgos' : result.error;
  console.log(`[${result.status}] ${result.name}: ${detail}`);
}

function runAllTools(context, images) {
  return TOOLS.map((tool) => {
    console.log(`> ${tool.name}`);
    const result = runTool(tool, context, images);
    logResult(result);
    return result;
  });
}

function logGate(gate, context) {
  for (const finding of gate.blocking) {
    console.log(`  BLOQUEA ${finding.severity} ${finding.tool} ${finding.ruleId} ${finding.file}:${finding.line ?? '-'}`);
  }
  const verdict = gate.passed ? 'APROBADO' : 'RECHAZADO';
  console.log(`\nCompuerta ${verdict}. Evidencia en ${context.evidenceDirectory}/summary.md`);
}

function main() {
  const environment = describeEnvironment();
  const images = readJson(join(SCRIPT_DIRECTORY, 'scanner-images.json')).images;
  const allowlist = loadAllowlist(join(SCRIPT_DIRECTORY, 'accepted-findings.json'));
  const context = createScanContext(PROJECT_ROOT);
  try {
    const results = runAllTools(context, images);
    const gate = evaluateGate(results, allowlist);
    writeSummary(context, results, gate, environment);
    logGate(gate, context);
    return gate.passed ? 0 : 1;
  } finally {
    disposeScanContext(context);
  }
}

process.exitCode = main();
