import { randomBytes } from 'node:crypto';

const TOKEN_BYTES = 16;
export const DEFAULT_TRANSFER_TTL_MS = 60000;
export const MAX_PENDING_TRANSFERS = 1000;

// Pases de un solo uso para mudar una sesion a otra sala (por ejemplo, a un susurro).
// Cada pase esta ligado a la sesion que lo recibio: aunque alguien lo interceptara, sin la
// cookie de esa sesion no sirve. Vence pronto y se borra al usarse.
export class TransferTokens {
  #now;
  #ttlMs;
  #pending = new Map();

  constructor({ now = Date.now, ttlMs = DEFAULT_TRANSFER_TTL_MS } = {}) {
    this.#now = now;
    this.#ttlMs = ttlMs;
  }

  // Devuelve el pase, o null si hay demasiados pendientes (memoria acotada).
  issue(sessionId, destination) {
    this.#prune();
    if (this.#pending.size >= MAX_PENDING_TRANSFERS) {
      return null;
    }
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    this.#pending.set(token, { sessionId, destination, expiresAt: this.#now() + this.#ttlMs });
    return token;
  }

  // Devuelve el destino si el pase existe, no vencio y lo presenta la misma sesion. Un pase
  // presentado por otra sesion tambien se consume: un intento de robo lo invalida.
  redeem(token, sessionId) {
    const entry = typeof token === 'string' ? this.#pending.get(token) : undefined;
    if (!entry) {
      return null;
    }
    this.#pending.delete(token);
    const isValid = entry.sessionId === sessionId && entry.expiresAt > this.#now();
    return isValid ? entry.destination : null;
  }

  get size() {
    return this.#pending.size;
  }

  #prune() {
    const now = this.#now();
    for (const [token, entry] of this.#pending) {
      if (entry.expiresAt <= now) {
        this.#pending.delete(token);
      }
    }
  }
}
