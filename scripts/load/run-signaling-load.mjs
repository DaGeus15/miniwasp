// Prueba de carga del servidor de senalizacion (WebSocket) de MiniWasp.
// Uso: npm run load
// Arranca la app por HTTPS en un puerto libre con un codigo desechable, crea una sesion
// por usuario simulado, ejecuta etapas de 10 a 150 clientes concurrentes, prueba los topes
// de conexion y verifica que CPU, memoria y contadores vuelvan a su nivel de reposo.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AppProcess, createAccessCode, findFreePort } from '../e2e/lib/app-process.mjs';
import { describeEnvironment } from '../e2e/lib/environment.mjs';
import { syntheticSdp } from './lib/call-cycle.mjs';
import { HeapInspector } from './lib/heap-inspector.mjs';
import { writeLoadReport } from './lib/load-report.mjs';
import { runConnectionBoundary, runStage } from './lib/load-stage.mjs';
import { ProcessSampler } from './lib/process-sampler.mjs';
import { createSessions, getJson, LOGINS_PER_ADDRESS, loopbackAddress } from './lib/session-pool.mjs';

const ROOT_DIRECTORY = resolve(import.meta.dirname, '..', '..');
const EVIDENCE_DIRECTORY = join(ROOT_DIRECTORY, 'docs', 'evidence', 'load');
const STAGE_SIZES = [10, 25, 50, 100, 150];
// Repeticiones de la misma etapa al final: si hubiera fuga, el heap creceria en cada una.
const REPEAT_SIZE = 100;
const REPEATS = 2;
const REPEAT_THIRD_OCTET = 30;
const CLIENTS_PER_ADDRESS = 4;
const MAX_CONNECTIONS = 200;
const MAX_CONNECTIONS_PER_ADDRESS = 30;
const CAPACITY_EXCESS = 5;
const BOUNDARY_THIRD_OCTET = 20;
// Tamano de la oferta SDP real observada en E2E-03 (Chrome 157, audio + video).
const SDP_LENGTH = 5920;
const BASELINE_IDLE_MS = 3000;
const FINAL_IDLE_MS = 15000;
const HEAP_TOLERANCE = 0.1;
const SETTINGS = { cycles: 3, probes: 10, holdMs: 3000, settleMs: 1000, sdp: syntheticSdp(SDP_LENGTH) };

function stagePlan() {
  const stages = STAGE_SIZES.map((size, index) => ({ name: `S${index + 1}-${size}`, size, thirdOctet: index + 1 }));
  const repeats = Array.from({ length: REPEATS }, (_, index) => ({ name: `R${index + 1}-${REPEAT_SIZE}`, size: REPEAT_SIZE, thirdOctet: REPEAT_THIRD_OCTET + index }));
  // Cada etapa usa su propio rango de IPs: los limites por IP no se arrastran entre etapas.
  return [...stages, ...repeats].map((stage) => ({
    ...stage,
    addressOf: (clientIndex) => loopbackAddress(stage.thirdOctet, Math.floor(clientIndex / CLIENTS_PER_ADDRESS)),
  }));
}

function boundaryPlan() {
  return [
    {
      name: 'B1-tope-por-IP',
      description: `${MAX_CONNECTIONS_PER_ADDRESS + 1} conexiones desde 127.0.0.1 (tope por IP ${MAX_CONNECTIONS_PER_ADDRESS})`,
      size: MAX_CONNECTIONS_PER_ADDRESS + 1,
      addressOf: () => '127.0.0.1',
      expectedConnected: MAX_CONNECTIONS_PER_ADDRESS,
    },
    {
      name: 'B2-tope-total',
      description: `${MAX_CONNECTIONS + CAPACITY_EXCESS} conexiones desde ${Math.ceil((MAX_CONNECTIONS + CAPACITY_EXCESS) / CLIENTS_PER_ADDRESS)} IPs (tope total ${MAX_CONNECTIONS})`,
      size: MAX_CONNECTIONS + CAPACITY_EXCESS,
      addressOf: (clientIndex) => loopbackAddress(BOUNDARY_THIRD_OCTET, Math.floor(clientIndex / CLIENTS_PER_ADDRESS)),
      expectedConnected: MAX_CONNECTIONS,
    },
  ];
}

