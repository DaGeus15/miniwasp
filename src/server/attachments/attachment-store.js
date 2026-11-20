import { scheduleOnce } from '../scheduling.js';
import { Attachment } from './attachment.js';
import { AttachmentError, AttachmentRefusal } from './attachment-error.js';

const MEGABYTE = 1024 * 1024;
export const DEFAULT_MAX_ROOM_BYTES = 200 * MEGABYTE;
export const DEFAULT_MAX_ROOM_FILES = 300;
// Un archivo subido que nadie envia en este tiempo se borra: no puede quedar huerfano.
export const DEFAULT_PENDING_TTL_MS = 5 * 60 * 1000;

const EMPTY_USAGE = Object.freeze({ bytes: 0, files: 0 });

// Adjuntos de todas las salas. Guarda en memoria solo los datos de cada adjunto; los bytes
// van cifrados con la clave de la sala al almacenamiento (bucket o memoria).
// Un adjunto pasa por dos estados: subido (solo lo conoce quien lo subio) y enviado (parte
// de un mensaje, visible para la sala). Solo se puede enviar una vez.
export class AttachmentStore {
  #storage;
  #schedule;
  #logger;
  #pendingTtlMs;
  #maxRoomBytes;
  #maxRoomFiles;
  #entries = new Map();
  #usageByRoom = new Map();

  constructor({
    storage,
    logger,
    schedule = scheduleOnce,
    pendingTtlMs = DEFAULT_PENDING_TTL_MS,
    maxRoomBytes = DEFAULT_MAX_ROOM_BYTES,
    maxRoomFiles = DEFAULT_MAX_ROOM_FILES,
  }) {
    this.#storage = storage;
    this.#logger = logger;
    this.#schedule = schedule;
    this.#pendingTtlMs = pendingTtlMs;
    this.#maxRoomBytes = maxRoomBytes;
    this.#maxRoomFiles = maxRoomFiles;
  }

  async add({ room, sessionId, type, fileName, bytes }) {
    this.#reserve(room.id, bytes.length);
    const attachment = new Attachment({ roomId: room.id, uploaderSessionId: sessionId, type, fileName, size: bytes.length });
    try {
      await this.#storage.put(attachment.storageKey, room.cipher.seal(bytes, attachment.cipherContext));
    } catch (error) {
      this.#release(room.id, bytes.length);
      throw error;
    }
    const cancelExpiry = this.#schedule(() => this.delete(attachment.id), this.#pendingTtlMs);
    this.#entries.set(attachment.id, { attachment, isSent: false, cancelExpiry });
    return attachment;
  }

  // Marca el adjunto como enviado. Solo quien lo subio puede enviarlo, en su sala y una vez.
  claim({ roomId, sessionId, attachmentId }) {
    const entry = this.#entries.get(attachmentId);
    const isClaimable =
      entry?.isSent === false &&
      entry.attachment.roomId === roomId &&
      entry.attachment.uploaderSessionId === sessionId;
    if (!isClaimable) {
      throw new AttachmentError(AttachmentRefusal.NOT_FOUND);
    }
    entry.isSent = true;
    entry.cancelExpiry();
    return entry.attachment;
  }

  // Solo los adjuntos ya enviados son visibles, y unicamente para su propia sala.
  findSent(roomId, attachmentId) {
    const entry = this.#entries.get(attachmentId);
    return entry?.isSent && entry.attachment.roomId === roomId ? entry.attachment : null;
  }

  // Lee un adjunto enviado de la sala, ya descifrado. Otra sala recibe "no existe".
  async readSent(room, attachmentId) {
    const attachment = this.findSent(room.id, attachmentId);
    if (!attachment) {
      throw new AttachmentError(AttachmentRefusal.NOT_FOUND);
    }
    const sealed = await this.#storage.get(attachment.storageKey);
    return { attachment, bytes: room.cipher.open(sealed, attachment.cipherContext) };
  }

  usageOf(roomId) {
    return { ...(this.#usageByRoom.get(roomId) ?? EMPTY_USAGE) };
  }

  delete(attachmentId) {
    const entry = this.#entries.get(attachmentId);
    if (!entry) {
      return Promise.resolve();
    }
    this.#forget(entry);
    return this.#deleteInBackground([entry.attachment.storageKey]);
  }

  deleteRoom(roomId) {
    const entries = [...this.#entries.values()].filter((entry) => entry.attachment.roomId === roomId);
    entries.forEach((entry) => this.#forget(entry));
    this.#usageByRoom.delete(roomId);
    return entries.length === 0
      ? Promise.resolve()
      : this.#deleteInBackground(entries.map((entry) => entry.attachment.storageKey));
  }

  #reserve(roomId, size) {
    const usage = this.usageOf(roomId);
    if (usage.bytes + size > this.#maxRoomBytes || usage.files + 1 > this.#maxRoomFiles) {
      throw new AttachmentError(AttachmentRefusal.STORAGE_FULL);
    }
    this.#usageByRoom.set(roomId, { bytes: usage.bytes + size, files: usage.files + 1 });
  }

  #release(roomId, size) {
    const usage = this.#usageByRoom.get(roomId);
    if (!usage) {
      return;
    }
    const remaining = { bytes: usage.bytes - size, files: usage.files - 1 };
    if (remaining.files > 0) {
      this.#usageByRoom.set(roomId, remaining);
    } else {
      this.#usageByRoom.delete(roomId);
    }
  }

  #forget(entry) {
    entry.cancelExpiry();
    this.#entries.delete(entry.attachment.id);
    this.#release(entry.attachment.roomId, entry.attachment.size);
  }

  // Si el borrado falla, el objeto sigue cifrado con una clave que ya no existe y la regla de
  // expiracion del bucket lo elimina. Se registra, pero no interrumpe a nadie.
  #deleteInBackground(keys) {
    return this.#storage
      .deleteMany(keys)
      .catch((error) => this.#logger.warn('attachment.delete.failed', { errorName: error?.name, count: keys.length }));
  }
}
