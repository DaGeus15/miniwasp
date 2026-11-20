import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { Server as HttpsServer } from 'node:https';
import { join, relative } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { Room } from '../../src/server/rooms/room.js';
import { ConnectionGuard } from '../../src/server/security/connection-guard.js';
import { createRateLimiter } from '../../src/server/security/rate-limiter.js';
import { ClientEvent, ServerEvent } from '../../src/shared/events.js';
import { createRoomCookie, createTestServer, startRoomServer } from '../support/test-server.js';
import {
  expectRejection,
  expectSilence,
  openClient,
  startServer,
  stopServer,
} from '../support/ws-client.js';

const SOURCE_DIRECTORY = fileURLToPath(new URL('../../src/', import.meta.url));
const CLOSE_PROPAGATION_MS = 50;

async function listJavaScriptFiles(directory) {
  const entries = await readdir(join(SOURCE_DIRECTORY, directory), {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => relative(SOURCE_DIRECTORY, join(entry.parentPath, entry.name)))
    .map((path) => path.replaceAll('\\', '/'));
}

function sendRawRequest(port, path) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path }, (response) => {
      response.resume();
      resolve(response);
    });
    request.on('error', reject);
    request.end();
  });
}

// Arranca un servidor con una sala ya creada; todos los clientes comparten esa sesion.
async function startWithRoom(options) {
  const server = createTestServer(options);
  const port = await startServer(server);
  const httpUrl = `http://127.0.0.1:${port}`;
  const cookie = await createRoomCookie(httpUrl);
  const wsUrl = `ws://127.0.0.1:${port}`;
  const connect = async (extraOptions = {}) => {
    const { headers = {}, ...rest } = extraOptions;
    const client = openClient(wsUrl, { headers: { Cookie: cookie, ...headers }, ...rest });
    await client.opened;
    return client;
  };
  return { server, port, httpUrl, wsUrl, cookie, connect };
}

