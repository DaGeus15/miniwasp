import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
// Debe acompañar al tope de conexiones: cada persona conectada tiene una sesion.
export const DEFAULT_MAX_SESSIONS = 3000;
const TOKEN_BYTES = 32;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// Sesiones del lado del servidor. Solo se guarda el hash del token: un volcado de
// memoria o un registro accidental no permitiria reutilizar una sesion.
export class SessionStore {
  #sessionsByTokenHash = new Map();
  #ttlMs;
  #maxSessions;
  #now;

  constructor({
    ttlMs = DEFAULT_SESSION_TTL_MS,
    maxSessions = DEFAULT_MAX_SESSIONS,
    now = Date.now,
  } = {}) {
    this.#ttlMs = ttlMs;
    this.#maxSessions = maxSessions;
    this.#now = now;
  }

  get ttlMs() {
    return this.#ttlMs;
  }

  // Los atributos (sala, si es quien la creo) se fijan al crear y no cambian despues.
  // Si el almacen esta lleno devuelve null: desalojar sesiones ajenas permitiria que
  // alguien expulsara a otras personas solo creando sesiones.
  create(attributes = {}) {
    this.#removeExpired();
    if (this.#sessionsByTokenHash.size >= this.#maxSessions) {
      return null;
    }

    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const session = Object.freeze({
      ...attributes,
      id: randomUUID(),
      expiresAt: this.#now() + this.#ttlMs,
    });
    this.#sessionsByTokenHash.set(hashToken(token), session);
    return { token, session };
  }

  find(token) {
    if (typeof token !== 'string') {
      return null;
    }
    const tokenHash = hashToken(token);
    const session = this.#sessionsByTokenHash.get(tokenHash);
    if (!session) {
      return null;
    }
    if (this.#isExpired(session)) {
      this.#sessionsByTokenHash.delete(tokenHash);
      return null;
    }
    return session;
  }

  // Sesiones vigentes que cumplen la condicion. Nunca devuelve tokens, solo sus atributos.
  findWhere(predicate) {
    this.#removeExpired();
    return [...this.#sessionsByTokenHash.values()].filter((session) => predicate(session));
  }

  isActive(sessionId) {
    for (const session of this.#sessionsByTokenHash.values()) {
      if (session.id === sessionId) {
        return !this.#isExpired(session);
      }
    }
    return false;
  }

  revoke(token) {
    if (typeof token === 'string') {
      this.#sessionsByTokenHash.delete(hashToken(token));
    }
  }

  revokeWhere(predicate) {
    for (const [tokenHash, session] of this.#sessionsByTokenHash) {
      if (predicate(session)) {
        this.#sessionsByTokenHash.delete(tokenHash);
      }
    }
  }

  #isExpired(session) {
    return this.#now() >= session.expiresAt;
  }

  #removeExpired() {
    this.revokeWhere((session) => this.#isExpired(session));
  }
}