function designNotes() {
  const callersPerAddress = CLIENTS_PER_ADDRESS / 2;
  const signalsPerCycle = 1 + 2 + SETTINGS.probes * 2 + 1;
  return [
    'Todo corre en una sola maquina: el generador de carga comparte CPU con el servidor y la red es loopback (sin latencia ni perdida reales).',
    `Los limites del servidor son por IP. Si todos los clientes salieran de 127.0.0.1 solo cabrian ${MAX_CONNECTIONS_PER_ADDRESS} conexiones, 20 invitaciones/30 s y 300 senales/10 s en total. Para simular varios equipos cada cliente usa su propia direccion de origen loopback (127.0.x.y), ${CLIENTS_PER_ADDRESS} clientes por direccion, y cada etapa usa un rango distinto.`,
    `Sesiones: una por usuario simulado via POST /session con cabecera Origin; como el acceso admite 6 intentos/min por IP, cada direccion de acceso hace ${LOGINS_PER_ADDRESS}. La cookie no esta atada a la IP, asi que la conexion WebSocket puede salir de otra direccion.`,
    `Carga por IP y etapa: ${callersPerAddress} parejas x ${SETTINGS.cycles} ciclos = ${callersPerAddress * SETTINGS.cycles} invitaciones (limite 20/30 s) y ${callersPerAddress * SETTINGS.cycles * signalsPerCycle + CLIENTS_PER_ADDRESS} mensajes del limitador de senales (limite 300/10 s). No se envia chat (limite 10/5 s).`,
    `Ciclo por pareja: invite -> ringing/incoming, accept -> accepted, offer y answer con SDP sintetico de ${SDP_LENGTH} caracteres (tamano de la oferta real observada en E2E-03), ${SETTINGS.probes} candidatos de sondeo ida y vuelta y hangup -> call-ended en ambos lados. Ciclos secuenciales por pareja; parejas en paralelo.`,
    `Despues de los ciclos los clientes quedan conectados ${SETTINGS.holdMs} ms (CPU en reposo con N conexiones) y luego se desconectan; se espera a que /metrics muestre connectionsActive=0 y callsActive=0.`,
    'CPU y memoria del proceso del servidor se muestrean cada 500 ms desde afuera (PowerShell Get-Process: TotalProcessorTime, WorkingSet64, PrivateMemorySize64). CPU expresada como % de un nucleo. No se fuerza la recoleccion de basura.',
  ];
}

async function memoryPoint(label, { sampler, inspector }) {
  const sample = sampler.latest();
  const heap = await inspector.measureAfterGc();
  return {
    label,
    ...heap,
    workingSetMiB: sample ? Number((sample.workingSetBytes / 1024 ** 2).toFixed(1)) : null,
    privateMiB: sample?.privateBytes ? Number((sample.privateBytes / 1024 ** 2).toFixed(1)) : null,
  };
}

function evaluateMemory(points) {
  const reference = points.find((point) => point.label.startsWith('Tras S1'));
  const final = points.at(-1);
  const limit = reference.heapUsedMiB * (1 + HEAP_TOLERANCE);
  return {
    points,
    criterion: `con GC forzado, el heap usado final no supera en mas de ${HEAP_TOLERANCE * 100} % al medido tras desconectar la primera etapa (las ${MAX_CONNECTIONS + CAPACITY_EXCESS + 1} sesiones ya existen en ese punto y siguen vivas por diseno, TTL 8 h).`,
    passed: final.heapUsedMiB <= limit,
    detail: `referencia ${reference.heapUsedMiB} MiB, final ${final.heapUsedMiB} MiB, limite ${limit.toFixed(2)} MiB`,
  };
}

function hasCountersAtZero(metrics) {
  return metrics.connectionsActive === 0 && (metrics.callsActive ?? 0) === 0;
}

function stageProblems(stage) {
  const problems = [];
  if (stage.calls.completed !== stage.calls.attempted) problems.push(`${stage.calls.attempted - stage.calls.completed} ciclos fallaron`);
  if (stage.connected !== stage.clients) problems.push(`${stage.clients - stage.connected} clientes no conectaron`);
  if (stage.serverErrorEvents > 0) problems.push(`${stage.serverErrorEvents} eventos de error del servidor`);
  if (!hasCountersAtZero(stage.metricsAfterDrain)) problems.push('contadores no volvieron a 0');
  return problems.map((problem) => `${stage.name}: ${problem}`);
}

function verdict({ stages, boundaries, memoryCheck, finalMetrics }) {
  const reasons = stages.flatMap(stageProblems);
  boundaries.filter((boundary) => !boundary.passed).forEach((boundary) => reasons.push(`${boundary.name} no cumplio lo esperado`));
  if (!memoryCheck.passed) reasons.push('el heap no volvio cerca de la referencia');
  if (!hasCountersAtZero(finalMetrics)) reasons.push('contadores finales distintos de 0');
  return { passed: reasons.length === 0, reasons };
}

