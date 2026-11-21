import { HttpError } from './http-error.js';
import { assertWithinLimit } from './request-limits.js';

const NOT_IN_CALL_ERROR = 'Los servidores de la llamada solo se entregan durante una llamada';
export const NOT_IN_CALL_CODE = 'NOT_IN_CALL';

// Servidores ICE para una llamada sonando o en curso. Las credenciales TURN dan acceso a un
// retransmisor que se paga por uso: solo las recibe una sesion que esta en una llamada, con
// limites por IP y por sesion, y vencen en una hora.
export class IceServersEndpoint {
  #requireSession;
  #iceServerProvider;
  #calls;
  #limiters;
  #issuer;
  #readAddress;
  #responder;
  #logger;

  constructor({ requireSession, iceServerProvider, calls, limiters, sessionIssuer, readAddress, responder, logger }) {
    this.#requireSession = requireSession;
    this.#iceServerProvider = iceServerProvider;
    this.#calls = calls;
    this.#limiters = limiters;
    this.#issuer = sessionIssuer;
    this.#readAddress = readAddress;
    this.#responder = responder;
    this.#logger = logger;
  }

  routes() {
    return new Map([['/rooms/ice-servers', { GET: (request, response) => this.#list(request, response) }]]);
  }

  async #list(request, response) {
    const session = this.#requireSession(request);
    const clientRef = this.#issuer.clientRefOf(request);
    const limit = (limiter, address) => assertWithinLimit({ limiter, address, logger: this.#logger, clientRef });
    limit(this.#limiters.address, this.#readAddress(request));
    limit(this.#limiters.session, session.id);
    if (!this.#calls.hasCallFor(session.id)) {
      throw new HttpError(409, NOT_IN_CALL_ERROR, {}, NOT_IN_CALL_CODE);
    }
    this.#responder.json(response, 200, { iceServers: await this.#iceServerProvider.forCall() });
  }
}
