import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findAttachmentType } from '../../../src/shared/attachments.js';
import { AttachmentRefusal } from '../../../src/server/attachments/attachment-error.js';
import { AttachmentStore } from '../../../src/server/attachments/attachment-store.js';
import { MemoryBlobStorage } from '../../../src/server/attachments/memory-blob-storage.js';
import { Room } from '../../../src/server/rooms/room.js';

const PDF_TYPE = findAttachmentType('application/pdf');

function createManualScheduler() {
  const tasks = [];
  const schedule = (callback, delayMs) => {
    const task = { callback, delayMs, isCancelled: false };
    tasks.push(task);
    return () => {
      task.isCancelled = true;
    };
  };
  const runPending = () => tasks.filter((task) => !task.isCancelled).forEach((task) => task.callback());
  return { schedule, tasks, runPending };
}

function setup(options = {}) {
  const storage = new MemoryBlobStorage();
  const warnings = [];
  const scheduler = createManualScheduler();
  const store = new AttachmentStore({
    storage,
    logger: { warn: (event) => warnings.push(event) },
    schedule: scheduler.schedule,
    ...options,
  });
  const room = new Room();
  const upload = (bytes = Buffer.from('%PDF-1.7 contenido'), sessionId = 'ana', target = room) =>
    store.add({ room: target, sessionId, type: PDF_TYPE, fileName: 'doc.pdf', bytes });
  return { store, storage, room, upload, warnings, scheduler };
}

describe('AttachmentStore', () => {
  it('guarda el archivo cifrado y solo lo entrega ya enviado y a su sala', async () => {
    const { store, storage, room, upload } = setup();
    const attachment = await upload();

    const stored = await storage.get(attachment.storageKey);
    assert.equal(stored.includes(Buffer.from('contenido')), false);
    assert.equal(store.findSent(room.id, attachment.id), null);

    store.claim({ roomId: room.id, sessionId: 'ana', attachmentId: attachment.id });
    const { bytes } = await store.readSent(room, attachment.id);
    assert.equal(bytes.toString(), '%PDF-1.7 contenido');
    await assert.rejects(store.readSent(new Room(), attachment.id), (error) => error.refusal === AttachmentRefusal.NOT_FOUND);
  });

  it('solo quien lo subio puede enviarlo, en su sala y una sola vez', async () => {
    const { store, room, upload } = setup();
    const attachment = await upload();
    const claimBy = (sessionId, roomId = room.id) => () =>
      store.claim({ roomId, sessionId, attachmentId: attachment.id });

    assert.throws(claimBy('luis'), (error) => error.refusal === AttachmentRefusal.NOT_FOUND);
    assert.throws(claimBy('ana', 'otra-sala'), (error) => error.refusal === AttachmentRefusal.NOT_FOUND);
    assert.equal(claimBy('ana')().id, attachment.id);
    assert.throws(claimBy('ana'), (error) => error.refusal === AttachmentRefusal.NOT_FOUND);
  });

  it('borra un adjunto que nadie envio a tiempo', async () => {
    const { store, storage, room, upload, scheduler } = setup();
    const attachment = await upload();

    scheduler.runPending();
    await new Promise(setImmediate);

    assert.equal(storage.usedBytes, 0);
    assert.deepEqual(store.usageOf(room.id), { bytes: 0, files: 0 });
    assert.throws(() => store.claim({ roomId: room.id, sessionId: 'ana', attachmentId: attachment.id }));
  });

  it('un adjunto enviado no expira', async () => {
    const { store, room, upload, scheduler } = setup();
    const attachment = await upload();
    store.claim({ roomId: room.id, sessionId: 'ana', attachmentId: attachment.id });

    scheduler.runPending();

    assert.ok(store.findSent(room.id, attachment.id));
  });

  it('respeta el cupo de bytes y de archivos por sala sin afectar a otras salas', async () => {
    const { upload, store, room } = setup({ maxRoomBytes: 30, maxRoomFiles: 2 });
    await upload(Buffer.alloc(20));

    await assert.rejects(upload(Buffer.alloc(11)), (error) => error.refusal === AttachmentRefusal.STORAGE_FULL);
    await upload(Buffer.alloc(5));
    await assert.rejects(upload(Buffer.alloc(1)), (error) => error.refusal === AttachmentRefusal.STORAGE_FULL);
    await upload(Buffer.alloc(20), 'ana', new Room());
    assert.deepEqual(store.usageOf(room.id), { bytes: 25, files: 2 });
  });

  it('libera el cupo si el almacenamiento falla', async () => {
    const failingStorage = { put: async () => Promise.reject(new Error('caido')) };
    const { upload, store, room } = setup({ storage: failingStorage });

    await assert.rejects(upload(), /caido/);
    assert.deepEqual(store.usageOf(room.id), { bytes: 0, files: 0 });
  });

  it('al cerrar la sala borra todos sus archivos y no toca los de otras', async () => {
    const { store, storage, room, upload } = setup();
    const other = new Room();
    await upload();
    await upload();
    const kept = await upload(Buffer.from('otra sala'), 'luis', other);

    await store.deleteRoom(room.id);
    await store.deleteRoom('sala-sin-archivos');

    assert.equal(storage.usedBytes, kept.size + 28);
    assert.deepEqual(store.usageOf(room.id), { bytes: 0, files: 0 });
  });

  it('borrar un adjunto inexistente no falla y un borrado fallido solo se registra', async () => {
    const storage = new MemoryBlobStorage();
    storage.deleteMany = async () => Promise.reject(new Error('sin red'));
    const { store, upload, warnings } = setup({ storage });
    const attachment = await upload();

    await store.delete('no-existe');
    await store.delete(attachment.id);

    assert.deepEqual(warnings, ['attachment.delete.failed']);
  });
});
