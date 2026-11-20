import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { MemoryBlobStorage } from '../../../src/server/attachments/memory-blob-storage.js';
import { ModerationCategory } from '../../../src/server/moderation/text-moderator.js';
import { ClientEvent, ServerEvent } from '../../../src/shared/events.js';
import { createRoomCookie, readRoomStatus, startRoomServer } from '../../support/test-server.js';
import { openClient, stopServer } from '../../support/ws-client.js';

const PDF = Buffer.from('%PDF-1.7\nhola');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
const CLEAN_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 9, 9]);

function createFakeInspector({ allowed = true } = {}) {
  const inspected = [];
  return {
    inspected,
    async inspect(bytes) {
      inspected.push(bytes);
      return allowed ? { allowed, bytes: CLEAN_JPEG } : { allowed, category: ModerationCategory.SEXUAL_EXPLICIT };
    },
    async close() {},
  };
}

let room;

async function start(options = {}) {
  room = await startRoomServer({ imageInspector: createFakeInspector(), ...options });
  return room;
}

function upload(bytes, { cookie = room.ownerCookie, fileName = 'informe.pdf', origin = room.httpUrl } = {}) {
  return fetch(`${room.httpUrl}/rooms/attachments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(fileName),
      Cookie: cookie,
      ...(origin ? { Origin: origin } : {}),
    },
    body: bytes,
  });
}

function download(id, { cookie = room.ownerCookie, headers = {} } = {}) {
  return fetch(`${room.httpUrl}/rooms/attachments/${id}`, { headers: { Cookie: cookie, ...headers } });
}

async function sendWithAttachment(attachmentId, fields = {}) {
  const client = openClient(room.wsUrl, { headers: { Cookie: room.ownerCookie } });
  await client.next();
  client.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Ana', attachmentId, ...fields });
  const reply = await client.next();
  client.socket.terminate();
  return reply;
}

afterEach(async () => {
  if (room) {
    await stopServer(room.server);
    room = null;
  }
});

describe('adjuntos por HTTP', () => {
  it('sube un PDF, se envia en un mensaje y otra persona de la sala lo descarga como archivo', async () => {
    await start();
    const response = await upload(PDF, { fileName: 'informe final.exe' });
    const attachment = await response.json();

    assert.equal(response.status, 201);
    assert.deepEqual(
      { kind: attachment.kind, mimeType: attachment.mimeType, fileName: attachment.fileName, size: attachment.size },
      { kind: 'document', mimeType: 'application/pdf', fileName: 'informe final.pdf', size: PDF.length },
    );
    assert.equal((await download(attachment.id)).status, 404);

    const reply = await sendWithAttachment(attachment.id);
    assert.equal(reply.type, ServerEvent.MESSAGE);
    assert.deepEqual(reply.message.attachment, attachment);
    assert.equal(reply.message.text, '');

    const file = await download(attachment.id, { cookie: await room.memberCookie() });
    assert.equal(file.status, 200);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PDF);
    assert.match(file.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''informe%20final\.pdf$/);
    assert.equal(file.headers.get('content-security-policy'), "default-src 'none'; sandbox");
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.match(file.headers.get('cache-control'), /no-store/);
  });

  it('las fotos pasan por la moderacion, se guardan re-codificadas y admiten rangos', async () => {
    const inspector = createFakeInspector();
    await start({ imageInspector: inspector });
    const attachment = await (await upload(JPEG, { fileName: 'foto.png' })).json();
    await sendWithAttachment(attachment.id, { text: 'mira' });

    const whole = await download(attachment.id);
    const part = await download(attachment.id, { headers: { Range: 'bytes=1-2' } });
    const outside = await download(attachment.id, { headers: { Range: 'bytes=50-' } });

    assert.deepEqual(inspector.inspected, [JPEG]);
    assert.equal(attachment.fileName, 'foto.jpg');
    assert.deepEqual(Buffer.from(await whole.arrayBuffer()), CLEAN_JPEG);
    assert.match(whole.headers.get('content-disposition'), /^inline;/);
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), `bytes 1-2/${CLEAN_JPEG.length}`);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), CLEAN_JPEG.subarray(1, 3));
    assert.equal(outside.status, 416);
  });

  it('rechaza tipos no permitidos, archivos grandes, otro origen y a quien no esta en una sala', async () => {
    await start();
    const executable = await upload(Buffer.from([0x4d, 0x5a, 0x90, 0]), { fileName: 'foto.jpg' });
    const tooLarge = await upload(Buffer.concat([Buffer.from('hola'), Buffer.alloc(1024 * 1024)]).fill(0x61, 4), {
      fileName: 'nota.txt',
    });
    const crossOrigin = await upload(PDF, { origin: 'https://evil.test' });
    const anonymous = await upload(PDF, { cookie: '' });

    assert.equal(executable.status, 415);
    assert.equal((await executable.json()).code, 'FILE_TYPE_NOT_ALLOWED');
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json()).code, 'FILE_TOO_LARGE');
    assert.equal(crossOrigin.status, 403);
    assert.equal(anonymous.status, 401);
  });

  it('una foto bloqueada responde 422 y no se guarda nada', async () => {
    const storage = new MemoryBlobStorage();
    await start({ imageInspector: createFakeInspector({ allowed: false }), blobStorage: storage });

    const response = await upload(JPEG, { fileName: 'foto.jpg' });

    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'CONTENT_BLOCKED');
    assert.equal(storage.usedBytes, 0);
  });

  it('un nombre de archivo ofensivo se bloquea', async () => {
    await start();

    const response = await upload(PDF, { fileName: 'vendo cocaina barata.pdf' });

    assert.equal(response.status, 422);
  });

  it('otra sala no puede descargar el adjunto', async () => {
    await start();
    const attachment = await (await upload(PDF)).json();
    await sendWithAttachment(attachment.id);
    const outsider = await createRoomCookie(room.httpUrl);

    assert.equal((await download(attachment.id, { cookie: outsider })).status, 404);
  });

  it('al cerrarse la sala se borran sus archivos', async () => {
    const storage = new MemoryBlobStorage();
    // El tiempo de gracia debe dar margen para conectar aun con la maquina ocupada.
    await start({ blobStorage: storage, emptyRoomTtlMs: 300 });
    const attachment = await (await upload(PDF)).json();
    await sendWithAttachment(attachment.id);
    assert.ok(storage.usedBytes > 0);

    await new Promise((resolve) => {
      setTimeout(resolve, 600);
    });

    assert.equal(storage.usedBytes, 0);
    assert.equal(await readRoomStatus(room.httpUrl, room.ownerCookie), null);
  });

  it('un adjunto solo se puede enviar una vez', async () => {
    await start();
    const attachment = await (await upload(PDF)).json();

    await sendWithAttachment(attachment.id);
    const second = await sendWithAttachment(attachment.id);

    assert.equal(second.type, ServerEvent.ERROR);
    assert.match(second.error, /no existe/);
  });
});
