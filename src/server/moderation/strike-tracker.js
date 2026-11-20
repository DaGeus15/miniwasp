import { ModerationCategory } from './moderation-terms.js';

export const StrikeAction = Object.freeze({ NONE: 'none', MUTE: 'mute', EXPEL: 'expel' });

const MINUTE_MS = 60_000;
const DEFAULT_WINDOW_MS = 15 * MINUTE_MS;
const DEFAULT_MUTE_MS = 10 * MINUTE_MS;
const PRUNE_INTERVAL_MS = MINUTE_MS;

/**
 * Cuenta infracciones por sesion dentro de una ventana deslizante:
 * - Cada infraccion es una advertencia ('none') hasta llegar a maxStrikes.
 * - Al llegar a maxStrikes la sesion queda silenciada muteMs ('mute').
 * - Si vuelve a llegar a maxStrikes dentro de windowMs desde el silencio anterior, se expulsa.
 * - Contenido sexual con menores expulsa de inmediato.
 * La memoria se acota olvidando sesiones sin actividad reciente ni silencio vigente.
 */
export class StrikeTracker {
  #now;
  #maxStrikes;
  #windowMs;
  #muteMs;
  #entries = new Map();
  #lastPruneAt = -Infinity;

  constructor({
    now = Date.now,
    maxStrikes = 3,
    windowMs = DEFAULT_WINDOW_MS,
    muteMs = DEFAULT_MUTE_MS,
  } = {}) {
    this.#now = now;
    this.#maxStrikes = maxStrikes;
    this.#windowMs = windowMs;
    this.#muteMs = muteMs;
  }

  // maxStrikes puede cambiar por sala: las salas publicas silencian antes.
  record(sessionId, category, { maxStrikes = this.#maxStrikes } = {}) {
    const now = this.#now();
    this.#pruneIfDue(now);
    if (category === ModerationCategory.MINORS_SEXUAL) {
      this.forget(sessionId);
      return Object.freeze({ action: StrikeAction.EXPEL, strikes: maxStrikes });
    }
    const entry = this.#entryFor(sessionId, now);
    entry.strikes.push(now);
    const strikes = entry.strikes.length;
    if (strikes < maxStrikes) {
      return Object.freeze({ action: StrikeAction.NONE, strikes });
    }
    if (this.#isRecent(entry.lastMuteAt, now)) {
      this.forget(sessionId);
      return Object.freeze({ action: StrikeAction.EXPEL, strikes });
    }
    entry.strikes = [];
    entry.lastMuteAt = now;
    entry.mutedUntil = now + this.#muteMs;
    return Object.freeze({ action: StrikeAction.MUTE, strikes, mutedUntil: entry.mutedUntil });
  }

  isMuted(sessionId) {
    return this.muteRemainingMs(sessionId) > 0;
  }

  // Milisegundos de silencio que le quedan a la sesion (0 si puede escribir).
  muteRemainingMs(sessionId) {
    const entry = this.#entries.get(sessionId);
    return entry ? Math.max(0, entry.mutedUntil - this.#now()) : 0;
  }

  forget(sessionId) {
    this.#entries.delete(sessionId);
  }

  // Sesiones que aun ocupan memoria; util para comprobar que la poda funciona.
  get size() {
    return this.#entries.size;
  }

  #entryFor(sessionId, now) {
    const entry = this.#entries.get(sessionId) ?? { strikes: [], lastMuteAt: null, mutedUntil: 0 };
    entry.strikes = entry.strikes.filter((at) => this.#isRecent(at, now));
    this.#entries.set(sessionId, entry);
    return entry;
  }

  #isRecent(timestamp, now) {
    return timestamp !== null && now - timestamp < this.#windowMs;
  }

  #isExpired(entry, now) {
    return (
      entry.mutedUntil <= now &&
      !this.#isRecent(entry.lastMuteAt, now) &&
      !entry.strikes.some((at) => this.#isRecent(at, now))
    );
  }

  #pruneIfDue(now) {
    if (now - this.#lastPruneAt < PRUNE_INTERVAL_MS) {
      return;
    }
    this.#lastPruneAt = now;
    for (const [sessionId, entry] of this.#entries) {
      if (this.#isExpired(entry, now)) {
        this.#entries.delete(sessionId);
      }
    }
  }
}
