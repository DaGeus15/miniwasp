// Una etapa de carga: N clientes concurrentes se conectan, se anuncian, hacen ciclos de
// llamada en parejas, quedan conectados un rato y se desconectan. Luego se verifica que
// el servidor vuelva a 0 conexiones y 0 llamadas.
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { installProbeEcho, runCallCycle } from './call-cycle.mjs';
import { LatencyRecorder, summarize } from './latency-stats.mjs';
import { SignalingClient } from './signaling-client.mjs';

const PRESENCE_TIMEOUT_MS = 20000;
const DRAIN_TIMEOUT_MS = 15000;
const DRAIN_POLL_MS = 200;

function createClients({ cookies, size, addressOf, target }) {
  return cookies.slice(0, size).map((cookie, index) => new SignalingClient({ ...target, cookie, localAddress: addressOf(index) }));
}

function settle(client) {
  return client.connect().then(
    () => ({ client, error: null }),
    (error) => ({ client, error }),
  );
}

async function connectAll(clients) {
  const outcomes = await Promise.all(clients.map(settle));
  return {
    connected: outcomes.filter((outcome) => outcome.error === null).map((outcome) => outcome.client),
    rejectedStatuses: clients.filter((client) => client.rejectedStatus !== null).map((client) => client.rejectedStatus),
    failures: outcomes.filter((outcome) => outcome.error !== null).map((outcome) => outcome.error.message),
  };
}

function countBy(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(String(value), (counts.get(String(value)) ?? 0) + 1));
  return Object.fromEntries(counts);
}

// Tiempo desde el primer anuncio hasta que todos ven la lista completa de conectados.
async function announcePresence(clients, stageName) {
  const isComplete = (event) => event.type === 'presence' && event.peers.length === clients.length;
  const converged = clients.map((client) => client.waitFor(isComplete, PRESENCE_TIMEOUT_MS));
  const startedAt = performance.now();
  clients.forEach((client, index) => client.send({ type: 'presence', name: `${stageName}-u${index}` }));
  const arrivals = await Promise.all(converged);
  return Math.max(...arrivals.map(({ receivedAt }) => receivedAt)) - startedAt;
}

async function runPairCycles({ caller, callee, cycles, probes, sdp, recorder, failures }) {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    try {
      const result = await runCallCycle({ caller, callee, probes, sdp });
      recordCycle(recorder, result);
    } catch (error) {
      failures.push(error.message);
    }
  }
}

function recordCycle(recorder, result) {
  recorder.add('inviteRoundTripMs', result.inviteRoundTripMs);
  recorder.addAll('probeRoundTripMs', result.probeRoundTripsMs);
  recorder.add('hangupToEndedMs', result.hangupToEndedMs);
  const oneWayHops = [
    ['inviteToIncomingMs', result.inviteToIncomingMs],
    ['acceptToAcceptedMs', result.acceptToAcceptedMs],
    ['offerRelayMs', result.offerRelayMs],
    ['answerRelayMs', result.answerRelayMs],
  ];
  for (const [name, value] of oneWayHops) {
    recorder.add(name, value);
    recorder.add('oneWayRelayMs', value);
  }
}

// Parejas consecutivas: el primero llama y el segundo contesta y devuelve los sondeos.
function pairUp(clients) {
  const pairs = [];
  for (let index = 0; index + 1 < clients.length; index += 2) {
    const [caller, callee] = clients.slice(index, index + 2);
    installProbeEcho(callee);
    pairs.push({ caller, callee });
  }
  return pairs;
}

async function runAllPairs(clients, options) {
  const recorder = new LatencyRecorder();
  const failures = [];
  const pairs = pairUp(clients);
  await Promise.all(pairs.map((pair) => runPairCycles({ ...pair, ...options, recorder, failures })));
  return { pairs: pairs.length, attempted: pairs.length * options.cycles, failures, latencies: recorder.summary() };
}

