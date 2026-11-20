import { assertSameOrigin } from './assert-same-origin.js';
import { HttpError } from './http-error.js';
import { readJsonBody } from './read-body.js';

const TRANSFER_INVALID_ERROR = 'El pase a la sala privada no es válido o ya venció';

// Muda la sesion del navegador a la sala de un susurro. Exige la cookie de la sesion que
// recibio el pase: el pase solo, sin esa sesion, no sirve para entrar.
export class TransferEndpoint {
  #requireSession;
  #transferTokens;
  #rooms;
  #issuer;
  #logger;

  constructor({ requireSession, transferTokens, rooms, sessionIssuer, logger }) {
    this.#requireSession = requireSession;
    this.#transferTokens = transferTokens;
    this.#rooms = rooms;
    this.#issuer = sessionIssuer;
    this.#logger = logger;
  }

  routes() {
    return new Map([['/rooms/transfer', { POST: (request, response) => this.#transfer(request, response) }]]);
  }

  async #transfer(request, response) {
    assertSameOrigin(request);
    const session = this.#requireSession(request);
    const { transferToken } = Object(await readJsonBody(request));
    const destination = this.#transferTokens.redeem(transferToken, session.id);
    const room = destination ? this.#rooms.find(destination.roomId) : null;
    if (!room) {
      throw new HttpError(404, TRANSFER_INVALID_ERROR);
    }
    this.#logger.info('room.transferred', { roomId: room.id, visibility: room.visibility });
    this.#issuer.issue(request, response, { roomId: room.id, isOwner: false });
  }
}
