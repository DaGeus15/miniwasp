import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Logger } from '../../src/server/observability/logger.js';
import { CallEndReason, ClientEvent, ServerEvent, SignalKind } from '../../src/shared/events.js';
import { createRoomCookie, joinRoomCookie, readRoomStatus, startRoomServer } from '../support/test-server.js';
import { expectSilence, openClient, stopServer } from '../support/ws-client.js';

const offer = { kind: SignalKind.OFFER, sdp: 'v=0' };

// Escenarios obligatorios de la auditoria que necesitan el servidor completo.
describe('escenarios de auditoria', () => {
  let room;
  let clients;
  let logLines;

  async function connectWith(cookie, name) {
    const client = openClient(room.wsUrl, {
      headers: { Cookie: cookie },
      ignoredEvents: [ServerEvent.HISTORY, ServerEvent.PRESENCE],
    });
    clients.push(client);
    await client.opened;
    const welcome = await client.next();
    client.send({ type: ClientEvent.PRESENCE, name });
    return { ...client, id: welcome.peerId, cookie, welcome };
  }

  async function connectAs(name) {
    return connectWith(await room.memberCookie(), name);
  }

  async function startCall(caller, callee) {
    caller.send({ type: ClientEvent.CALL_INVITE, to: callee.id });
    const ringing = await caller.next();
    await callee.next();
    return ringing.callId;
  }

  async function establishCall(caller, callee) {
    const callId = await startCall(caller, callee);
    callee.send({ type: ClientEvent.CALL_ACCEPT, callId });
    await caller.next();
    return callId;
  }

  beforeEach(async () => {
    clients = [];
    logLines = [];
    room = await startRoomServer({
      logger: new Logger({ write: (line) => logLines.push(line) }),
      iceServers: [{ urls: 'stun:stun.test:3478' }],
    });
  });

  afterEach(async () => {
    for (const { socket } of clients) {
      socket.terminate();
    }
    await stopServer(room.server);
  });

  it('una invitacion de llamada cancelada no puede aceptarse despues', async () => {
    const ana = await connectAs('Ana');
    const luis = await connectAs('Luis');
    const callId = await startCall(ana, luis);
    ana.send({ type: ClientEvent.CALL_HANGUP, callId });
    assert.equal((await luis.next()).reason, CallEndReason.HANGUP);
    await ana.next();

    luis.send({ type: ClientEvent.CALL_ACCEPT, callId });
    luis.send({ type: ClientEvent.CALL_SIGNAL, callId, signal: offer });

    assert.equal(await expectSilence(ana), true);
  });

  it('CP-016: el cliente solo recibe URLs STUN, nunca credenciales de relay', async () => {
    const ana = await connectAs('Ana');

    for (const iceServer of ana.welcome.iceServers) {
      assert.deepEqual(Object.keys(iceServer), ['urls']);
      assert.match(iceServer.urls, /^stuns?:/);
    }
  });

  it('CP-017: los registros no contienen tokens, invitaciones, nombres ni SDP', async () => {
    const ana = await connectAs('Ana');
    const luis = await connectAs('Luis');
    const callId = await establishCall(ana, luis);
    ana.send({ type: ClientEvent.CALL_HANGUP, callId });
    await luis.next();

    const logs = logLines.join('\n');
    const sessionTokens = [ana.cookie, luis.cookie, room.ownerCookie].map((cookie) => cookie.split('=')[1]);

    assert.ok(logLines.length > 0, 'debe haber registros que revisar');
    for (const secret of [...sessionTokens, room.inviteToken, 'Ana', 'Luis', 'v=0']) {
      assert.equal(logs.includes(secret), false, `se filtro ${secret}`);
    }
  });

  it('CP-018: si ambos cuelgan a la vez la llamada termina una sola vez', async () => {
    const ana = await connectAs('Ana');
    const luis = await connectAs('Luis');
    const callId = await establishCall(ana, luis);

    ana.send({ type: ClientEvent.CALL_HANGUP, callId });
    luis.send({ type: ClientEvent.CALL_HANGUP, callId });

    assert.equal((await ana.next()).type, ServerEvent.CALL_ENDED);
    assert.equal((await luis.next()).type, ServerEvent.CALL_ENDED);
    assert.equal(await expectSilence(ana), true);
    assert.equal(await expectSilence(luis), true);

    const metrics = await (await fetch(`${room.httpUrl}/metrics`, { headers: { Cookie: ana.cookie } })).json();
    assert.equal(metrics.callsActive, 0);
    assert.equal(metrics.callsEnded, 1);
  });

  it('CP-019: quienes estan en otra sala no reciben eventos ni pueden llamar', async () => {
    const ana = await connectAs('Ana');
    const luis = await connectAs('Luis');
    const otherOwnerCookie = await createRoomCookie(room.httpUrl);
    const { inviteToken } = await readRoomStatus(room.httpUrl, otherOwnerCookie);
    const rosa = await connectWith(otherOwnerCookie, 'Rosa');
    const pedro = await connectWith(await joinRoomCookie(room.httpUrl, inviteToken), 'Pedro');

    const callId = await establishCall(ana, luis);
    ana.send({ type: ClientEvent.CALL_SIGNAL, callId, signal: offer });
    assert.equal((await luis.next()).callId, callId);
    ana.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Ana', text: 'mensaje privado de la sala' });

    rosa.send({ type: ClientEvent.CALL_INVITE, to: ana.id });
    assert.equal((await rosa.next()).reason, CallEndReason.UNAVAILABLE);
    assert.equal(await expectSilence(pedro), true);
    assert.equal(await expectSilence(rosa), true);
  });
});
