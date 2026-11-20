import { ValidationError } from '../validation.js';

const SLOW_MODE_ERROR = 'Esta sala tiene modo lento: espera un par de segundos entre mensajes.';

// Modo lento: en las salas que lo usan, una sesion no puede enviar otro mensaje hasta que
// pase el intervalo. Se registra el turno solo cuando el mensaje ya paso la moderacion.
export class SlowMode {
  #now;
  #lastTurnBySession = new Map();

  constructor({ now = Date.now } = {}) {
    this.#now = now;
  }

  claimTurn(sessionId, intervalMs) {
    if (intervalMs <= 0) {
      return;
    }
    const now = this.#now();
    if (now - (this.#lastTurnBySession.get(sessionId) ?? -Infinity) < intervalMs) {
      throw new ValidationError(SLOW_MODE_ERROR);
    }
    this.#lastTurnBySession.set(sessionId, now);
  }

  forget(sessionId) {
    this.#lastTurnBySession.delete(sessionId);
  }
}
