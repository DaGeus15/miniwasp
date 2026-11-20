export const DEFAULT_UPLOAD_CONCURRENCY = 40;

// Limita cuantas subidas se procesan a la vez. Cada una ocupa memoria mientras se lee,
// se analiza y se cifra: este tope acota la memoria total aunque lleguen muchas juntas.
export class UploadGate {
  #maxConcurrent;
  #active = 0;

  constructor({ maxConcurrent = DEFAULT_UPLOAD_CONCURRENCY } = {}) {
    this.#maxConcurrent = maxConcurrent;
  }

  get active() {
    return this.#active;
  }

  // Devuelve la funcion que libera el lugar, o null si no hay lugar. Liberar dos veces no
  // tiene efecto, para que un error no descuadre la cuenta.
  tryAcquire() {
    if (this.#active >= this.#maxConcurrent) {
      return null;
    }
    this.#active += 1;
    let isReleased = false;
    return () => {
      if (!isReleased) {
        isReleased = true;
        this.#active -= 1;
      }
    };
  }
}
