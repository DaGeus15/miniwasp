import { availableParallelism } from 'node:os';
import { AttachmentError, AttachmentRefusal } from '../attachments/attachment-error.js';
import { WorkerPool } from '../concurrency/worker-pool.js';
import { ImageReviewStatus } from './image-review.js';

const WORKER_URL = new URL('./image-worker.js', import.meta.url);
// Cada hilo carga su propia copia del modelo (unos 150 MB): no conviene mas de cuatro.
const MAX_DEFAULT_WORKERS = 4;
const INVALID_IMAGE_ERROR = 'La imagen está dañada o es demasiado grande';

function defaultWorkerCount() {
  return Math.min(Math.max(availableParallelism() - 1, 1), MAX_DEFAULT_WORKERS);
}

function createDefaultPool(size) {
  return new WorkerPool({ workerUrl: WORKER_URL, size });
}

// Revisa fotos en hilos aparte para que el chat de todas las salas siga fluido. Los hilos
// arrancan con la primera imagen. Si estan saturados o fallan, la imagen se rechaza: nunca
// se publica una foto sin revisar.
export class ImageInspector {
  #workers;
  #createPool;
  #pool = null;

  constructor({ workers = defaultWorkerCount(), createPool = createDefaultPool } = {}) {
    this.#workers = workers;
    this.#createPool = createPool;
  }

  // Devuelve { allowed: true, bytes } con la imagen re-codificada, o { allowed: false, category }.
  async inspect(bytes, thresholds) {
    this.#pool ??= this.#createPool(this.#workers);
    let review;
    try {
      review = await this.#pool.run({ bytes: new Uint8Array(bytes), thresholds });
    } catch {
      throw new AttachmentError(AttachmentRefusal.BUSY);
    }
    if (review.status === ImageReviewStatus.INVALID) {
      throw new AttachmentError(AttachmentRefusal.TYPE_NOT_ALLOWED, INVALID_IMAGE_ERROR);
    }
    if (review.status === ImageReviewStatus.BLOCKED) {
      return { allowed: false, category: review.category };
    }
    return { allowed: true, bytes: Buffer.from(review.bytes) };
  }

  async close() {
    await this.#pool?.close();
  }
}
