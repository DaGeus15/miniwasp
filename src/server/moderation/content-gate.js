import { Metric } from '../observability/metrics.js';
import { ValidationError } from '../validation.js';
import { ContentBlockedError } from './content-blocked-error.js';
import { ModerationProfiles } from './moderation-profile.js';
import { StrikeAction } from './strike-tracker.js';

const MUTED_MESSAGE = 'Se bloquearon varios de tus mensajes. Podrás enviar de nuevo en unos minutos.';
const MILLISECONDS_PER_SECOND = 1000;
const STANDARD = ModerationProfiles.STANDARD;

export class SessionMutedError extends ValidationError {
  name = 'SessionMutedError';

  constructor(remainingMs) {
    super(MUTED_MESSAGE);
    this.retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / MILLISECONDS_PER_SECOND));
  }
}

// Punto unico por el que pasa todo lo que una persona publica en una sala: texto, nombres,
// nombres de archivo, documentos de texto e imagenes. Si algo se bloquea, cuenta una falta;
// demasiadas faltas silencian la sesion y lo mas grave la expulsa de inmediato.
// El contenido bloqueado no se guarda ni se registra: solo su categoria.
export class ContentGate {
  #textModerator;
  #imageInspector;
  #strikes;
  #onExpel;
  #logger;
  #metrics;

  constructor({ textModerator, imageInspector, strikes, onExpel, logger, metrics }) {
    this.#textModerator = textModerator;
    this.#imageInspector = imageInspector;
    this.#strikes = strikes;
    this.#onExpel = onExpel;
    this.#logger = logger;
    this.#metrics = metrics;
  }

  // profile: las reglas de la sala donde se publica (ver ModerationProfile).
  reviewText(session, text, profile = STANDARD) {
    this.#assertCanPublish(session);
    const verdict = this.#textModerator.review(text, { level: profile.textLevel });
    if (!verdict.allowed) {
      this.#block(session, verdict.category, profile);
    }
  }

  // Antes de que exista una sesion (el nombre al iniciar sesion en la API) no hay a quien
  // contar faltas: solo se decide si el texto se acepta.
  reviewWithoutSession(text, profile = STANDARD) {
    const verdict = this.#textModerator.review(text, { level: profile.textLevel });
    if (!verdict.allowed) {
      this.#metrics.increment(Metric.CONTENT_BLOCKED);
      this.#logger.warn('moderation.blocked', { category: verdict.category });
      throw new ContentBlockedError(verdict.category);
    }
  }

  // Devuelve la imagen re-codificada, sin metadatos, lista para guardarse.
  async reviewImage(session, bytes, profile = STANDARD) {
    this.#assertCanPublish(session);
    const verdict = await this.#imageInspector.inspect(bytes, profile.imageThresholds);
    if (!verdict.allowed) {
      this.#block(session, verdict.category, profile);
    }
    return verdict.bytes;
  }

  forget(sessionId) {
    this.#strikes.forget(sessionId);
  }

  #assertCanPublish(session) {
    const remainingMs = this.#strikes.muteRemainingMs(session.id);
    if (remainingMs > 0) {
      throw new SessionMutedError(remainingMs);
    }
  }

  #block(session, category, profile) {
    this.#metrics.increment(Metric.CONTENT_BLOCKED);
    this.#logger.warn('moderation.blocked', { roomId: session.roomId, category });
    const { action } = this.#strikes.record(session.id, category, { maxStrikes: profile.strikesToMute });
    if (action === StrikeAction.EXPEL) {
      this.#logger.warn('moderation.expelled', { roomId: session.roomId, category });
      this.#onExpel(session);
    }
    throw new ContentBlockedError(category);
  }
}
