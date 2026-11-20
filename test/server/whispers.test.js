import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { RoomRegistry } from '../../src/server/rooms/room-registry.js';
import { RoomVisibility } from '../../src/server/rooms/room.js';
import { MAX_PENDING_TRANSFERS, TransferTokens } from '../../src/server/rooms/transfer-tokens.js';
import { WhisperCoordinator } from '../../src/server/whispers/whisper-coordinator.js';
import { ClientEvent, ServerEvent, WhisperEndReason } from '../../src/shared/events.js';
import { createTestServer } from '../support/test-server.js';
import { openClient, stopServer } from '../support/ws-client.js';

describe('TransferTokens', () => {
  it('un pase sirve una sola vez y solo para la sesion que lo recibio', () => {
    const tokens = new TransferTokens();
    const token = tokens.issue('ana', { roomId: 'susurro' });
    const stolen = tokens.issue('ana', { roomId: 'susurro' });

    assert.deepEqual(tokens.redeem(token, 'ana'), { roomId: 'susurro' });
    assert.equal(tokens.redeem(token, 'ana'), null);
    assert.equal(tokens.redeem(stolen, 'intruso'), null);
    assert.equal(tokens.redeem(stolen, 'ana'), null);
    assert.equal(tokens.redeem(undefined, 'ana'), null);
  });

  it('vence, se poda y tiene un tope de pases pendientes', () => {
    const clock = { time: 0 };
    const tokens = new TransferTokens({ now: () => clock.time, ttlMs: 10 });
    const token = tokens.issue('ana', {});
    clock.time = 10;

    assert.equal(tokens.redeem(token, 'ana'), null);
    tokens.issue('luis', {});
    clock.time = 30;
    for (let index = 0; index < MAX_PENDING_TRANSFERS; index += 1) {
      tokens.issue(`s${index}`, {});
    }
    assert.equal(tokens.size, MAX_PENDING_TRANSFERS);
    assert.equal(tokens.issue('sobra', {}), null);
  });
});