describe('servidor HTTP', () => {
  let server;
  let port;
  let httpUrl;

  before(async () => {
    server = createTestServer();
    port = await startServer(server);
    httpUrl = `http://127.0.0.1:${port}`;
  });

  after(() => stopServer(server));

  it('sirve la pagina principal y sus recursos', async () => {
    const page = await fetch(httpUrl);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);

    const script = await fetch(`${httpUrl}/client/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);

    const styles = await fetch(`${httpUrl}/client/styles/style.css`);
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get('content-type'), /text\/css/);

    const privacy = await fetch(`${httpUrl}/privacy.html`);
    assert.equal(privacy.status, 200);
  });

  it('sirve todos los modulos JavaScript del frontend', async () => {
    const modules = [
      ...(await listJavaScriptFiles('client')),
      ...(await listJavaScriptFiles('shared')),
    ];

    assert.ok(modules.length > 0);
    for (const file of modules) {
      const response = await fetch(`${httpUrl}/${file}`);
      assert.equal(response.status, 200, `falta publicar ${file}`);
    }
  });

  it('nunca publica el codigo del servidor', async () => {
    for (const file of await listJavaScriptFiles('server')) {
      const response = await fetch(`${httpUrl}/${file}`);
      assert.equal(response.status, 404, `se publico ${file}`);
    }
  });

  it('responde 404 en JSON a rutas desconocidas', async () => {
    const response = await fetch(`${httpUrl}/no-existe`);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'No encontrado', code: 'NOT_FOUND' });
  });

  it('responde 405 e indica los metodos permitidos', async () => {
    const asset = await fetch(httpUrl, { method: 'POST' });
    assert.equal(asset.status, 405);
    assert.equal(asset.headers.get('allow'), 'GET, HEAD');

    const endpoint = await fetch(`${httpUrl}/healthz`, { method: 'DELETE' });
    assert.equal(endpoint.status, 405);
    assert.equal(endpoint.headers.get('allow'), 'GET');
  });

  it('responde HEAD sin cuerpo', async () => {
    const response = await fetch(httpUrl, { method: 'HEAD' });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
  });

  it('responde 400 y no 500 a una URL malformada', async () => {
    const response = await sendRawRequest(port, '//[');

    assert.equal(response.statusCode, 400);
  });

  it('identifica cada respuesta para poder rastrearla en los registros', async () => {
    const [first, second] = await Promise.all([fetch(httpUrl), fetch(httpUrl)]);

    assert.match(first.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    assert.notEqual(first.headers.get('x-request-id'), second.headers.get('x-request-id'));
  });

  it('protege todas las respuestas con cabeceras de seguridad', async () => {
    for (const path of ['/', '/no-existe', '/healthz']) {
      const response = await fetch(`${httpUrl}${path}`);

      assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
      assert.equal(response.headers.get('cache-control'), 'no-cache, no-store, must-revalidate');
    }
  });

  it('no envia HSTS por HTTP', async () => {
    const response = await fetch(httpUrl);

    assert.equal(response.headers.get('strict-transport-security'), null);
  });

  it('informa su estado de salud', async () => {
    const response = await fetch(`${httpUrl}/healthz`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });
});

describe('chat de una sala', () => {
  let context;
  const clients = [];

  async function connect() {
    const client = await context.connect();
    clients.push(client);
    return client;
  }

  before(async () => {
    context = await startWithRoom();
  });

  after(async () => {
    for (const { socket } of clients) {
      socket.terminate();
    }
    await stopServer(context.server);
  });

  it('reenvia cada mensaje a todos los clientes de la sala', async () => {
    const first = await connect();
    const second = await connect();
    await first.next();
    await second.next();

    first.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Ana', text: 'hola' });

    const [delivered, echoed] = await Promise.all([second.next(), first.next()]);
    assert.equal(delivered.type, ServerEvent.MESSAGE);
    assert.equal(delivered.message.name, 'Ana');
    assert.equal(delivered.message.text, 'hola');
    assert.equal(echoed.message.id, delivered.message.id);
  });

  it('envia el historial de la sala a quien se conecta despues', async () => {
    const late = await connect();
    const history = await late.next();

    assert.equal(history.type, ServerEvent.HISTORY);
    assert.ok(history.messages.some((message) => message.text === 'hola'));
  });

  it('informa el error solo a quien envio un mensaje invalido', async () => {
    const sender = await connect();
    const bystander = await connect();
    await sender.next();
    await bystander.next();

    sender.socket.send('esto no es json');
    const reply = await sender.next();
    assert.equal(reply.type, ServerEvent.ERROR);

    assert.equal(await expectSilence(bystander), true);
  });

  it('un mensaje invalido no cambia el nombre de quien lo envia', async () => {
    const sender = await connect();
    await sender.next();

    sender.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Nombre nuevo', text: '   ' });

    assert.equal((await sender.next()).type, ServerEvent.ERROR);
    assert.equal(await expectSilence(sender), true);
  });
});

describe('control de origen', () => {
  let context;

  before(async () => {
    context = await startWithRoom();
  });

  after(() => stopServer(context.server));

  it('rechaza conexiones desde otra pagina web aunque tengan sesion', async () => {
    const socket = new WebSocket(context.wsUrl, {
      origin: 'http://atacante.test',
      headers: { Cookie: context.cookie },
    });

    assert.match(await expectRejection(socket), /401/);
  });

  it('acepta conexiones desde su propia pagina', async () => {
    const socket = new WebSocket(context.wsUrl, {
      origin: context.httpUrl,
      headers: { Cookie: context.cookie },
    });

    await once(socket, 'open');
    assert.equal(socket.readyState, WebSocket.OPEN);

    socket.terminate();
  });
});

describe('limite de conexiones', () => {
  it('rechaza el exceso y libera el cupo al desconectarse', async () => {
    const context = await startWithRoom({
      connectionGuard: new ConnectionGuard({ maxConnectionsPerAddress: 1 }),
    });

    const first = await context.connect();
    const rejected = new WebSocket(context.wsUrl, { headers: { Cookie: context.cookie } });
    assert.match(await expectRejection(rejected), /503/);

    first.socket.terminate();
    await wait(CLOSE_PROPAGATION_MS);

    const replacement = await context.connect();

    replacement.socket.terminate();
    await stopServer(context.server);
  });
});

describe('direccion del cliente detras de Cloudflare', () => {
  const SINGLE_MESSAGE_RATE = { limit: 1, windowMs: 60000 };

  async function sendHelloFrom(context, address) {
    const client = await context.connect({ headers: { 'CF-Connecting-IP': address } });
    await client.next();
    client.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Ana', text: 'hola' });
    return client;
  }

  it('cuenta los limites por persona real y no por el tunel', async () => {
    const context = await startWithRoom({
      chatLimiter: createRateLimiter(SINGLE_MESSAGE_RATE),
      trustedProxyHeader: 'cf-connecting-ip',
    });

    const first = await sendHelloFrom(context, '203.0.113.1');
    assert.equal((await first.next()).type, ServerEvent.MESSAGE);

    const second = await sendHelloFrom(context, '203.0.113.2');
    assert.equal((await second.next()).type, ServerEvent.MESSAGE);

    first.socket.terminate();
    second.socket.terminate();
    await stopServer(context.server);
  });

  it('ignora la cabecera si no se confia en Cloudflare', async () => {
    const context = await startWithRoom({ chatLimiter: createRateLimiter(SINGLE_MESSAGE_RATE) });

    const first = await sendHelloFrom(context, '203.0.113.1');
    assert.equal((await first.next()).type, ServerEvent.MESSAGE);

    const spoofing = await sendHelloFrom(context, '203.0.113.2');
    assert.equal((await spoofing.next()).type, ServerEvent.ERROR);

    first.socket.terminate();
    spoofing.socket.terminate();
    await stopServer(context.server);
  });

  it('envia HSTS porque el tunel publica con HTTPS', async () => {
    const server = createTestServer({ trustedProxyHeader: 'cf-connecting-ip' });
    const response = await fetch(`http://127.0.0.1:${await startServer(server)}/`);

    assert.match(response.headers.get('strict-transport-security'), /max-age=31536000/);

    await stopServer(server);
  });

  it('la respuesta que abre el WebSocket tambien lleva HSTS', async () => {
    const room = await startRoomServer({ trustedProxyHeader: 'cf-connecting-ip' });
    const socket = new WebSocket(room.wsUrl, { headers: { Cookie: room.ownerCookie, Origin: room.httpUrl } });
    const [response] = await once(socket, 'upgrade');

    assert.match(response.headers['strict-transport-security'], /max-age=31536000/);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');

    socket.terminate();
    await stopServer(room.server);
  });
});

