// Escaneo OWASP ZAP automatizado de MiniWasp.
// Uso: npm run scan:zap                      (baseline + full scan contra una instancia local)
//      npm run scan:zap -- --runs=baseline   (solo una corrida)
//      npm run scan:zap -- --public-baseline (baseline pasivo contra el tunel publico, si corre)
//      npm run scan:zap -- --public-url=<url> (baseline pasivo contra un despliegue publico)
//      npm run scan:zap -- --app-root=<dir> --out=<dir> (escanea una copia con cambios propuestos)
// Ver scripts/zap/README.md para el detalle de la autenticacion.
import { join, resolve } from 'node:path';
import { ensureDirectory, pathExists, readText, writeJson, writeText } from '../security/lib/trusted-files.mjs';
import { evaluateAlerts, loadAcceptedAlerts } from './lib/alert-policy.mjs';
import { findFreePort, startApp, stopApp, waitForHealth } from './lib/app-process.mjs';
import { createHttpsClient } from './lib/https-client.mjs';
import { prepareApiSession } from './lib/api-session.mjs';
import { joinRoomSocket, leaveRoomSocket } from './lib/room-presence.mjs';
import { createRoomAndGetToken, readRoomInvite } from './lib/session-login.mjs';
import { fingerprintSources } from './lib/source-fingerprint.mjs';
import { removeStaleEvidence, removeZapLeftovers } from './lib/stale-evidence.mjs';
import { writeSummary } from './lib/summary-writer.mjs';
import { findRunningTunnelUrl } from './lib/tunnel.mjs';
import { buildZapCommand, forceRemoveContainer, isZapError, runDocker } from './lib/zap-docker.mjs';
import { readZapReport } from './lib/zap-report.mjs';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const PATHS = {
  appRoot: PROJECT_ROOT,
  hooksDir: join(PROJECT_ROOT, 'scripts', 'zap'),
  workDir: join(PROJECT_ROOT, 'docs', 'evidence', 'zap'),
  acceptedFile: join(PROJECT_ROOT, 'scripts', 'zap', 'accepted-alerts.json'),
  certFile: join(PROJECT_ROOT, 'certs', 'dev-cert.pem'),
  keyFile: join(PROJECT_ROOT, 'certs', 'dev-key.pem'),
};
const DOCKER_HOST = 'host.docker.internal';
const HOOK_FILE = 'zap_hooks.py';
const SPIDER_ARGS = ['-j', '--ajax-spider', '-m', '2'];

const LOCAL_RUNS = new Map([
  ['baseline', { id: 'baseline', title: 'Baseline: pasivo + spider + AJAX spider (autenticado)', script: 'zap-baseline.py', args: SPIDER_ARGS }],
  ['full', { id: 'full', title: 'Full scan: activo + pasivo (autenticado)', script: 'zap-full-scan.py', args: SPIDER_ARGS }],
]);
const PUBLIC_RUN = { id: 'public-baseline', title: 'Baseline del tunel publico: solo pasivo (sin autenticar)', script: 'zap-baseline.py', args: ['-m', '1'] };
const PRODUCTION_RUN = { id: 'production-baseline', title: 'Baseline de produccion: solo pasivo (sin autenticar)', script: 'zap-baseline.py', args: ['-m', '1'] };
const ALL_RUN_IDS = [...LOCAL_RUNS.keys(), PUBLIC_RUN.id, PRODUCTION_RUN.id];

const active = { app: null, socket: null, runId: null };

function readOption(argv, name) {
  const option = argv.find((arg) => arg.startsWith(`--${name}=`));
  return option?.slice(name.length + 3);
}

function parseOptions(argv) {
  const runIds = readOption(argv, 'runs')?.split(',') ?? [...LOCAL_RUNS.keys()];
  const unknown = runIds.filter((id) => !LOCAL_RUNS.has(id));
  if (unknown.length > 0) {
    throw new Error(`Corridas desconocidas: ${unknown.join(', ')}`);
  }
  return {
    publicBaseline: argv.includes('--public-baseline'),
    publicUrl: readOption(argv, 'public-url'),
    runs: runIds.map((id) => LOCAL_RUNS.get(id)),
    appRoot: resolve(readOption(argv, 'app-root') ?? PROJECT_ROOT),
    workDir: resolve(readOption(argv, 'out') ?? PATHS.workDir),
  };
}

function evaluateRun(run, target, accepted) {
  const reportFile = join(PATHS.workDir, `${run.id}-report.json`);
  if (!pathExists(reportFile)) {
    throw new Error(`ZAP no genero ${reportFile}`);
  }
  return evaluateAlerts(readZapReport(reportFile, target).alerts, accepted);
}

function describeOutcome(run, meta) {
  const passed = meta.verdict.passed && meta.sourceStable !== false && !isZapError(meta.zapExitCode);
  console.log(`[zap] ${run.id}: ${passed ? 'APROBADO' : 'NO APROBADO'} (salida de ZAP ${meta.zapExitCode})`);
  if (meta.sourceStable === false) {
    console.log('[zap] src cambio durante el escaneo: el resultado no es valido, repite la corrida');
  }
  return passed;
}

