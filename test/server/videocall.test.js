import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { startRoomServer } from '../support/test-server.js';
import { createRateLimiter } from '../../src/server/security/rate-limiter.js';
import { CallEndReason, ClientEvent, ServerEvent, SignalKind } from '../../src/shared/events.js';
import { MAX_SDP_LENGTH } from '../../src/shared/limits.js';
import { expectSilence, openClient, stopServer } from '../support/ws-client.js';

const offer = { kind: SignalKind.OFFER, sdp: 'v=0' };
const iceServers = [{ urls: 'stun:stun.test:3478' }];
// Corto para que la prueba no espere, y suficiente para reconectar en una maquina ocupada.
const RETURN_GRACE_MS = 1500;

// Salta los avisos de presencia (alguien entra o sale) hasta el evento buscado.
async function nextOfType(client, type) {
  let event = await client.next();
  while (event.type !== type) {
    event = await client.next();
  }
  return event;
}

describe('senalizacion de videollamadas', () => {
  let room;
  let clients;

  async function waitForPeer(client, peerId) {
    let event = await client.next();
    while (!event.peers?.some((peer) => peer.id === peerId)) {
      event = await client.next();
    }
  }

  // Cada prueba lee solo sus eventos: el historial y la bienvenida ya se consumieron.
  async function connect(name, existingCookie = null) {
    const cookie = existingCookie ?? (await room.memberCookie());
    const client = openClient(room.wsUrl, {
      headers: { Cookie: cookie },
      ignoredEvents: [ServerEvent.HISTORY],
    });
    clients.push(client);
    await client.opened;
    const welcome = await client.next();
    if (name) {
      client.send({ type: ClientEvent.PRESENCE, name });
      await waitForPeer(client, welcome.peerId);
    }
    return { ...client, id: welcome.peerId, welcome, cookie };
  }

  async function connectPair() {
    const caller = await connect('Ana');
    const callee = await connect('Luis');
    await waitForPeer(caller, callee.id);
    return { caller, callee };
  }

  async function startCall() {
    const pair = await connectPair();
    pair.caller.send({ type: ClientEvent.CALL_INVITE, to: pair.callee.id });
    const ringing = await pair.caller.next();
    const incoming = await pair.callee.next();
    return { ...pair, ringing, incoming, callId: ringing.callId };
  }

  async function establishCall() {
    const call = await startCall();
    call.callee.send({ type: ClientEvent.CALL_ACCEPT, callId: call.callId });
    await call.caller.next();
    return call;
  }

  beforeEach(async () => {
    clients = [];
    room = await startRoomServer({ iceServers, callReturnGraceMs: RETURN_GRACE_MS });
  });

  afterEach(async () => {
    for (const { socket } of clients) {
      socket.terminate();
    }
    await stopServer(room.server);
  });

  it('da la bienvenida con un id propio y los servidores ICE', async () => {
    const client = await connect();

    assert.equal(client.welcome.type, ServerEvent.WELCOME);
    assert.equal(typeof client.welcome.peerId, 'string');
    assert.deepEqual(client.welcome.iceServers, iceServers);
  });

  it('anuncia a quien tiene nombre y olvida a quien se desconecta', async () => {
    const { caller: watcher, callee: leaving } = await connectPair();

    leaving.socket.terminate();

    assert.deepEqual((await watcher.next()).peers, [{ id: watcher.id, name: 'Ana', isOwner: false }]);
  });

  it('avisa la llamada a ambas personas', async () => {
    const { caller, callee, ringing, incoming } = await startCall();

    assert.equal(ringing.type, ServerEvent.CALL_RINGING);
    assert.deepEqual(ringing.peer, { id: callee.id, name: 'Luis', isOwner: false });
    assert.equal(incoming.type, ServerEvent.CALL_INCOMING);
    assert.deepEqual(incoming.peer, { id: caller.id, name: 'Ana', isOwner: false });
    assert.equal(incoming.callId, ringing.callId);
  });

  it('negocia la conexion despues de aceptar', async () => {
    const { caller, callee, callId } = await establishCall();

    caller.send({ type: ClientEvent.CALL_SIGNAL, callId, signal: offer });
    assert.deepEqual(await callee.next(), { type: ServerEvent.CALL_SIGNAL, callId, signal: offer });

    const answer = { kind: SignalKind.ANSWER, sdp: 'v=0' };
    callee.send({ type: ClientEvent.CALL_SIGNAL, callId, signal: answer });
    assert.deepEqual(await caller.next(), {
      type: ServerEvent.CALL_SIGNAL,
      callId,
      signal: answer,
    });
  });

  it('transporta una oferta del tamano maximo', async () => {
    const { caller, callee, callId } = await establishCall();
    const signal = { kind: SignalKind.OFFER, sdp: 'a'.repeat(MAX_SDP_LENGTH) };

    caller.send({ type: ClientEvent.CALL_SIGNAL, callId, signal });

    assert.equal((await callee.next()).signal.sdp.length, MAX_SDP_LENGTH);
  });

  it('no revela direcciones de red antes de que acepten', async () => {
    const { caller, callee, callId } = await startCall();

    caller.send({ type: ClientEvent.CALL_SIGNAL, callId, signal: offer });

    assert.equal(await expectSilence(callee), true);
  });

  it('una tercera persona no puede intervenir en la llamada', async () => {
    const { caller, callee, callId } = await establishCall();
    const intruder = await connect();

    intruder.send({ type: ClientEvent.CALL_SIGNAL, callId, signal: offer });
    intruder.send({ type: ClientEvent.CALL_HANGUP, callId });

    assert.equal(await expectSilence(caller), true);
    assert.equal(await expectSilence(callee), true);
  });

  it('solo quien recibe la llamada puede aceptarla', async () => {
    const { caller, callId } = await startCall();

    caller.send({ type: ClientEvent.CALL_ACCEPT, callId });

    assert.equal(await expectSilence(caller), true);
  });

  it('avisa a ambos cuando se rechaza', async () => {
    const { caller, callee, callId } = await startCall();

    callee.send({ type: ClientEvent.CALL_REJECT, callId });

    const expected = { type: ServerEvent.CALL_ENDED, callId, reason: CallEndReason.REJECTED };
    assert.deepEqual(await caller.next(), expected);
    assert.deepEqual(await callee.next(), expected);
  });

  it('corta la llamada si quien se desconecto no vuelve a tiempo', async () => {
    const { caller, callee, callId } = await establishCall();

    callee.socket.terminate();

    assert.deepEqual(await nextOfType(caller, ServerEvent.CALL_ENDED), {
      type: ServerEvent.CALL_ENDED,
      callId,
      reason: CallEndReason.DISCONNECTED,
    });
  });

  it('si a alguien se le cae la conexion, retoma la llamada al volver con su misma sesion', async () => {
    const { caller, callee, callId } = await establishCall();
    caller.send({ type: ClientEvent.CALL_SIGNAL, callId, signal: offer });
    await nextOfType(callee, ServerEvent.CALL_SIGNAL);

    callee.socket.terminate();
    const returning = await connect('Luis', callee.cookie);
    returning.send({ type: ClientEvent.CALL_RESUME, callId });
    caller.send({ type: ClientEvent.CALL_SIGNAL, callId, signal: { kind: SignalKind.CANDIDATE, candidate: { candidate: 'candidate:1' } } });

    assert.equal((await nextOfType(returning, ServerEvent.CALL_SIGNAL)).signal.kind, SignalKind.CANDIDATE);
    await new Promise((resolve) => {
      setTimeout(resolve, RETURN_GRACE_MS + 300);
    });
    returning.send({ type: ClientEvent.CALL_HANGUP, callId });
    assert.equal((await nextOfType(caller, ServerEvent.CALL_ENDED)).reason, CallEndReason.HANGUP);
  });

  it('otra persona de la sala no puede retomar una llamada ajena', async () => {
    const { caller, callee, callId } = await establishCall();
    const outsider = await connect('Rosa');

    outsider.send({ type: ClientEvent.CALL_RESUME, callId });

    assert.equal((await nextOfType(outsider, ServerEvent.CALL_ENDED)).reason, CallEndReason.DISCONNECTED);
    caller.send({ type: ClientEvent.CALL_HANGUP, callId });
    assert.equal((await nextOfType(callee, ServerEvent.CALL_ENDED)).reason, CallEndReason.HANGUP);
  });

  it('rechaza senales mal formadas sin reenviarlas', async () => {
    const { caller, callee, callId } = await establishCall();

    caller.send({ type: ClientEvent.CALL_SIGNAL, callId, signal: { kind: 'virus' } });

    assert.equal((await caller.next()).type, ServerEvent.ERROR);
    assert.equal(await expectSilence(callee), true);
  });

  it('rechaza nombres invalidos en la presencia', async () => {
    const client = await connect();

    client.send({ type: ClientEvent.PRESENCE, name: '   ' });

    assert.equal((await client.next()).type, ServerEvent.ERROR);
  });

  it('rechaza tipos de mensaje desconocidos', async () => {
    const client = await connect();

    client.send({ type: 'borrar-todo' });

    assert.equal((await client.next()).type, ServerEvent.ERROR);
  });
});

