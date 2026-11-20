import { createSessionCookie, readSessionToken } from '../security/session-cookie.js';
import { HttpError } from './http-error.js';

const SERVER_FULL_ERROR = 'El servidor está lleno por ahora. Inténtalo más tarde.';

// Entrega la cookie de sesion de una sala: al crearla, al unirse (por invitacion o desde la
// lista publica) o al pasar a un susurro. Un navegador tiene una sola sesion: entrar a otra
// sala termina la anterior. Cada sesion guarda la huella seudonima de su IP para poder vetarla.
export class RoomSessionIssuer {
  #sessions;
  #readAddress;
  #referenceClient;
  #responder;
  #logger;
  #onSessionRevoked;

  constructor({ sessions, readAddress, referenceClient, responder, logger, onSessionRevoked }) {
    this.#sessions = sessions;
    this.#readAddress = readAddress;
    this.#referenceClient = referenceClient;
    this.#responder = responder;
    this.#logger = logger;
    this.#onSessionRevoked = onSessionRevoked;
  }

  clientRefOf(request) {
    return this.#referenceClient(this.#readAddress(request));
  }

  issue(request, response, attributes) {
    this.endCurrent(request);
    const created = this.#sessions.create({ ...attributes, clientRef: this.clientRefOf(request) });
    if (!created) {
      throw new HttpError(503, SERVER_FULL_ERROR);
    }
    this.#responder.empty(response, { 'Set-Cookie': createSessionCookie(created.token, this.#sessions.ttlMs) });
    return created.session;
  }

  endCurrent(request) {
    const token = readSessionToken(request);
    const session = this.#sessions.find(token);
    if (session) {
      this.#sessions.revoke(token);
      this.#onSessionRevoked(session);
      this.#logger.info('session.ended', { sessionId: session.id });
    }
  }
}
