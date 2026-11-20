import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { MemoryBlobStorage } from '../../src/server/attachments/memory-blob-storage.js';
import { createRateLimiter } from '../../src/server/security/rate-limiter.js';
import { SessionStore } from '../../src/server/security/session-store.js';
import { ServerEvent } from '../../src/shared/events.js';
import { createTestServer, joinRoomCookie } from '../support/test-server.js';
import { openClient, startServer, stopServer } from '../support/ws-client.js';

const NOTE = Buffer.from('hola desde la API\n');
const PDF = Buffer.from('%PDF-1.7\nhola');
const EXECUTABLE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const BLOCKED_TEXT = 'vendo cocaina';

function createFakeInspector() {
  return { async inspect(bytes) { return { allowed: true, bytes }; }, async close() {} };
}

let server;
let baseUrl;
let wsUrl;

async function start(options = {}) {
  server = createTestServer({
    sessions: new SessionStore({ ttlMs: 60000 }),
    imageInspector: createFakeInspector(),
    chatLimiter: createRateLimiter({ limit: 100, windowMs: 60000 }),
    roomJoinLimiter: createRateLimiter({ limit: 100, windowMs: 60000 }),
    ...options,
  });
  const port = await startServer(server);
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}`;
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const isJson = body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(isJson || typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: isJson ? JSON.stringify(body) : body,
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : null };
}

async function login(name, inviteToken) {
  const response = await call('POST', '/api/v1/auth/login', { body: { acceptedRules: true, name, inviteToken } });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  return { token: response.json.accessToken, ...response.json };
}

async function roomOf(...names) {
  const owner = await login(names[0]);
  const members = [owner];
  for (const name of names.slice(1)) {
    members.push(await login(name, owner.room.inviteToken));
  }
  return members;
}

const sendMessage = (token, body) => call('POST', '/api/v1/messages', { token, body });
const listMessages = async (token) => (await call('GET', '/api/v1/messages', { token })).json.messages;
const deleteMessage = (token, id) => call('DELETE', `/api/v1/messages/${id}`, { token });
const reportMessage = (token, id) => call('POST', `/api/v1/messages/${id}/report`, { token });

function upload(token, bytes, fileName = 'nota.txt') {
  return call('POST', '/api/v1/attachments', {
    token,
    body: bytes,
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(fileName) },
  });
}

function download(token, id, headers = {}) {
  return fetch(`${baseUrl}/api/v1/attachments/${id}`, { headers: { Authorization: `Bearer ${token}`, ...headers } });
}

afterEach(async () => {
  if (server) {
    await stopServer(server);
    server = null;
  }
});

describe('API REST: mensajes', () => {
  it('lista, envia con el nombre de la sesion y lo ve el resto de la sala', async () => {
    await start();
    const [ana, luis] = await roomOf('Ana', 'Luis');
    assert.deepEqual(await listMessages(ana.token), []);

    const response = await sendMessage(ana.token, { text: '  hola sala  ', name: 'Impostora' });

    assert.equal(response.status, 201);
    const { message } = response.json;
    assert.deepEqual(Object.keys(message).sort(), ['id', 'name', 'text', 'time']);
    assert.equal(message.name, 'Ana');
    assert.equal(message.text, 'hola sala');
    assert.deepEqual(await listMessages(luis.token), [message]);
  });

  it('los mensajes de la API llegan por WebSocket a quien usa el navegador en la sala', async () => {
    await start();
    const [ana] = await roomOf('Ana');
    const cookie = await joinRoomCookie(baseUrl, ana.room.inviteToken);
    const browser = openClient(wsUrl, { headers: { Cookie: cookie } });
    assert.equal((await browser.next()).type, ServerEvent.HISTORY);

    const { json } = await sendMessage(ana.token, { text: 'desde la API' });
    const event = await browser.next();
    browser.socket.terminate();

    assert.equal(event.type, ServerEvent.MESSAGE);
    assert.deepEqual(event.message, json.message);
  });

  it('valida el texto y el cuerpo con 400, 413 y 415', async () => {
    await start();
    const [ana] = await roomOf('Ana');
    const cases = [
      [{}, 400, 'INVALID_INPUT'],
      [{ text: '   ' }, 400, 'INVALID_INPUT'],
      [{ text: 42 }, 400, 'INVALID_INPUT'],
      [{ text: 'x'.repeat(501) }, 400, 'INVALID_INPUT'],
      ['{malo', 400, 'BAD_REQUEST'],
      [JSON.stringify({ text: 'a'.repeat(9000) }), 413, 'PAYLOAD_TOO_LARGE'],
    ];
    for (const [body, status, code] of cases) {
      const response = await sendMessage(ana.token, body);
      assert.equal(response.status, status, JSON.stringify(body).slice(0, 60));
      assert.equal(response.json.code, code);
    }
    const notJson = await call('POST', '/api/v1/messages', {
      token: ana.token,
      body: 'hola',
      headers: { 'Content-Type': 'text/plain' },
    });
    assert.equal(notJson.status, 415);
    assert.deepEqual(await listMessages(ana.token), []);
  });

  it('acepta 500 caracteres aunque el JSON los escape y ocupe mas de 1 KiB', async () => {
    await start();
    const [ana] = await roomOf('Ana');

    const escapedText = String.raw`ñ`.repeat(500);
    const response = await sendMessage(ana.token, `{"text":"${escapedText}"}`);

    assert.equal(response.status, 201);
    assert.equal(response.json.message.text, 'ñ'.repeat(500));
  });

  it('bloquea contenido prohibido con 422 y, tras varias faltas, silencia con 429', async () => {
    await start();
    const [ana] = await roomOf('Ana');

    const blocked = await sendMessage(ana.token, { text: BLOCKED_TEXT });
    assert.equal(blocked.status, 422);
    assert.equal(blocked.json.code, 'CONTENT_BLOCKED');
    assert.deepEqual(await listMessages(ana.token), []);

    await sendMessage(ana.token, { text: BLOCKED_TEXT });
    await sendMessage(ana.token, { text: BLOCKED_TEXT });
    const muted = await sendMessage(ana.token, { text: 'ya me porto bien' });

    assert.equal(muted.status, 429);
    assert.equal(muted.json.code, 'SENDER_MUTED');
    assert.equal(muted.headers.get('retry-after'), '600');
  });

  it('limita el envio por direccion con 429 RATE_LIMITED', async () => {
    await start({ chatLimiter: createRateLimiter({ limit: 2, windowMs: 60000 }) });
    const [ana] = await roomOf('Ana');
    await sendMessage(ana.token, { text: 'uno' });
    await sendMessage(ana.token, { text: 'dos' });

    const response = await sendMessage(ana.token, { text: 'tres' });

    assert.equal(response.status, 429);
    assert.equal(response.json.code, 'RATE_LIMITED');
    assert.equal(response.headers.get('retry-after'), '5');
  });
});

describe('API REST: borrar y reportar mensajes', () => {
  it('su autor borra con 204 y desaparece para la sala', async () => {
    await start();
    const [ana, luis] = await roomOf('Ana', 'Luis');
    const { json } = await sendMessage(luis.token, { text: 'me equivoque' });

    const response = await deleteMessage(luis.token, json.message.id);

    assert.equal(response.status, 204);
    assert.deepEqual(await listMessages(ana.token), []);
  });

  it('otra persona recibe 403 NOT_MESSAGE_AUTHOR; quien creo la sala si puede borrar', async () => {
    await start();
    const [ana, luis, carla] = await roomOf('Ana', 'Luis', 'Carla');
    const { json } = await sendMessage(luis.token, { text: 'mensaje de Luis' });

    const forbidden = await deleteMessage(carla.token, json.message.id);
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.json.code, 'NOT_MESSAGE_AUTHOR');
    assert.equal((await listMessages(ana.token)).length, 1);

    const byOwner = await deleteMessage(ana.token, json.message.id);
    assert.equal(byOwner.status, 204);
    assert.deepEqual(await listMessages(ana.token), []);
  });

  it('borrar un mensaje inexistente es idempotente (204)', async () => {
    await start();
    const [, luis] = await roomOf('Ana', 'Luis');

    assert.equal((await deleteMessage(luis.token, UNKNOWN_ID)).status, 204);
  });

  it('un reporte responde 202 y tres personas distintas borran el mensaje', async () => {
    await start();
    const [ana, luis, carla, diego] = await roomOf('Ana', 'Luis', 'Carla', 'Diego');
    const { json } = await sendMessage(luis.token, { text: 'mensaje molesto' });
    const { id } = json.message;

    const first = await reportMessage(ana.token, id);
    assert.equal(first.status, 202);
    assert.deepEqual(first.json, { status: 'reported' });
    await reportMessage(ana.token, id);
    await reportMessage(luis.token, id);
    await reportMessage(carla.token, id);
    assert.equal((await listMessages(ana.token)).length, 1);

    await reportMessage(diego.token, id);
    assert.deepEqual(await listMessages(ana.token), []);
    assert.equal((await reportMessage(ana.token, UNKNOWN_ID)).status, 202);
  });

  it('limita los reportes con su propio limitador', async () => {
    await start({ reportLimiter: createRateLimiter({ limit: 1, windowMs: 60000 }) });
    const [ana] = await roomOf('Ana');

    await reportMessage(ana.token, UNKNOWN_ID);
    const response = await reportMessage(ana.token, UNKNOWN_ID);

    assert.equal(response.status, 429);
    assert.equal(response.json.code, 'RATE_LIMITED');
    assert.equal(response.headers.get('retry-after'), '60');
  });
});

describe('API REST: adjuntos', () => {
  it('sube un texto, se envia en un mensaje y otra persona de la sala lo descarga', async () => {
    await start();
    const [ana, luis] = await roomOf('Ana', 'Luis');

    const uploaded = await upload(ana.token, NOTE, 'nota final.exe');
    assert.equal(uploaded.status, 201);
    const attachment = uploaded.json;
    assert.deepEqual(attachment, {
      id: attachment.id,
      kind: 'document',
      mimeType: 'text/plain',
      fileName: 'nota final.txt',
      size: NOTE.length,
    });

    const pending = await download(ana.token, attachment.id);
    assert.equal(pending.status, 404);
    assert.equal((await pending.json()).code, 'ATTACHMENT_NOT_FOUND');

    const sent = await sendMessage(ana.token, { attachmentId: attachment.id });
    assert.equal(sent.status, 201);
    assert.deepEqual(sent.json.message.attachment, attachment);
    assert.equal(sent.json.message.text, '');

    const file = await download(luis.token, attachment.id);
    assert.equal(file.status, 200);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), NOTE);
    assert.match(file.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''nota%20final\.txt$/);
    assert.equal(file.headers.get('content-security-policy'), "default-src 'none'; sandbox");
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.match(file.headers.get('cache-control'), /no-store/);
  });

  it('admite rangos de bytes (206) y rechaza rangos imposibles (416)', async () => {
    await start();
    const [ana] = await roomOf('Ana');
    const { json: attachment } = await upload(ana.token, PDF, 'informe.pdf');
    await sendMessage(ana.token, { text: 'el informe', attachmentId: attachment.id });

    const part = await download(ana.token, attachment.id, { Range: 'bytes=0-3' });
    const outside = await download(ana.token, attachment.id, { Range: 'bytes=500-' });

    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), `bytes 0-3/${PDF.length}`);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), PDF.subarray(0, 4));
    assert.equal(outside.status, 416);
  });

  it('un adjunto se envia una sola vez y solo quien lo subio puede enviarlo', async () => {
    await start();
    const [ana, luis] = await roomOf('Ana', 'Luis');
    const { json: attachment } = await upload(ana.token, NOTE);

    const byOther = await sendMessage(luis.token, { attachmentId: attachment.id });
    assert.equal(byOther.status, 404);
    assert.equal(byOther.json.code, 'ATTACHMENT_NOT_FOUND');

    assert.equal((await sendMessage(ana.token, { attachmentId: attachment.id })).status, 201);
    const again = await sendMessage(ana.token, { attachmentId: attachment.id });
    assert.equal(again.status, 404);
    assert.equal(again.json.code, 'ATTACHMENT_NOT_FOUND');
    assert.equal((await sendMessage(ana.token, { attachmentId: UNKNOWN_ID })).status, 404);
  });

  it('un mensaje bloqueado no consume el adjunto', async () => {
    await start();
    const [ana] = await roomOf('Ana');
    const { json: attachment } = await upload(ana.token, NOTE);

    const blocked = await sendMessage(ana.token, { text: BLOCKED_TEXT, attachmentId: attachment.id });
    const retried = await sendMessage(ana.token, { text: 'ahora si', attachmentId: attachment.id });

    assert.equal(blocked.status, 422);
    assert.equal(retried.status, 201);
  });

  it('rechaza ejecutables (415), nombres ofensivos (422) y textos ofensivos (422)', async () => {
    const storage = new MemoryBlobStorage();
    await start({ blobStorage: storage });
    const [ana] = await roomOf('Ana');

    const executable = await upload(ana.token, EXECUTABLE, 'foto.jpg');
    const badName = await upload(ana.token, PDF, `${BLOCKED_TEXT}.pdf`);
    const badText = await upload(ana.token, Buffer.from(`hola, ${BLOCKED_TEXT}`));

    assert.equal(executable.status, 415);
    assert.equal(executable.json.code, 'FILE_TYPE_NOT_ALLOWED');
    assert.equal(badName.status, 422);
    assert.equal(badName.json.code, 'CONTENT_BLOCKED');
    assert.equal(badText.status, 422);
    assert.equal(storage.usedBytes, 0);
  });

  it('rechaza archivos demasiado grandes con 413', async () => {
    await start();
    const [ana] = await roomOf('Ana');

    const response = await upload(ana.token, Buffer.alloc(1024 * 1024 + 1, 0x61));

    assert.equal(response.status, 413);
    assert.equal(response.json.code, 'FILE_TOO_LARGE');
  });

  it('limita las subidas por direccion con 429 RATE_LIMITED', async () => {
    await start({ attachmentLimiter: createRateLimiter({ limit: 1, windowMs: 60000 }) });
    const [ana] = await roomOf('Ana');
    await upload(ana.token, NOTE);

    const response = await upload(ana.token, NOTE);

    assert.equal(response.status, 429);
    assert.equal(response.json.code, 'RATE_LIMITED');
    assert.equal(response.headers.get('retry-after'), '30');
  });
});

describe('API REST: aislamiento entre salas y autenticacion', () => {
  it('otra sala no ve, no descarga, no borra ni reporta mensajes ajenos', async () => {
    await start();
    const [ana] = await roomOf('Ana');
    const [bruno] = await roomOf('Bruno');
    const { json: attachment } = await upload(ana.token, NOTE);
    const { json } = await sendMessage(ana.token, { text: 'solo para mi sala', attachmentId: attachment.id });

    assert.deepEqual(await listMessages(bruno.token), []);
    const file = await download(bruno.token, attachment.id);
    assert.equal(file.status, 404);
    assert.equal((await file.json()).code, 'ATTACHMENT_NOT_FOUND');
    assert.equal((await deleteMessage(bruno.token, json.message.id)).status, 204);
    assert.equal((await reportMessage(bruno.token, json.message.id)).status, 202);
    assert.equal((await sendMessage(bruno.token, { attachmentId: attachment.id })).status, 404);

    assert.deepEqual(await listMessages(ana.token), [json.message]);
  });

  it('todas las rutas exigen un token Bearer valido', async () => {
    await start();
    const routes = [
      ['GET', '/api/v1/messages'],
      ['POST', '/api/v1/messages'],
      ['DELETE', `/api/v1/messages/${UNKNOWN_ID}`],
      ['POST', `/api/v1/messages/${UNKNOWN_ID}/report`],
      ['POST', '/api/v1/attachments'],
      ['GET', `/api/v1/attachments/${UNKNOWN_ID}`],
    ];
    for (const [method, path] of routes) {
      const missing = await call(method, path);
      const invalid = await call(method, path, { token: 'inventado' });
      assert.equal(missing.status, 401, `${method} ${path}`);
      assert.equal(missing.json.code, 'TOKEN_MISSING');
      assert.equal(invalid.status, 401);
      assert.equal(invalid.json.code, 'TOKEN_INVALID');
    }
  });

  it('un token cerrado con logout deja de servir', async () => {
    await start();
    const [ana] = await roomOf('Ana');
    await call('POST', '/api/v1/auth/logout', { token: ana.token });

    const response = await sendMessage(ana.token, { text: 'hola' });

    assert.equal(response.status, 401);
    assert.equal(response.json.code, 'TOKEN_INVALID');
  });

  it('responde 405 a metodos no admitidos', async () => {
    await start();
    const [ana] = await roomOf('Ana');

    const response = await call('PUT', '/api/v1/messages', { token: ana.token });

    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, POST');
  });
});
