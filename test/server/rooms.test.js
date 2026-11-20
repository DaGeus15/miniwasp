import assert from 'node:assert/strict';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createRateLimiter } from '../../src/server/security/rate-limiter.js';
import { SessionStore } from '../../src/server/security/session-store.js';
import { ClientEvent, ServerEvent } from '../../src/shared/events.js';
import {
  createRoomCookie,
  createTestServer,
  joinRoomCookie,
  readRoomStatus,
} from '../support/test-server.js';
import {
  expectRejection,
  expectSilence,
  openClient,
  startServer,
  stopServer,
} from '../support/ws-client.js';

const CloseCode = { SESSION_ENDED: 4401, EXPELLED: 4403, ROOM_CLOSED: 4404 };
const CLOSE_PROPAGATION_MS = 50;
// Holgado para que, con la maquina ocupada (cobertura, varias pruebas a la vez), una sala recien
// creada no se cierre antes de que su duena se conecte.
const EMPTY_ROOM_TTL_MS = 500;

// Crear una sala como el navegador: exige aceptar las normas en el cuerpo JSON.
function requestRoom(httpUrl, { origin = httpUrl, body = { acceptedRules: true } } = {}) {
  return fetch(`${httpUrl}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}

describe('salas', () => {
  let server;
  let httpUrl;
  let wsUrl;
  let clients;

  function postJoin(body, { origin = httpUrl, contentType = 'application/json' } = {}) {
    return fetch(`${httpUrl}/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, Origin: origin },
      body,
    });
  }

  async function connect(cookie, ignoredEvents = [ServerEvent.HISTORY]) {
    const client = openClient(wsUrl, { headers: { Cookie: cookie }, ignoredEvents });
    clients.push(client);
    await client.opened;
    const welcome = await client.next();
    return { ...client, id: welcome.peerId, welcome };
  }

  async function createRoomWithOwner() {
    const cookie = await createRoomCookie(httpUrl);
    const { inviteToken } = await readRoomStatus(httpUrl, cookie);
    return { cookie, inviteToken };
  }

  beforeEach(async () => {
    clients = [];
    server = createTestServer({
      sessions: new SessionStore({ ttlMs: 60000 }),
      roomCreationLimiter: createRateLimiter({ limit: 5, windowMs: 60000 }),
      roomJoinLimiter: createRateLimiter({ limit: 6, windowMs: 60000 }),
      emptyRoomTtlMs: EMPTY_ROOM_TTL_MS,
    });
    const port = await startServer(server);
    httpUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    for (const { socket } of clients) {
      socket.terminate();
    }
    await stopServer(server);
  });

  it('CP-001: crea una sala y entrega una cookie protegida a quien la crea', async () => {
    const response = await requestRoom(httpUrl);
    const cookie = response.headers.get('set-cookie');

    assert.equal(response.status, 204);
    assert.match(cookie, /^miniwasp_session=[\w-]{43};/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);

    const status = await readRoomStatus(httpUrl, cookie.split(';')[0]);
    assert.equal(status.isOwner, true);
    assert.match(status.inviteToken, /^[\w-]{22}$/);
  });

  it('CP-002: se une con una invitacion valida sin ser quien creo la sala', async () => {
    const { inviteToken } = await createRoomWithOwner();

    const guestCookie = await joinRoomCookie(httpUrl, inviteToken);
    const status = await readRoomStatus(httpUrl, guestCookie);

    assert.equal(status.isOwner, false);
    assert.equal(status.inviteToken, inviteToken);
  });

  it('CP-003: rechaza el WebSocket sin sesion o con un token inventado', async () => {
    assert.match(await expectRejection(new WebSocket(wsUrl)), /401/);
    const forged = new WebSocket(wsUrl, { headers: { Cookie: 'miniwasp_session=inventado' } });
    assert.match(await expectRejection(forged), /401/);
  });

  it('rechaza invitaciones inexistentes o mal formadas sin crear sesion', async () => {
    const invalidInvites = [{ inviteToken: 'inventada' }, {}, { inviteToken: 5 }];
    for (const invite of invalidInvites) {
      const response = await postJoin(JSON.stringify({ acceptedRules: true, ...invite }));
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('set-cookie'), null);
    }
  });

  it('exige aceptar las normas para crear una sala o unirse', async () => {
    const { inviteToken } = await createRoomWithOwner();
    const responses = [
      await requestRoom(httpUrl, { body: {} }),
      await requestRoom(httpUrl, { body: { acceptedRules: 'si' } }),
      await postJoin(JSON.stringify({ inviteToken })),
      await postJoin(JSON.stringify({ inviteToken, acceptedRules: false })),
    ];

    for (const response of responses) {
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, 'RULES_NOT_ACCEPTED');
      assert.equal(response.headers.get('set-cookie'), null);
    }
  });

  it('rechaza crear o unirse desde otra pagina web', async () => {
    const { inviteToken } = await createRoomWithOwner();
    const foreignCreate = await requestRoom(httpUrl, { origin: 'https://atacante.test' });
    const foreignJoin = await postJoin(JSON.stringify({ acceptedRules: true, inviteToken }), {
      origin: 'https://atacante.test',
    });

    assert.equal(foreignCreate.status, 403);
    assert.equal(foreignJoin.status, 403);
  });

  it('limita la creacion de salas y los intentos de union por IP', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await createRoomCookie(httpUrl);
    }
    const throttledCreate = await requestRoom(httpUrl);
    assert.equal(throttledCreate.status, 429);
    assert.equal(throttledCreate.headers.get('retry-after'), '60');

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await postJoin(JSON.stringify({ acceptedRules: true, inviteToken: 'adivinando' }));
    }
    assert.equal((await postJoin(JSON.stringify({ acceptedRules: true, inviteToken: 'adivinando' }))).status, 429);
  });

  it('rechaza contenido que no es JSON o JSON invalido al unirse', async () => {
    assert.equal((await postJoin('inviteToken=x', { contentType: 'text/plain' })).status, 415);
    assert.equal((await postJoin('{roto')).status, 400);
  });

  it('entrar a otra sala reemplaza la sesion anterior del navegador', async () => {
    const first = await createRoomWithOwner();
    const second = await createRoomWithOwner();

    const response = await postJoin(JSON.stringify({ acceptedRules: true, inviteToken: second.inviteToken }), {});
    assert.equal(response.status, 204);

    const replaced = await fetch(`${httpUrl}/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: httpUrl, Cookie: first.cookie },
      body: JSON.stringify({ acceptedRules: true, inviteToken: second.inviteToken }),
    });
    assert.equal(replaced.status, 204);
    assert.equal(await readRoomStatus(httpUrl, first.cookie), null);
  });

  it('salir revoca la sesion y cierra sus conexiones', async () => {
    const { cookie } = await createRoomWithOwner();
    const client = await connect(cookie);
    const closed = once(client.socket, 'close');

    const response = await fetch(`${httpUrl}/session`, {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: httpUrl },
    });

    assert.equal(response.status, 204);
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await closed)[0], CloseCode.SESSION_ENDED);
    assert.equal(await readRoomStatus(httpUrl, cookie), null);
  });

  it('rechaza salir desde otra pagina web', async () => {
    const { cookie } = await createRoomWithOwner();

    const response = await fetch(`${httpUrl}/session`, {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: 'https://atacante.test' },
    });

    assert.equal(response.status, 403);
    assert.ok(await readRoomStatus(httpUrl, cookie));
  });

  it('da la bienvenida con la invitacion y el rol de cada persona', async () => {
    const owner = await createRoomWithOwner();
    const guestCookie = await joinRoomCookie(httpUrl, owner.inviteToken);

    const ownerClient = await connect(owner.cookie);
    const guestClient = await connect(guestCookie);

    assert.equal(ownerClient.welcome.isOwner, true);
    assert.equal(guestClient.welcome.isOwner, false);
    assert.equal(guestClient.welcome.inviteToken, owner.inviteToken);
  });

  it('CP-015: quien crea la sala puede sacar a alguien y esa persona no puede volver', async () => {
    const owner = await createRoomWithOwner();
    const guestCookie = await joinRoomCookie(httpUrl, owner.inviteToken);
    const ownerClient = await connect(owner.cookie, [ServerEvent.HISTORY, ServerEvent.PRESENCE]);
    const guestClient = await connect(guestCookie, [ServerEvent.HISTORY, ServerEvent.PRESENCE]);
    const closed = once(guestClient.socket, 'close');

    ownerClient.send({ type: ClientEvent.ROOM_EXPEL, peerId: guestClient.id });

    assert.equal((await closed)[0], CloseCode.EXPELLED);
    const renewed = await ownerClient.next();
    assert.equal(renewed.type, ServerEvent.ROOM_INVITE);
    assert.notEqual(renewed.inviteToken, owner.inviteToken);
    assert.equal(await readRoomStatus(httpUrl, guestCookie), null);
    assert.match(await expectRejection(new WebSocket(wsUrl, { headers: { Cookie: guestCookie } })), /401/);
    assert.equal((await postJoin(JSON.stringify({ acceptedRules: true, inviteToken: owner.inviteToken }))).status, 404);
  });

  it('CP-005: una invitacion renovada deja de servir y la nueva si funciona', async () => {
    const owner = await createRoomWithOwner();
    const ownerClient = await connect(owner.cookie, [ServerEvent.HISTORY, ServerEvent.PRESENCE]);

    ownerClient.send({ type: ClientEvent.ROOM_ROTATE_INVITE });
    const { inviteToken: renewedToken } = await ownerClient.next();

    assert.equal((await postJoin(JSON.stringify({ acceptedRules: true, inviteToken: owner.inviteToken }))).status, 404);
    assert.equal((await postJoin(JSON.stringify({ acceptedRules: true, inviteToken: renewedToken }))).status, 204);
  });

  it('solo quien creo la sala puede sacar personas o renovar la invitacion', async () => {
    const owner = await createRoomWithOwner();
    const guestCookie = await joinRoomCookie(httpUrl, owner.inviteToken);
    const ownerClient = await connect(owner.cookie, [ServerEvent.HISTORY, ServerEvent.PRESENCE]);
    const guestClient = await connect(guestCookie, [ServerEvent.HISTORY, ServerEvent.PRESENCE]);

    guestClient.send({ type: ClientEvent.ROOM_EXPEL, peerId: ownerClient.id });
    assert.match((await guestClient.next()).error, /Solo quien creó la sala/);

    guestClient.send({ type: ClientEvent.ROOM_ROTATE_INVITE });
    assert.match((await guestClient.next()).error, /Solo quien creó la sala/);

    assert.equal(await expectSilence(ownerClient), true);
    assert.ok(await readRoomStatus(httpUrl, owner.cookie));
  });

  it('quien creo la sala no puede sacar a alguien de otra sala ni a si mismo', async () => {
    const first = await createRoomWithOwner();
    const second = await createRoomWithOwner();
    const firstOwner = await connect(first.cookie, [ServerEvent.HISTORY, ServerEvent.PRESENCE]);
    const secondOwner = await connect(second.cookie, [ServerEvent.HISTORY, ServerEvent.PRESENCE]);

    firstOwner.send({ type: ClientEvent.ROOM_EXPEL, peerId: secondOwner.id });
    firstOwner.send({ type: ClientEvent.ROOM_EXPEL, peerId: firstOwner.id });

    assert.equal(await expectSilence(firstOwner), true);
    assert.equal(secondOwner.socket.readyState, WebSocket.OPEN);
    assert.ok(await readRoomStatus(httpUrl, second.cookie));
  });

  it('CP-004: el chat y la presencia no cruzan de una sala a otra', async () => {
    const first = await createRoomWithOwner();
    const second = await createRoomWithOwner();
    const inFirst = await connect(first.cookie, [ServerEvent.HISTORY]);
    const inSecond = await connect(second.cookie, [ServerEvent.HISTORY]);

    inFirst.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Ana', text: 'solo para mi sala' });

    assert.equal((await inFirst.next()).message.text, 'solo para mi sala');
    assert.equal((await inFirst.next()).type, ServerEvent.PRESENCE);
    assert.equal(await expectSilence(inSecond), true);
  });

  it('el mismo nombre puede usarse en salas distintas pero no dentro de la misma', async () => {
    const first = await createRoomWithOwner();
    const second = await createRoomWithOwner();
    const guestCookie = await joinRoomCookie(httpUrl, first.inviteToken);
    const ignored = [ServerEvent.HISTORY, ServerEvent.PRESENCE];
    const ana = await connect(first.cookie, ignored);
    const otherAna = await connect(second.cookie, ignored);
    const impostor = await connect(guestCookie, ignored);

    ana.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Ana', text: 'hola' });
    await ana.next();
    assert.equal((await impostor.next()).message.name, 'Ana');
    otherAna.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Ana', text: 'hola desde otra sala' });
    impostor.send({ type: ClientEvent.CHAT_MESSAGE, name: 'ANA', text: 'soy Ana' });

    assert.equal((await otherAna.next()).message.name, 'Ana');
    assert.match((await impostor.next()).error, /ya lo usa otra persona/);
  });

  it('una sala vacia se cierra tras el tiempo de gracia y borra sus sesiones', async () => {
    const { cookie, inviteToken } = await createRoomWithOwner();
    const client = await connect(cookie);
    const closed = once(client.socket, 'close');
    client.socket.terminate();
    await closed;

    await wait(EMPTY_ROOM_TTL_MS + 50 + CLOSE_PROPAGATION_MS);

    assert.equal(await readRoomStatus(httpUrl, cookie), null);
    assert.equal((await postJoin(JSON.stringify({ acceptedRules: true, inviteToken }))).status, 404);
  });

  it('una sala ocupada no se cierra', async () => {
    const { cookie } = await createRoomWithOwner();
    await connect(cookie);

    await wait(EMPTY_ROOM_TTL_MS + 50 + CLOSE_PROPAGATION_MS);

    assert.ok(await readRoomStatus(httpUrl, cookie));
  });

  it('las metricas exigen estar en una sala', async () => {
    assert.equal((await fetch(`${httpUrl}/metrics`)).status, 401);

    const { cookie } = await createRoomWithOwner();
    const metrics = await (await fetch(`${httpUrl}/metrics`, { headers: { Cookie: cookie } })).json();

    assert.equal(metrics.roomsCreated, 1);
  });
});

describe('limite de salas', () => {
  it('rechaza crear mas salas que el maximo con 503', async () => {
    const server = createTestServer({ maxRooms: 1 });
    const httpUrl = `http://127.0.0.1:${await startServer(server)}`;

    await createRoomCookie(httpUrl);
    const response = await requestRoom(httpUrl);

    assert.equal(response.status, 503);
    await stopServer(server);
  });
});
