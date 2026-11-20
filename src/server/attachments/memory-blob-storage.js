import { AttachmentError, AttachmentRefusal } from './attachment-error.js';

export const DEFAULT_MEMORY_STORAGE_BYTES = 64 * 1024 * 1024;

// Almacenamiento en la memoria del proceso, para pruebas y desarrollo local. Tiene un tope
// fijo: en produccion los archivos van a un bucket (S3BlobStorage).
export class MemoryBlobStorage {
  #blobs = new Map();
  #maxBytes;
  #usedBytes = 0;

  constructor({ maxBytes = DEFAULT_MEMORY_STORAGE_BYTES } = {}) {
    this.#maxBytes = maxBytes;
  }

  get usedBytes() {
    return this.#usedBytes;
  }

  async put(key, bytes) {
    const previousSize = this.#blobs.get(key)?.length ?? 0;
    if (this.#usedBytes - previousSize + bytes.length > this.#maxBytes) {
      throw new AttachmentError(AttachmentRefusal.STORAGE_FULL);
    }
    this.#blobs.set(key, Buffer.from(bytes));
    this.#usedBytes += bytes.length - previousSize;
  }

  async get(key) {
    const blob = this.#blobs.get(key);
    if (!blob) {
      throw new AttachmentError(AttachmentRefusal.NOT_FOUND);
    }
    return blob;
  }

  async deleteMany(keys) {
    for (const key of keys) {
      this.#usedBytes -= this.#blobs.get(key)?.length ?? 0;
      this.#blobs.delete(key);
    }
  }
}