async function startApp() {
  const port = await findFreePort();
  const accessCode = createAccessCode();
  const app = new AppProcess({
    rootDirectory: ROOT_DIRECTORY,
    port,
    accessCode,
    logFile: join(EVIDENCE_DIRECTORY, 'server-log.jsonl'),
    nodeArguments: ['--inspect=127.0.0.1:0'],
  });
  await app.start();
  return { app, accessCode, baseUrl: `https://127.0.0.1:${port}` };
}

async function runStages(context, memoryPoints) {
  const stages = [];
  for (const stage of stagePlan()) {
    // Pausa para que la GC forzada de la medicion anterior no caiga dentro de la etapa.
    await delay(SETTINGS.settleMs);
    const result = await runStage({ ...context, stage, settings: SETTINGS });
    stages.push(result);
    memoryPoints.push(await memoryPoint(`Tras ${stage.name} (desconectados)`, context));
    console.log(`${result.name}: ${result.connected}/${result.clients} conectados, ciclos ${result.calls.completed}/${result.calls.attempted}, RTT p95 ${result.latencies.probeRoundTripMs?.p95} ms, CPU pico ${result.serverDuringActivity.peakCpuPercentOneCore} %`);
  }
  return stages;
}

async function runBoundaries(context) {
  const boundaries = [];
  for (const boundary of boundaryPlan()) {
    const result = await runConnectionBoundary({ ...context, boundary });
    boundaries.push(result);
    console.log(`${result.name}: ${result.connected}/${result.attempted} aceptadas ${JSON.stringify(result.rejectedStatuses)} -> ${result.passed ? 'PASS' : 'FAIL'}`);
  }
  return boundaries;
}

// Crea una sesion por usuario simulado mas una de observacion para leer /metrics.
async function prepareSessions({ baseUrl, accessCode, sampler, inspector, memoryPoints }) {
  const startedAt = Date.now();
  const cookies = await createSessions({ baseUrl, accessCode, count: MAX_CONNECTIONS + CAPACITY_EXCESS + 1 });
  const loginMs = Date.now() - startedAt;
  const observerCookie = cookies.pop();
  memoryPoints.push(await memoryPoint(`Tras crear ${cookies.length + 1} sesiones`, { sampler, inspector }));
  return {
    cookies,
    sessions: { created: cookies.length + 1, loginMs },
    readMetrics: async () => (await getJson({ baseUrl, path: '/metrics', cookie: observerCookie })).body,
  };
}

async function runLoad({ accessCode, baseUrl, sampler, inspector }) {
  const memoryPoints = [await memoryPoint('Reposo tras arrancar', { sampler, inspector })];
  const { cookies, sessions, readMetrics } = await prepareSessions({ baseUrl, accessCode, sampler, inspector, memoryPoints });
  const context = { cookies, sampler, inspector, readMetrics, target: { url: baseUrl.replace('https', 'wss'), origin: baseUrl } };
  const stages = await runStages(context, memoryPoints);
  const boundaries = await runBoundaries(context);
  await delay(FINAL_IDLE_MS);
  memoryPoints.push(await memoryPoint(`Final tras ${FINAL_IDLE_MS / 1000} s de reposo`, { sampler, inspector }));
  return { sessions, stages, boundaries, memoryCheck: evaluateMemory(memoryPoints), finalMetrics: await readMetrics() };
}

function buildReport({ app, baseUrl, results }) {
  return {
    environment: describeEnvironment({ appUrl: `${baseUrl} (puerto libre de esta corrida)` }),
    commands: ['npm install', 'npm run load'],
    design: designNotes(),
    settings: { ...SETTINGS, sdp: `${SDP_LENGTH} caracteres`, clientsPerAddress: CLIENTS_PER_ADDRESS, stageSizes: STAGE_SIZES, repeats: `${REPEATS} x ${REPEAT_SIZE}` },
    ...results,
    serverErrorLogEntries: app.errorLogEntries(),
    verdict: verdict(results),
  };
}

async function main() {
  mkdirSync(EVIDENCE_DIRECTORY, { recursive: true });
  const { app, accessCode, baseUrl } = await startApp();
  const sampler = new ProcessSampler();
  sampler.start(app.pid);
  const inspector = await HeapInspector.connect(app.inspectorUrl);
  try {
    await delay(BASELINE_IDLE_MS);
    const results = await runLoad({ accessCode, baseUrl, sampler, inspector });
    const report = buildReport({ app, baseUrl, results });
    writeLoadReport({ directory: EVIDENCE_DIRECTORY, report });
    console.log(`Carga: ${report.verdict.passed ? 'PASS' : 'FAIL'} ${report.verdict.reasons.join('; ')}. Reporte en docs/evidence/load/report.md`);
    process.exitCode = report.verdict.passed ? 0 : 1;
  } finally {
    inspector.close();
    sampler.stop();
    await app.kill();
  }
}

await main();
