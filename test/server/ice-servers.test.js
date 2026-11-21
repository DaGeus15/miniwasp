import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  CloudflareTurnServers,
  DEFAULT_TURN_TTL_SECONDS,
  StaticIceServers,
  sanitizeIceServers,
} from '../../src/server/calls/ice-server-provider.js';
import { NOT_IN_CALL_CODE } from '../../src/server/http/ice-servers-endpoint.js';
import { ClientEvent, ServerEvent } from '../../src/shared/events.js';
import { createRecordingLogger } from '../support/recording-logger.js';
import { startRoomServer } from '../support/test-server.js';
import { openClient, stopServer } from '../support/ws-client.js';

const STUN = [{ urls: 'stun:stun.test:3478' }];
const CLOUDFLARE_RESPONSE = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'usuario',
      credential: 'clave',
    },
  ],
};

function fakeFetch(respond) {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return respond();
  };
  return { fetch, requests };
}

function jsonResponse(payload, status = 201) {
  return { ok: status < 300, status, json: async () => payload };
}

function createTurn(respond) {
  const { logger, events } = createRecordingLogger();
  const { fetch, requests } = fakeFetch(respond);
  const turn = new CloudflareTurnServers({ keyId: 'clave-1', apiToken: 'secreto', fallback: STUN, logger, fetch });
  return { turn, requests, events };
}

describe('servidores ICE: limpieza de la respuesta', () => {
  it('descarta el puerto 53, esquemas ajenos y credenciales que no son texto', () => {
    assert.deepEqual(
      sanitizeIceServers([
        { urls: 'stun:a.test:53' },
        { urls: ['http://a.test', 'turn:a.test:3478?transport=udp'], username: 'u', credential: 7 },
        { urls: 'turns:a.test:443?transport=tcp', username: 'u', credential: 'c' },
        null,
      ]),
      [
        { urls: ['turn:a.test:3478?transport=udp'] },
        { urls: ['turns:a.test:443?transport=tcp'], username: 'u', credential: 'c' },
      ],
    );
    assert.deepEqual(sanitizeIceServers('no es lista'), []);
  });

  it('sin clave TURN entrega siempre los STUN de la configuracion', async () => {
    assert.deepEqual(await new StaticIceServers(STUN).forCall(), STUN);
  });
});

describe('servidores ICE: credenciales TURN de Cloudflare', () => {
  it('pide credenciales de corta duracion con la clave del servidor y las entrega limpias', async () => {
    const { turn, requests } = createTurn(() => jsonResponse(CLOUDFLARE_RESPONSE));

    const iceServers = await turn.forCall();

    assert.deepEqual(iceServers, [
      { urls: ['stun:stun.cloudflare.com:3478'] },
      {
        urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
        username: 'usuario',
        credential: 'clave',
      },
    ]);
    const [request] = requests;
    assert.equal(request.url, 'https://rtc.live.cloudflare.com/v1/turn/keys/clave-1/credentials/generate-ice-servers');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.Authorization, 'Bearer secreto');
    assert.deepEqual(request.body, { ttl: DEFAULT_TURN_TTL_SECONDS });
    assert.ok(request.signal instanceof AbortSignal);
  });

  it('si Cloudflare falla, responde vacio o no se alcanza, la llamada sigue con STUN', async () => {
    const failures = [
      () => jsonResponse({ error: 'no' }, 401),
      () => jsonResponse({ iceServers: [] }),
      () => {
        throw new Error('sin red');
      },
    ];
    for (const respond of failures) {
      const { turn, events } = createTurn(respond);

      assert.deepEqual(await turn.forCall(), STUN);
      assert.deepEqual(events(), ['warn:turn.credentials_failed']);
    }
  });
});

async function nextOfType(client, type) {
  let event = await client.next();
  while (event.type !== type) {
    event = await client.next();
  }
  return event;
}

describe('servidores ICE por HTTP', () => {
  let room;

  // Entra a la sala por WebSocket con un nombre (sin nombre no se puede llamar).
  async function joinAs(cookie, name) {
    const client = openClient(room.wsUrl, { headers: { Cookie: cookie }, ignoredEvents: [ServerEvent.HISTORY] });
    await client.opened;
    const { peerId } = await nextOfType(client, ServerEvent.WELCOME);
    client.send({ type: ClientEvent.PRESENCE, name });
    await nextOfType(client, ServerEvent.PRESENCE);
    return { ...client, peerId, cookie };
  }

  afterEach(async () => {
    await stopServer(room.server);
  });

  function requestIceServers(cookie) {
    return fetch(`${room.httpUrl}/rooms/ice-servers`, { headers: cookie ? { Cookie: cookie } : {} });
  }

  it('sin sesion de sala no hay servidores, y estar en una sala no basta: hace falta una llamada', async () => {
    room = await startRoomServer();

    const anonymous = await requestIceServers();
    const member = await requestIceServers(room.ownerCookie);

    assert.equal(anonymous.status, 401);
    assert.equal(member.status, 409);
    assert.equal((await member.json()).code, NOT_IN_CALL_CODE);
  });

  it('durante una llamada entrega los servidores sin cache', async () => {
    const turnServers = [{ urls: ['turn:turn.test:3478'], username: 'u', credential: 'c' }];
    room = await startRoomServer({ iceServerProvider: { forCall: async () => turnServers } });
    const ana = await joinAs(room.ownerCookie, 'Ana');
    const luis = await joinAs(await room.memberCookie(), 'Luis');
    ana.send({ type: ClientEvent.CALL_INVITE, to: luis.peerId });
    await nextOfType(luis, ServerEvent.CALL_INCOMING);

    const response = await requestIceServers(luis.cookie);
    for (const client of [ana, luis]) {
      client.socket.terminate();
    }

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { iceServers: turnServers });
    assert.match(response.headers.get('cache-control'), /no-store/);
  });

  it('limita cuantas veces se piden por IP y por sesion', async () => {
    for (const limiter of ['iceServerLimiter', 'iceServerSessionLimiter']) {
      room = await startRoomServer({ [limiter]: { allow: () => false } });

      assert.equal((await requestIceServers(room.ownerCookie)).status, 429);
      await stopServer(room.server);
    }
    room = await startRoomServer();
  });
});
