// Un ciclo completo de senalizacion entre dos clientes: invitar, aceptar, ofrecer,
// responder, intercambiar candidatos de sondeo y colgar. Mide cada salto en el mismo
// proceso (performance.now), asi que las latencias de un sentido son exactas.
const PROBE_PREFIX = 'probe-';

function isProbe(event) {
  return event.type === 'call-signal' && event.signal.kind === 'candidate' && event.signal.candidate.usernameFragment?.startsWith(PROBE_PREFIX);
}

function probeSignal(callId, sequence) {
  return {
    kind: 'candidate',
    candidate: {
      candidate: `candidate:${sequence} 1 udp 2122260223 127.0.0.1 ${9000 + sequence} typ host`,
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: `${PROBE_PREFIX}${callId}-${sequence}`,
    },
  };
}

// SDP sintetico del tamano indicado: el servidor solo valida su longitud.
export function syntheticSdp(length) {
  const header = 'v=0\r\no=- 0 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=x-load-padding:';
  return header + 'x'.repeat(Math.max(0, length - header.length));
}

// El destinatario devuelve cada candidato de sondeo: asi se mide ida y vuelta por el servidor.
export function installProbeEcho(client) {
  client.on('event', (event) => {
    if (isProbe(event)) {
      client.send({ type: 'call-signal', callId: event.callId, signal: event.signal });
    }
  });
}

async function exchange({ sender, receiver, payload, predicate }) {
  const pending = receiver.waitFor(predicate);
  const sentAt = sender.send(payload);
  const { event, receivedAt } = await pending;
  return { event, latencyMs: receivedAt - sentAt };
}

async function invite(caller, callee) {
  const incoming = callee.waitFor((event) => event.type === 'call-incoming' && event.peer.id === caller.peerId);
  const ringing = caller.waitFor((event) => event.type === 'call-ringing' || (event.type === 'call-ended' && event.callId === null));
  const sentAt = caller.send({ type: 'call-invite', to: callee.peerId });
  const ring = await ringing;
  if (ring.event.type === 'call-ended') {
    incoming.catch(() => {});
    throw new Error(`Invitacion rechazada por el servidor: ${ring.event.reason}`);
  }
  const arrival = await incoming;
  return { callId: ring.event.callId, inviteRoundTripMs: ring.receivedAt - sentAt, inviteToIncomingMs: arrival.receivedAt - sentAt };
}

function signalOf(callId, kind) {
  return (event) => event.type === 'call-signal' && event.callId === callId && event.signal.kind === kind;
}

async function negotiate(caller, callee, callId, sdp) {
  const accepted = await exchange({ sender: callee, receiver: caller, payload: { type: 'call-accept', callId }, predicate: (event) => event.type === 'call-accepted' && event.callId === callId });
  const offer = await exchange({ sender: caller, receiver: callee, payload: { type: 'call-signal', callId, signal: { kind: 'offer', sdp } }, predicate: signalOf(callId, 'offer') });
  const answer = await exchange({ sender: callee, receiver: caller, payload: { type: 'call-signal', callId, signal: { kind: 'answer', sdp } }, predicate: signalOf(callId, 'answer') });
  return { acceptToAcceptedMs: accepted.latencyMs, offerRelayMs: offer.latencyMs, answerRelayMs: answer.latencyMs };
}

async function probeRoundTrips(caller, callId, probes) {
  const roundTrips = [];
  for (let sequence = 0; sequence < probes; sequence += 1) {
    const signal = probeSignal(callId, sequence);
    const fragment = signal.candidate.usernameFragment;
    const result = await exchange({ sender: caller, receiver: caller, payload: { type: 'call-signal', callId, signal }, predicate: (event) => isProbe(event) && event.signal.candidate.usernameFragment === fragment });
    roundTrips.push(result.latencyMs);
  }
  return roundTrips;
}

async function hangUp(caller, callee, callId) {
  const isEnded = (event) => event.type === 'call-ended' && event.callId === callId;
  const callerEnded = caller.waitFor(isEnded);
  const result = await exchange({ sender: caller, receiver: callee, payload: { type: 'call-hangup', callId }, predicate: isEnded });
  await callerEnded;
  return result.latencyMs;
}

export async function runCallCycle({ caller, callee, probes, sdp }) {
  const ring = await invite(caller, callee);
  const negotiation = await negotiate(caller, callee, ring.callId, sdp);
  const probeRoundTripsMs = await probeRoundTrips(caller, ring.callId, probes);
  const hangupToEndedMs = await hangUp(caller, callee, ring.callId);
  return { ...ring, ...negotiation, probeRoundTripsMs, hangupToEndedMs };
}