// Espera a que el servidor reporte 0 conexiones y 0 llamadas despues de desconectar.
export async function closeAndDrain(clients, readMetrics) {
  const startedAt = performance.now();
  await Promise.all(clients.map((client) => client.close()));
  let metrics = await readMetrics();
  while (!(metrics.connectionsActive === 0 && (metrics.callsActive ?? 0) === 0) && performance.now() - startedAt < DRAIN_TIMEOUT_MS) {
    await delay(DRAIN_POLL_MS);
    metrics = await readMetrics();
  }
  return { drainMs: Number((performance.now() - startedAt).toFixed(1)), metricsAfterDrain: metrics };
}

function clientHealth(clients) {
  return {
    serverErrorEvents: clients.reduce((total, client) => total + client.serverErrors.length, 0),
    serverErrorTexts: countBy(clients.flatMap((client) => client.serverErrors)),
    unexpectedCloses: clients.reduce((total, client) => total + client.unexpectedCloses, 0),
  };
}

// Fases activas de la etapa: conectar, anunciarse, llamar y quedar conectados en reposo.
async function runActivePhases({ stage, cookies, target, settings }) {
  const startedAt = Date.now();
  const clients = createClients({ cookies, size: stage.size, addressOf: stage.addressOf, target });
  const connection = await connectAll(clients);
  const presenceConvergenceMs = await announcePresence(connection.connected, stage.name);
  const calls = await runAllPairs(connection.connected, settings);
  const activeEndedAt = Date.now();
  await delay(settings.holdMs);
  return { clients, connection, presenceConvergenceMs, calls, times: { startedAt, activeEndedAt, holdEndedAt: Date.now() } };
}

export async function runStage({ stage, cookies, target, sampler, readMetrics, settings }) {
  const { clients, connection, presenceConvergenceMs, calls, times } = await runActivePhases({ stage, cookies, target, settings });
  const health = clientHealth(connection.connected);
  const drain = await closeAndDrain(connection.connected, readMetrics);
  await delay(settings.settleMs);
  return {
    name: stage.name,
    clients: stage.size,
    sourceAddresses: new Set(clients.map((client) => client.localAddress)).size,
    connected: connection.connected.length,
    rejectedStatuses: countBy(connection.rejectedStatuses),
    connectFailures: connection.failures,
    connectMs: summarize(connection.connected.map((client) => client.connectMs)),
    presenceConvergenceMs: Number(presenceConvergenceMs.toFixed(1)),
    calls: { pairs: calls.pairs, attempted: calls.attempted, completed: calls.attempted - calls.failures.length, failures: countBy(calls.failures) },
    latencies: calls.latencies,
    ...health,
    ...drain,
    serverDuringActivity: sampler.summarize(times.startedAt, times.activeEndedAt),
    serverWhileConnectedIdle: sampler.summarize(times.activeEndedAt, times.holdEndedAt),
    serverAfterDrain: sampler.latest(),
    durationMs: Date.now() - times.startedAt,
  };
}

// Solo conecta y desconecta: sirve para comprobar los topes de conexiones del servidor.
export async function runConnectionBoundary({ boundary, cookies, target, readMetrics }) {
  const clients = createClients({ cookies, size: boundary.size, addressOf: boundary.addressOf, target });
  const connection = await connectAll(clients);
  const metricsWhileConnected = await readMetrics();
  const drain = await closeAndDrain(connection.connected, readMetrics);
  return {
    name: boundary.name,
    description: boundary.description,
    attempted: boundary.size,
    sourceAddresses: new Set(clients.map((client) => client.localAddress)).size,
    connected: connection.connected.length,
    rejectedStatuses: countBy(connection.rejectedStatuses),
    expectedConnected: boundary.expectedConnected,
    metricsWhileConnected,
    ...drain,
    passed: connection.connected.length === boundary.expectedConnected && drain.metricsAfterDrain.connectionsActive === 0,
  };
}
