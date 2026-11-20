import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { createRateLimiter } from '../../src/server/security/rate-limiter.js';
import { SessionStore } from '../../src/server/security/session-store.js';
import { createRoomCookie, createTestServer } from '../support/test-server.js';
import { startServer, stopServer } from '../support/ws-client.js';

const EMPTY_ROOM_TTL_MS = 80;
const UNKNOWN_CALL_ID = '00000000-0000-4000-8000-000000000000';

describe('API REST /api/v1', () => {
  let server;
  let baseUrl;

  async function call(method, path, { token, body, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined || typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : null };
  }

  async function login(name, inviteToken) {
    const response = await call('POST', '/api/v1/auth/login', { body: { acceptedRules: true, name, inviteToken } });
    assert.equal(response.status, 201, JSON.stringify(response.json));
    return { token: response.json.accessToken, ...response.json };
  }

  async function threePeople() {
    const ana = await login('Ana');
    const luis = await login('Luis', ana.room.inviteToken);
    const carla = await login('Carla', ana.room.inviteToken);
    return { ana, luis, carla };
  }

  beforeEach(async () => {
    server = createTestServer({
      sessions: new SessionStore({ ttlMs: 60000 }),
      roomCreationLimiter: createRateLimiter({ limit: 5, windowMs: 60000 }),
      roomJoinLimiter: createRateLimiter({ limit: 10, windowMs: 60000 }),
      emptyRoomTtlMs: EMPTY_ROOM_TTL_MS,
    });
    baseUrl = `http://127.0.0.1:${await startServer(server)}`;
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe('autenticacion', () => {
    it('sin invitacion crea una sala y entrega un token Bearer a su duena', async () => {
      const response = await call('POST', '/api/v1/auth/login', { body: { acceptedRules: true, name: '  Ana  ' } });

      assert.equal(response.status, 201);
      assert.equal(response.json.tokenType, 'Bearer');
      assert.match(response.json.accessToken, /^[\w-]{43}$/);
      assert.equal(response.json.expiresIn, 60);
      assert.deepEqual(response.json.user, { id: response.json.user.id, name: 'Ana', isOwner: true });
      assert.match(response.json.room.inviteToken, /^[\w-]{22}$/);
      assert.equal(response.headers.get('set-cookie'), null);
    });

    it('con invitacion se une a la sala existente sin ser duena', async () => {
      const ana = await login('Ana');

      const luis = await login('Luis', ana.room.inviteToken);

      assert.equal(luis.room.id, ana.room.id);
      assert.equal(luis.user.isOwner, false);
    });

    it('valida el nombre, el tipo de contenido y el JSON', async () => {
      const cases = [
        [{ body: {} }, 400, 'RULES_NOT_ACCEPTED'],
        [{ body: { name: 'Ana', acceptedRules: 'true' } }, 400, 'RULES_NOT_ACCEPTED'],
        [{ body: { acceptedRules: true } }, 400, 'INVALID_NAME'],
        [{ body: { acceptedRules: true, name: 'vendo cocaina' } }, 422, 'CONTENT_BLOCKED'],
        [{ body: { acceptedRules: true, name: 'x'.repeat(31) } }, 400, 'INVALID_NAME'],
        [{ body: { acceptedRules: true, name: `Ana${String.fromCodePoint(0x202e)}` } }, 400, 'INVALID_NAME'],
        [{ body: 'null' }, 400, 'RULES_NOT_ACCEPTED'],
        [{ body: '{malo' }, 400, 'BAD_REQUEST'],
        [{ body: 'name=Ana', headers: { 'Content-Type': 'text/plain' } }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
        [{ body: JSON.stringify({ name: 'a'.repeat(2000) }) }, 413, 'PAYLOAD_TOO_LARGE'],
      ];
      for (const [options, status, code] of cases) {
        const response = await call('POST', '/api/v1/auth/login', options);
        assert.equal(response.status, status, JSON.stringify(options));
        assert.equal(response.json.code, code);
        assert.equal(typeof response.json.error, 'string');
      }
    });

    it('rechaza invitaciones que no son texto o que no existen', async () => {
      const notText = await call('POST', '/api/v1/auth/login', { body: { acceptedRules: true, name: 'Luis', inviteToken: 123 } });
      const unknown = await call('POST', '/api/v1/auth/login', { body: { acceptedRules: true, name: 'Luis', inviteToken: 'no-existe' } });

      assert.equal(notText.status, 400);
      assert.equal(notText.json.code, 'INVALID_INVITE');
      assert.equal(unknown.status, 404);
      assert.equal(unknown.json.code, 'INVITE_NOT_FOUND');
    });

    it('no permite repetir un nombre de la sala, sin importar mayusculas', async () => {
      const ana = await login('Ana');

      const response = await call('POST', '/api/v1/auth/login', {
        body: { acceptedRules: true, name: 'ANA', inviteToken: ana.room.inviteToken },
      });

      assert.equal(response.status, 409);
      assert.equal(response.json.code, 'NAME_TAKEN');
    });

    it('rechaza peticiones de otro origen', async () => {
      const response = await call('POST', '/api/v1/auth/login', {
        body: { acceptedRules: true, name: 'Ana' },
        headers: { Origin: 'https://evil.example' },
      });

      assert.equal(response.status, 403);
      assert.equal(response.json.code, 'FORBIDDEN');
    });

    it('limita la creacion de salas con 429 y Retry-After', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await login(`Persona ${attempt}`);
      }

      const response = await call('POST', '/api/v1/auth/login', { body: { acceptedRules: true, name: 'Sexta' } });

      assert.equal(response.status, 429);
      assert.equal(response.json.code, 'RATE_LIMITED');
      assert.equal(response.headers.get('retry-after'), '60');
    });

    it('responde 405 a un metodo no permitido', async () => {
      const response = await call('GET', '/api/v1/auth/login');

      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'POST');
    });
  });

  describe('busqueda de usuarios', () => {
    it('exige token y explica si falta o no sirve', async () => {
      const missing = await call('GET', '/api/v1/users');
      const invalid = await call('GET', '/api/v1/users', { token: 'inventado' });
      const malformed = await call('GET', '/api/v1/users', { headers: { Authorization: 'Basic abc' } });

      assert.equal(missing.status, 401);
      assert.equal(missing.json.code, 'TOKEN_MISSING');
      assert.equal(missing.headers.get('www-authenticate'), 'Bearer realm="miniwasp"');
      assert.equal(invalid.status, 401);
      assert.equal(invalid.json.code, 'TOKEN_INVALID');
      assert.match(invalid.headers.get('www-authenticate'), /error="invalid_token"/);
      assert.equal(malformed.json.code, 'TOKEN_INVALID');
    });

    it('no acepta como Bearer el token de una sesion del navegador', async () => {
      const cookie = await createRoomCookie(baseUrl);

      const response = await call('GET', '/api/v1/users', { token: cookie.split('=')[1] });

      assert.equal(response.status, 401);
    });

    it('lista a las personas de la sala ordenadas y marca quien pregunta', async () => {
      const { ana } = await threePeople();

      const response = await call('GET', '/api/v1/users', { token: ana.token });

      assert.equal(response.status, 200);
      assert.equal(response.json.total, 3);
      assert.deepEqual(
        response.json.users.map(({ name, isOwner, isYou }) => ({ name, isOwner, isYou })),
        [
          { name: 'Ana', isOwner: true, isYou: true },
          { name: 'Carla', isOwner: false, isYou: false },
          { name: 'Luis', isOwner: false, isYou: false },
        ],
      );
    });

    it('filtra por parte del nombre sin distinguir mayusculas', async () => {
      const { ana } = await threePeople();

      const response = await call('GET', '/api/v1/users?q=%20LU%20', { token: ana.token });

      assert.equal(response.json.query, 'LU');
      assert.deepEqual(response.json.users.map((user) => user.name), ['Luis']);
    });

    it('devuelve una lista vacia si nadie coincide', async () => {
      const { ana } = await threePeople();

      const response = await call('GET', '/api/v1/users?q=zzz', { token: ana.token });

      assert.deepEqual(response.json, { query: 'zzz', total: 0, users: [] });
    });

    it('rechaza consultas demasiado largas o con caracteres de control', async () => {
      const ana = await login('Ana');

      for (const query of ['a'.repeat(31), '%07']) {
        const response = await call('GET', `/api/v1/users?q=${query}`, { token: ana.token });
        assert.equal(response.status, 400);
        assert.equal(response.json.code, 'INVALID_QUERY');
      }
    });

    it('nunca muestra personas de otra sala', async () => {
      await threePeople();
      const eva = await login('Eva');

      const response = await call('GET', '/api/v1/users', { token: eva.token });

      assert.deepEqual(response.json.users.map((user) => user.name), ['Eva']);
    });
  });

  describe('videollamada', () => {
    it('dos personas entran y la tercera recibe 409 CALL_FULL', async () => {
      const { ana, luis, carla } = await threePeople();

      const started = await call('POST', '/api/v1/videocalls', { token: ana.token });
      const callId = started.json.id;
      const joined = await call('POST', `/api/v1/videocalls/${callId}/join`, { token: luis.token });
      const refused = await call('POST', `/api/v1/videocalls/${callId}/join`, { token: carla.token });

      assert.equal(started.status, 201);
      assert.equal(started.json.status, 'waiting');
      assert.equal(joined.status, 200);
      assert.equal(joined.json.status, 'active');
      assert.deepEqual(joined.json.participants.map((person) => person.name), ['Ana', 'Luis']);
      assert.equal(refused.status, 409);
      assert.equal(refused.json.code, 'CALL_FULL');
    });

    it('muestra la llamada de cada persona en la busqueda', async () => {
      const { ana, carla } = await threePeople();
      const started = await call('POST', '/api/v1/videocalls', { token: ana.token });

      const response = await call('GET', '/api/v1/users?q=ana', { token: carla.token });

      assert.equal(response.json.users[0].videocallId, started.json.id);
    });

    it('consulta el estado y responde 404 a llamadas inexistentes o de otra sala', async () => {
      const { ana, luis } = await threePeople();
      const eva = await login('Eva');
      const { json } = await call('POST', '/api/v1/videocalls', { token: ana.token });

      const shown = await call('GET', `/api/v1/videocalls/${json.id}`, { token: luis.token });
      const unknown = await call('GET', `/api/v1/videocalls/${UNKNOWN_CALL_ID}`, { token: luis.token });
      const foreign = await call('POST', `/api/v1/videocalls/${json.id}/join`, { token: eva.token });

      assert.equal(shown.status, 200);
      assert.equal(shown.json.id, json.id);
      assert.equal(unknown.status, 404);
      assert.equal(unknown.json.code, 'CALL_NOT_FOUND');
      assert.equal(foreign.status, 404);
    });

    it('impide iniciar o entrar a otra llamada mientras se esta en una', async () => {
      const { ana, luis } = await threePeople();
      const first = await call('POST', '/api/v1/videocalls', { token: ana.token });
      await call('POST', '/api/v1/videocalls', { token: luis.token });

      const again = await call('POST', '/api/v1/videocalls', { token: ana.token });
      const cross = await call('POST', `/api/v1/videocalls/${first.json.id}/join`, { token: luis.token });

      assert.equal(again.status, 409);
      assert.equal(again.json.code, 'ALREADY_IN_CALL');
      assert.equal(cross.json.code, 'ALREADY_IN_CALL');
    });

    it('al salir alguien se libera el lugar; quien no participa no puede salir', async () => {
      const { ana, luis, carla } = await threePeople();
      const { json } = await call('POST', '/api/v1/videocalls', { token: ana.token });
      await call('POST', `/api/v1/videocalls/${json.id}/join`, { token: luis.token });

      const outsider = await call('POST', `/api/v1/videocalls/${json.id}/leave`, { token: carla.token });
      const left = await call('POST', `/api/v1/videocalls/${json.id}/leave`, { token: luis.token });
      const joined = await call('POST', `/api/v1/videocalls/${json.id}/join`, { token: carla.token });

      assert.equal(outsider.status, 403);
      assert.equal(outsider.json.code, 'NOT_A_PARTICIPANT');
      assert.equal(left.status, 204);
      assert.equal(joined.status, 200);
    });

    it('exige token en todas sus rutas', async () => {
      const responses = await Promise.all([
        call('POST', '/api/v1/videocalls'),
        call('GET', `/api/v1/videocalls/${UNKNOWN_CALL_ID}`),
        call('POST', `/api/v1/videocalls/${UNKNOWN_CALL_ID}/join`),
        call('POST', `/api/v1/videocalls/${UNKNOWN_CALL_ID}/leave`),
      ]);

      assert.deepEqual(responses.map((response) => response.status), [401, 401, 401, 401]);
    });
  });

  describe('cierre de sesion', () => {
    it('revoca el token: usarlo despues responde 401', async () => {
      const ana = await login('Ana');

      const logout = await call('POST', '/api/v1/auth/logout', { token: ana.token });
      const reused = await call('GET', '/api/v1/users', { token: ana.token });
      const twice = await call('POST', '/api/v1/auth/logout', { token: ana.token });

      assert.equal(logout.status, 204);
      assert.equal(reused.status, 401);
      assert.equal(reused.json.code, 'TOKEN_INVALID');
      assert.equal(twice.status, 401);
    });

    it('exige token para cerrar sesion', async () => {
      const response = await call('POST', '/api/v1/auth/logout');

      assert.equal(response.status, 401);
      assert.equal(response.json.code, 'TOKEN_MISSING');
    });

    it('saca a la persona de su videollamada y libera su nombre', async () => {
      const { ana, luis } = await threePeople();
      const { json } = await call('POST', '/api/v1/videocalls', { token: ana.token });
      await call('POST', `/api/v1/videocalls/${json.id}/join`, { token: luis.token });

      await call('POST', '/api/v1/auth/logout', { token: luis.token });
      const shown = await call('GET', `/api/v1/videocalls/${json.id}`, { token: ana.token });
      const relogin = await call('POST', '/api/v1/auth/login', {
        body: { acceptedRules: true, name: 'Luis', inviteToken: ana.room.inviteToken },
      });

      assert.deepEqual(shown.json.participants.map((person) => person.name), ['Ana']);
      assert.equal(shown.json.status, 'waiting');
      assert.equal(relogin.status, 201);
    });

    it('la sala sigue abierta mientras haya sesiones de la API y se cierra tras la ultima', async () => {
      const ana = await login('Ana');
      await wait(EMPTY_ROOM_TTL_MS * 2);

      const stillOpen = await call('GET', '/api/v1/users', { token: ana.token });
      await call('POST', '/api/v1/auth/logout', { token: ana.token });
      await wait(EMPTY_ROOM_TTL_MS * 2);
      const closed = await call('POST', '/api/v1/auth/login', {
        body: { acceptedRules: true, name: 'Luis', inviteToken: ana.room.inviteToken },
      });

      assert.equal(stillOpen.status, 200);
      assert.equal(closed.status, 404);
    });
  });

  it('responde 503 SERVER_FULL si no caben mas salas o sesiones', async () => {
    await stopServer(server);
    server = createTestServer({ maxRooms: 1, sessions: new SessionStore({ maxSessions: 1 }) });
    baseUrl = `http://127.0.0.1:${await startServer(server)}`;
    const ana = await login('Ana');

    const noRoom = await call('POST', '/api/v1/auth/login', { body: { acceptedRules: true, name: 'Eva' } });
    const noSession = await call('POST', '/api/v1/auth/login', {
      body: { acceptedRules: true, name: 'Luis', inviteToken: ana.room.inviteToken },
    });

    assert.equal(noRoom.status, 503);
    assert.equal(noRoom.json.code, 'SERVER_FULL');
    assert.equal(noSession.status, 503);
    assert.equal(noSession.json.code, 'SERVER_FULL');
  });

  it('responde 404 con codigo a rutas de la API que no existen', async () => {
    const response = await call('GET', '/api/v1/nada');

    assert.equal(response.status, 404);
    assert.deepEqual(response.json, { error: 'No encontrado', code: 'NOT_FOUND' });
  });
});