// Ejecuta ZAP, guarda los metadatos de la corrida y devuelve si cumple la politica.
async function executeRun(run, { target, env, hookFile }, accepted) {
  const args = buildZapCommand({ run, target, hooksDir: PATHS.hooksDir, workDir: PATHS.workDir, envNames: Object.keys(env), hookFile });
  console.log(`\n[zap] ${run.title}\n[zap] objetivo ${target}`);
  const fingerprint = hookFile ? fingerprintSources(PATHS.appRoot) : null;
  removeStaleEvidence(PATHS.workDir, run.id);
  const startedAt = new Date().toISOString();
  active.runId = run.id;
  const zapExitCode = await runDocker(args, { ...process.env, ...env });
  active.runId = null;
  removeZapLeftovers(PATHS.workDir);
  const meta = {
    id: run.id, title: run.title, target, startedAt, finishedAt: new Date().toISOString(), zapExitCode,
    command: `docker ${args.join(' ')}`,
    sourceStable: fingerprint ? fingerprint === fingerprintSources(PATHS.appRoot) : null,
    verdict: evaluateRun(run, target, accepted),
  };
  writeJson(join(PATHS.workDir, `${run.id}-meta.json`), meta);
  return describeOutcome(run, meta);
}

function authEnvironment(port, { token, accessToken, videoCallId }, runId) {
  return {
    MINIWASP_SESSION_TOKEN: token,
    MINIWASP_API_TOKEN: accessToken,
    MINIWASP_VIDEOCALL_ID: videoCallId,
    MINIWASP_TARGET_AUTHORITY: `${DOCKER_HOST}:${port}`,
    MINIWASP_AUTH_CHECK_FILE: `/zap/wrk/${runId}-auth-check.json`,
  };
}

async function prepareSession(client, origin, ca) {
  await waitForHealth(active.app.child, client);
  const token = await createRoomAndGetToken(client, { origin });
  const inviteToken = await readRoomInvite(client, token);
  active.socket = await joinRoomSocket({ origin, ca, token });
  return { token, ...(await prepareApiSession(client, inviteToken)) };
}

async function stopActiveApp(runId) {
  leaveRoomSocket(active.socket);
  active.socket = null;
  if (!active.app) {
    return;
  }
  await stopApp(active.app.child);
  if (runId) {
    writeText(join(PATHS.workDir, `${runId}-app.log`), active.app.readLog());
  }
  active.app = null;
}

// Cada corrida usa una instancia nueva de la app: sesiones, limites e historial limpios.
async function scanLocalRun(run, accepted) {
  const port = await findFreePort();
  const origin = `https://127.0.0.1:${port}`;
  const ca = readText(PATHS.certFile);
  const client = createHttpsClient({ origin, ca });
  active.app = startApp({ projectRoot: PATHS.appRoot, port, certFile: PATHS.certFile, keyFile: PATHS.keyFile });
  try {
    const credentials = await prepareSession(client, origin, ca);
    const target = `https://${DOCKER_HOST}:${port}`;
    return await executeRun(run, { target, env: authEnvironment(port, credentials, run.id), hookFile: HOOK_FILE }, accepted);
  } finally {
    await stopActiveApp(run.id);
  }
}

// Contra la URL publica nunca se ejecuta el escaneo activo.
async function scanPublicTunnel(accepted) {
  const tunnelUrl = await findRunningTunnelUrl(PROJECT_ROOT);
  if (!tunnelUrl) {
    console.log('[zap] No hay un tunel de Cloudflare corriendo: se omite el baseline publico');
    return true;
  }
  return executeRun(PUBLIC_RUN, { target: tunnelUrl, env: {}, hookFile: null }, accepted);
}

// Despliegue publico indicado por quien ejecuta: nunca se ejecuta el escaneo activo.
function scanPublicUrl(url, accepted) {
  if (!url.startsWith('https://')) {
    throw new Error('--public-url debe ser una URL https');
  }
  return executeRun(PRODUCTION_RUN, { target: url, env: {}, hookFile: null }, accepted);
}

function assertCertificates() {
  if (!pathExists(PATHS.certFile) || !pathExists(PATHS.keyFile)) {
    throw new Error('Faltan los certificados de desarrollo: ejecuta npm run cert');
  }
}

async function cleanUpAndExit() {
  await stopActiveApp(null);
  if (active.runId) {
    await forceRemoveContainer(active.runId);
  }
  process.exit(130);
}

async function runSelected(options, accepted) {
  if (options.publicUrl) {
    return [await scanPublicUrl(options.publicUrl, accepted)];
  }
  if (options.publicBaseline) {
    return [await scanPublicTunnel(accepted)];
  }
  assertCertificates();
  const results = [];
  for (const run of options.runs) {
    results.push(await scanLocalRun(run, accepted));
  }
  return results;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  Object.assign(PATHS, { appRoot: options.appRoot, workDir: options.workDir });
  const accepted = loadAcceptedAlerts(PATHS.acceptedFile);
  ensureDirectory(PATHS.workDir);
  const results = await runSelected(options, accepted);
  writeSummary(PATHS.workDir, ALL_RUN_IDS);
  console.log(`\n[zap] Resumen: ${join(PATHS.workDir, 'summary.md')}`);
  process.exitCode = results.every(Boolean) ? 0 : 1;
}

process.on('SIGINT', cleanUpAndExit);
main().catch(async (error) => {
  console.error(`[zap] ${error.message}`);
  await stopActiveApp(null);
  process.exitCode = 1;
});