describe('limites de la videollamada', () => {
  it('limita las invitaciones sin afectar al chat', async () => {
    const room = await startRoomServer({
      inviteLimiter: createRateLimiter({ limit: 1, windowMs: 60000 }),
    });
    const client = openClient(room.wsUrl, {
      headers: { Cookie: room.ownerCookie },
      ignoredEvents: [ServerEvent.WELCOME, ServerEvent.HISTORY],
    });
    await client.opened;

    client.send({ type: ClientEvent.PRESENCE, name: 'Ana' });
    await client.next();
    client.send({ type: ClientEvent.CALL_INVITE, to: 'nadie' });
    assert.equal((await client.next()).reason, CallEndReason.UNAVAILABLE);

    client.send({ type: ClientEvent.CALL_INVITE, to: 'nadie' });
    assert.match((await client.next()).error, /muy rápido/);

    client.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Ana', text: 'sigo aqui' });
    assert.equal((await client.next()).type, ServerEvent.MESSAGE);

    client.socket.terminate();
    await stopServer(room.server);
  });

  it('termina una llamada que nadie contesta', async () => {
    const room = await startRoomServer({ ringTimeoutMs: 10 });

    const callee = openClient(room.wsUrl, {
      headers: { Cookie: await room.memberCookie() },
      ignoredEvents: [ServerEvent.HISTORY],
    });
    await callee.opened;
    const { peerId } = await callee.next();
    callee.send({ type: ClientEvent.PRESENCE, name: 'Luis' });
    await callee.next();

    const caller = openClient(room.wsUrl, {
      headers: { Cookie: await room.memberCookie() },
      ignoredEvents: [ServerEvent.HISTORY, ServerEvent.WELCOME, ServerEvent.PRESENCE],
    });
    await caller.opened;
    caller.send({ type: ClientEvent.PRESENCE, name: 'Ana' });
    caller.send({ type: ClientEvent.CALL_INVITE, to: peerId });

    assert.equal((await caller.next()).type, ServerEvent.CALL_RINGING);
    assert.equal((await caller.next()).reason, CallEndReason.TIMEOUT);

    caller.socket.terminate();
    callee.socket.terminate();
    await stopServer(room.server);
  });
});