describe('WhisperCoordinator', () => {
  function createPeer(id, roomId, { isPresent = true } = {}) {
    return {
      id,
      sessionId: `sesion-${id}`,
      roomId,
      isPresent,
      sent: [],
      send(event) {
        this.sent.push(event);
      },
      sharesRoomWith(other) {
        return other.roomId === this.roomId;
      },
      toPublicProfile() {
        return { id, name: id };
      },
    };
  }

  function setup() {
    const timers = [];
    const rooms = new RoomRegistry({ schedule: () => () => {} });
    const publicRoom = rooms.create({ visibility: RoomVisibility.PUBLIC, title: 'Charla' });
    const peers = new Map();
    const add = (id, options) => {
      const peer = createPeer(id, options?.roomId ?? publicRoom.id, options);
      peers.set(id, peer);
      return peer;
    };
    const whispers = new WhisperCoordinator({
      directory: { find: (id) => peers.get(id) ?? null },
      rooms,
      transferTokens: new TransferTokens(),
      logger: { info() {} },
      schedule: (callback, delayMs) => {
        const timer = { callback, delayMs, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    });
    return { whispers, rooms, publicRoom, add, timers };
  }

  it('al aceptar crea una sala de dos y entrega un pase distinto a cada persona', () => {
    const { whispers, add } = setup();
    const ana = add('ana');
    const luis = add('luis');

    whispers.invite(ana, 'luis');
    const incoming = luis.sent.at(-1);
    whispers.accept(luis, incoming.whisperId);

    assert.equal(incoming.type, ServerEvent.WHISPER_INCOMING);
    assert.deepEqual(incoming.from, { id: 'ana', name: 'ana' });
    const [anaReady, luisReady] = [ana.sent.at(-1), luis.sent.at(-1)];
    assert.equal(anaReady.type, ServerEvent.WHISPER_READY);
    assert.notEqual(anaReady.transferToken, luisReady.transferToken);
  });

  it('rechazar o dejar pasar el tiempo avisa a ambas personas', () => {
    const { whispers, add, timers } = setup();
    const ana = add('ana');
    const luis = add('luis');
    const carla = add('carla');

    whispers.invite(ana, 'luis');
    whispers.reject(luis, luis.sent.at(-1).whisperId);
    whispers.invite(ana, 'carla');
    timers.at(-1).callback();

    assert.equal(ana.sent[0].reason, WhisperEndReason.REJECTED);
    assert.equal(luis.sent.at(-1).reason, WhisperEndReason.REJECTED);
    assert.equal(carla.sent.at(-1).reason, WhisperEndReason.TIMEOUT);
    assert.equal(timers[0].cancelled, true);
  });

  it('responde "no disponible" sin revelar el motivo', () => {
    const { whispers, add, rooms } = setup();
    const ana = add('ana');
    const luis = add('luis');
    const carla = add('carla');
    const otherRoom = rooms.create({ visibility: RoomVisibility.PUBLIC, title: 'Otra' });
    add('lejos', { roomId: otherRoom.id });
    add('anonimo', { isPresent: false });

    whispers.setAcceptsWhispers(luis, false);
    for (const target of ['luis', 'ana', 'nadie', 'lejos', 'anonimo']) {
      whispers.invite(ana, target);
    }
    whispers.setAcceptsWhispers(luis, true);
    whispers.invite(ana, 'luis');
    whispers.invite(carla, 'luis');

    const unavailable = ana.sent.filter((event) => event.reason === WhisperEndReason.UNAVAILABLE);
    assert.equal(unavailable.length, 5);
    assert.ok(unavailable.every((event) => event.whisperId === null));
    assert.equal(carla.sent.at(-1).reason, WhisperEndReason.UNAVAILABLE);
    assert.equal(luis.sent.filter((event) => event.type === ServerEvent.WHISPER_INCOMING).length, 1);
  });

  it('solo existe en salas publicas, exige nombre y solo quien recibe puede responder', () => {
    const { whispers, add, rooms } = setup();
    const privateRoom = rooms.create();
    const enPrivada = add('privada', { roomId: privateRoom.id });
    const sinNombre = add('sin-nombre', { isPresent: false });
    const ana = add('ana');
    const luis = add('luis');

    assert.throws(() => whispers.invite(enPrivada, 'ana'), /salas públicas/);
    assert.throws(() => whispers.invite(sinNombre, 'ana'), /nombre/);
    whispers.invite(ana, 'luis');
    const { whisperId } = luis.sent.at(-1);
    whispers.accept(ana, whisperId);
    whispers.reject(ana, whisperId);
    whispers.accept(luis, 'otro-id');

    assert.equal(ana.sent.length, 0);
  });

  it('si alguien se va, la invitacion termina como no disponible', () => {
    const { whispers, add } = setup();
    const ana = add('ana');
    const luis = add('luis');
    whispers.invite(ana, 'luis');

    whispers.handleDeparture(ana);
    whispers.handleDeparture(ana);

    assert.equal(luis.sent.at(-1).reason, WhisperEndReason.UNAVAILABLE);
  });
});

describe('susurro de punta a punta', () => {
  let server;
  let httpUrl;
  let wsUrl;
  const clients = [];

  function post(path, body, cookie) {
    return fetch(`${httpUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: httpUrl, ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });
  }

  const cookieOf = (response) => response.headers.get('set-cookie')?.split(';')[0] ?? null;

  async function connectNamed(cookie, name) {
    const client = openClient(wsUrl, { headers: { Cookie: cookie }, ignoredEvents: [ServerEvent.PRESENCE, ServerEvent.HISTORY] });
    clients.push(client);
    const welcome = await client.next();
    client.send({ type: ClientEvent.PRESENCE, name });
    return { client, peerId: welcome.peerId };
  }

  afterEach(async () => {
    clients.splice(0).forEach((client) => client.socket.terminate());
    await stopServer(server);
  });

  it('dos personas de una sala publica pasan a una sala privada solo para ellas', async () => {
    server = createTestServer();
    const port = await server.listen(0, '127.0.0.1');
    httpUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}`;
    const anaCookie = cookieOf(await post('/rooms', { acceptedRules: true, visibility: 'public', title: 'Charla' }));
    const ana = await connectNamed(anaCookie, 'Ana');
    const [listed] = (await (await fetch(`${httpUrl}/rooms/public`)).json()).rooms;
    const luisCookie = cookieOf(await post(`/rooms/public/${listed.listingId}/join`, { acceptedRules: true }));
    const luis = await connectNamed(luisCookie, 'Luis');
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    ana.client.send({ type: ClientEvent.WHISPER_INVITE, to: luis.peerId });
    const incoming = await luis.client.next();
    luis.client.send({ type: ClientEvent.WHISPER_ACCEPT, whisperId: incoming.whisperId });
    const [anaReady, luisReady] = [await ana.client.next(), await luis.client.next()];

    const stolen = await post('/rooms/transfer', { transferToken: luisReady.transferToken }, anaCookie);
    const anaMoved = await post('/rooms/transfer', { transferToken: anaReady.transferToken }, anaCookie);
    const luisMoved = await post('/rooms/transfer', { transferToken: luisReady.transferToken }, luisCookie);
    const anaStatus = await (await fetch(`${httpUrl}/session`, { headers: { Cookie: cookieOf(anaMoved) } })).json();
    const third = await post('/rooms/join', { acceptedRules: true, inviteToken: anaStatus.inviteToken });

    assert.equal(stolen.status, 404);
    assert.equal(anaMoved.status, 204);
    assert.equal(luisMoved.status, 404);
    assert.equal(anaStatus.visibility, 'whisper');
    assert.equal(third.status, 404);
    assert.equal((await post('/rooms/transfer', { transferToken: 'x' })).status, 401);
  });
});
