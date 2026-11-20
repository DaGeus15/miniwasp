import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { createRateLimiter } from '../../src/server/security/rate-limiter.js';
import { SessionStore } from '../../src/server/security/session-store.js';
import { ClientEvent, ServerEvent } from '../../src/shared/events.js';
import { createTestServer } from '../support/test-server.js';
import { openClient, startServer, stopServer } from '../support/ws-client.js';

const UNKNOWN_LISTING = '00000000-0000-4000-8000-000000000000';
const PROFANITY = 'que mierda de partido';
const generous = () => createRateLimiter({ limit: 100, windowMs: 60000 });

function createFakeInspector() {
  return { async inspect(bytes) { return { allowed: true, bytes }; }, async close() {} };
}

describe('API REST: salas publicas', () => {
  let server;
  let baseUrl;
  let wsUrl;
  let clients = [];

  async function start(options = {}) {
    server = createTestServer({
      sessions: new SessionStore({ ttlMs: 60000 }),
      imageInspector: createFakeInspector(),
      roomCreationLimiter: generous(),
      publicRoomCreationLimiter: generous(),
      roomJoinLimiter: generous(),
      ...options,
    });
    const port = await startServer(server);
    baseUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}`;
  }

  async function call(method, path, { token, body, headers = {} } = {}) {
    const isJson = body !== undefined && !Buffer.isBuffer(body);
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(isJson ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: isJson ? JSON.stringify(body) : body,
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : null };
  }

  const login = (fields) => call('POST', '/api/v1/auth/login', { body: { acceptedRules: true, ...fields } });
  const listRooms = (headers) => call('GET', '/api/v1/rooms/public', { headers });

  async function openPublicRoom(name = 'Ana', title = 'Charla general') {
    const response = await login({ name, visibility: 'public', title });
    assert.equal(response.status, 201, JSON.stringify(response.json));
    return { token: response.json.accessToken, ...response.json };
  }

  // Un token de la API tambien abre la conexion WebSocket (la lista cuenta conexiones vivas).
  async function connect(token, ignoredEvents) {
    const client = openClient(wsUrl, { headers: { Cookie: `miniwasp_session=${token}` }, ignoredEvents });
    clients.push(client);
    await client.opened;
    return client;
  }

  async function nextOfType(client, type) {
    let event = await client.next();
    while (event.type !== type) {
      event = await client.next();
    }
    return event;
  }

  afterEach(async () => {
    clients.forEach((client) => client.socket.terminate());
    clients = [];
    await stopServer(server);
  });

  it('crea una sala publica al iniciar sesion y la lista sin token, sin nombres ni ids internos', async () => {
    await start();
    const ana = await openPublicRoom();
    assert.deepEqual(
      { visibility: ana.room.visibility, title: ana.room.title, isOwner: ana.user.isOwner },
      { visibility: 'public', title: 'Charla general', isOwner: true },
    );
    assert.deepEqual((await listRooms()).json, { rooms: [] });

    await connect(ana.token);
    const listed = await listRooms();

    assert.equal(listed.status, 200);
    assert.deepEqual(listed.json.rooms, [{ listingId: ana.room.listingId, title: 'Charla general', members: 1, capacity: 20 }]);
    assert.doesNotMatch(JSON.stringify(listed.json), /Ana|inviteToken/);
    assert.equal(JSON.stringify(listed.json).includes(ana.room.id), false);
  });

  it('una sesion sin visibility sigue creando una sala privada que no aparece en la lista', async () => {
    await start();
    const response = await login({ name: 'Ana' });

    assert.equal(response.status, 201);
    assert.deepEqual(
      { visibility: response.json.room.visibility, title: response.json.room.title, listingId: response.json.room.listingId },
      { visibility: 'private', title: null, listingId: null },
    );
  });

  it('limita la consulta de la lista por IP con 429 y Retry-After', async () => {
    await start({ publicListLimiter: createRateLimiter({ limit: 1, windowMs: 60000 }) });
    assert.equal((await listRooms()).status, 200);

    const limited = await listRooms();

    assert.equal(limited.status, 429);
    assert.equal(limited.json.code, 'RATE_LIMITED');
    assert.equal(limited.headers.get('retry-after'), '60');
  });

  it('se entra a una sala de la lista con su listingId y sin ser dueno', async () => {
    await start();
    const ana = await openPublicRoom();

    const luis = await login({ name: 'Luis', listingId: ana.room.listingId });

    assert.equal(luis.status, 201);
    assert.equal(luis.json.room.id, ana.room.id);
    assert.equal(luis.json.user.isOwner, false);
    assert.equal(luis.json.room.visibility, 'public');
  });

  it('modera titulo y nombre con las reglas estrictas en salas publicas', async () => {
    await start();
    const cases = [
      [{ name: 'Ana', visibility: 'public' }, 400, 'INVALID_INPUT'],
      [{ name: 'Ana', visibility: 'public', title: 'x'.repeat(41) }, 400, 'INVALID_INPUT'],
      [{ name: 'Ana', visibility: 'public', title: PROFANITY }, 422, 'CONTENT_BLOCKED'],
      [{ name: 'Mierda', visibility: 'public', title: 'Charla' }, 422, 'CONTENT_BLOCKED'],
    ];
    for (const [fields, status, code] of cases) {
      const response = await login(fields);
      assert.equal(response.status, status, JSON.stringify(fields));
      assert.equal(response.json.code, code);
    }
    const ana = await openPublicRoom();

    const strictJoin = await login({ name: 'Mierda', listingId: ana.room.listingId });
    const privateRoom = await login({ name: 'Mierda' });

    assert.equal(strictJoin.status, 422);
    assert.equal(privateRoom.status, 201);
    assert.deepEqual((await listRooms()).json.rooms, []);
  });

  it('limita la creacion de salas publicas por IP y su numero total', async () => {
    await start({ publicRoomCreationLimiter: createRateLimiter({ limit: 1, windowMs: 60000 }) });
    await openPublicRoom();

    const limited = await login({ name: 'Eva', visibility: 'public', title: 'Otra' });

    assert.equal(limited.status, 429);
    assert.equal(limited.json.code, 'RATE_LIMITED');
    assert.equal(limited.headers.get('retry-after'), '600');
    await stopServer(server);

    await start({ maxPublicRooms: 1 });
    await openPublicRoom();
    const full = await login({ name: 'Eva', visibility: 'public', title: 'Otra' });
    assert.equal(full.status, 503);
    assert.equal(full.json.code, 'PUBLIC_ROOMS_FULL');
  });

  it('rechaza listingId invalido, salas que ya no existen y salas llenas', async () => {
    await start({ maxRoomMembers: 1 });
    const ana = await openPublicRoom();
    await connect(ana.token);

    const invalid = await login({ name: 'Luis', listingId: 123 });
    const gone = await login({ name: 'Luis', listingId: UNKNOWN_LISTING });
    const full = await login({ name: 'Luis', listingId: ana.room.listingId });

    assert.deepEqual([invalid.status, invalid.json.code], [400, 'INVALID_LISTING']);
    assert.deepEqual([gone.status, gone.json.code], [404, 'PUBLIC_ROOM_NOT_FOUND']);
    assert.deepEqual([full.status, full.json.code], [503, 'ROOM_FULL']);
  });

  it('quien es expulsado no vuelve por la API, ni por la lista ni por invitacion', async () => {
    await start();
    const ana = await openPublicRoom();
    const owner = await connect(ana.token);
    const luis = (await login({ name: 'Luis', listingId: ana.room.listingId })).json;
    const guest = await connect(luis.accessToken, []);
    const { peerId } = await nextOfType(guest, ServerEvent.WELCOME);

    owner.send({ type: ClientEvent.ROOM_EXPEL, peerId });
    await wait(100);
    const { inviteToken } = await (await fetch(`${baseUrl}/session`, { headers: { Cookie: `miniwasp_session=${ana.token}` } })).json();
    const byList = await login({ name: 'Luis', listingId: ana.room.listingId });
    const byInvite = await login({ name: 'Luis', inviteToken });
    const oldToken = await call('GET', '/api/v1/messages', { token: luis.accessToken });

    assert.deepEqual([byList.status, byList.json.code], [403, 'BANNED_FROM_ROOM']);
    assert.deepEqual([byInvite.status, byInvite.json.code], [403, 'BANNED_FROM_ROOM']);
    assert.equal(oldToken.status, 401);
  });

  it('al enviar mensajes por la API bloquea groserias y aplica el modo lento', async () => {
    await start();
    const ana = await openPublicRoom();
    const send = (text, token = ana.token) => call('POST', '/api/v1/messages', { token, body: { text } });

    const profanity = await send(PROFANITY);
    const first = await send('hola a todos');
    const burst = await send('otro mensaje');
    const inPrivate = await send(PROFANITY, (await login({ name: 'Eva' })).json.accessToken);

    assert.deepEqual([profanity.status, profanity.json.code], [422, 'CONTENT_BLOCKED']);
    assert.equal(first.status, 201);
    assert.deepEqual([burst.status, burst.json.code], [400, 'INVALID_INPUT']);
    assert.match(burst.json.error, /modo lento/);
    assert.equal(inPrivate.status, 201);
  });

  it('en una sala publica la API rechaza PDF y acepta texto plano', async () => {
    await start();
    const ana = await openPublicRoom();
    const upload = (bytes, fileName) =>
      call('POST', '/api/v1/attachments', {
        token: ana.token,
        body: bytes,
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(fileName) },
      });

    const pdf = await upload(Buffer.from('%PDF-1.7\nhola'), 'apuntes.pdf');
    const note = await upload(Buffer.from('notas del grupo\n'), 'nota.txt');

    assert.deepEqual([pdf.status, pdf.json.code], [415, 'FILE_TYPE_NOT_ALLOWED']);
    assert.equal(note.status, 201);
  });
});