describe('heartbeat', () => {
  it('mantiene viva la conexion enviando pings', async () => {
    const context = await startWithRoom({ heartbeatIntervalMs: 10 });
    const client = await context.connect();

    await once(client.socket, 'ping');
    await once(client.socket, 'ping');
    assert.equal(client.socket.readyState, WebSocket.OPEN);

    client.socket.terminate();
    await stopServer(context.server);
  });
});

describe('TLS', () => {
  it('usa HTTPS cuando se configura un certificado', () => {
    assert.ok(createTestServer({ tls: {} }).listener instanceof HttpsServer);
  });
});

describe('apagado ordenado', () => {
  it('avisa a los clientes que el servidor se va', async () => {
    const context = await startWithRoom();
    const client = await context.connect();
    const closed = once(client.socket, 'close');

    await stopServer(context.server);

    const [closeCode] = await closed;
    assert.equal(closeCode, 1001);
  });
});

describe('limite de mensajes', () => {
  it('rechaza el exceso sin reenviarlo a nadie', async () => {
    const context = await startWithRoom({
      chatLimiter: createRateLimiter({ limit: 2, windowMs: 60000 }),
    });
    const client = await context.connect();
    await client.next();

    const send = (text) => client.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Ana', text });
    send('uno');
    send('dos');
    send('tres');

    assert.equal((await client.next()).type, ServerEvent.MESSAGE);
    assert.equal((await client.next()).type, ServerEvent.MESSAGE);
    const rejected = await client.next();
    assert.equal(rejected.type, ServerEvent.ERROR);
    assert.match(rejected.error, /muy rápido/);

    const late = await context.connect();
    const history = await late.next();
    assert.deepEqual(history.messages.map((message) => message.text), ['uno', 'dos']);

    client.socket.terminate();
    late.socket.terminate();
    await stopServer(context.server);
  });
});

describe('mensajes que superan el limite de tamano', () => {
  it('cierra esa conexion y el servidor sigue atendiendo a los demas', async () => {
    const context = await startWithRoom();

    const attacker = await context.connect();
    const closed = once(attacker.socket, 'close');
    attacker.socket.send('a'.repeat(40000));
    const [closeCode] = await closed;
    assert.equal(closeCode, 1009);

    const survivor = await context.connect();
    assert.equal((await survivor.next()).type, ServerEvent.HISTORY);

    survivor.socket.terminate();
    await stopServer(context.server);
  });
});

describe('errores internos del servidor', () => {
  it('registra el error y no revela su detalle', async () => {
    const loggedEvents = [];
    const createBrokenRoom = () => {
      const room = new Room();
      room.chat.post = () => {
        throw new Error('detalle interno secreto');
      };
      return room;
    };
    const context = await startWithRoom({
      createRoom: createBrokenRoom,
      logger: { error: (event) => loggedEvents.push(event), info() {}, warn() {} },
    });
    const client = await context.connect();
    await client.next();

    client.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Ana', text: 'hola' });
    const reply = await client.next();

    assert.equal(reply.type, ServerEvent.ERROR);
    assert.doesNotMatch(reply.error, /secreto/);
    assert.deepEqual(loggedEvents, ['message.failed']);

    client.socket.terminate();
    await stopServer(context.server);
  });
});
