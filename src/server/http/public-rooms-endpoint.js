import { assertSameOrigin } from './assert-same-origin.js';
import { requireAcceptedRules } from './community-rules.js';
import { HttpError } from './http-error.js';
import { readJsonBody } from './read-body.js';
import { assertWithinLimit } from './request-limits.js';
import { assertNotBanned } from './room-endpoint.js';

const JOIN_PATH = /^\/rooms\/public\/(?<listingId>[\da-f-]{36})\/join$/;
const ROOM_GONE_ERROR = 'Esa sala pública ya no existe';
const ROOM_FULL_ERROR = 'La sala está llena. Prueba con otra.';
export const ROOM_FULL_CODE = 'ROOM_FULL';

// Salas publicas desde el navegador: ver la lista de la portada y entrar a una de ellas.
export class PublicRoomsEndpoint {
  #publicRooms;
  #issuer;
  #limiters;
  #readAddress;
  #responder;
  #logger;

  constructor({ publicRooms, sessionIssuer, limiters, readAddress, responder, logger }) {
    this.#publicRooms = publicRooms;
    this.#issuer = sessionIssuer;
    this.#limiters = limiters;
    this.#readAddress = readAddress;
    this.#responder = responder;
    this.#logger = logger;
  }

  routes() {
    return new Map([['/rooms/public', { GET: (request, response) => this.#list(request, response) }]]);
  }

  patterns() {
    return [
      {
        pattern: JOIN_PATH,
        handlers: { POST: (request, response, params) => this.#join(request, response, params) },
      },
    ];
  }

  #list(request, response) {
    this.#limit(request, this.#limiters.list);
    this.#responder.json(response, 200, { rooms: this.#publicRooms.list() });
  }

  async #join(request, response, { listingId }) {
    assertSameOrigin(request);
    this.#limit(request, this.#limiters.join);
    requireAcceptedRules(await readJsonBody(request));
    const room = this.#publicRooms.find(listingId);
    if (!room) {
      throw new HttpError(404, ROOM_GONE_ERROR);
    }
    assertNotBanned(room, this.#issuer.clientRefOf(request));
    if (this.#publicRooms.isFull(room)) {
      throw new HttpError(503, ROOM_FULL_ERROR, {}, ROOM_FULL_CODE);
    }
    this.#logger.info('room.joined', { roomId: room.id, visibility: room.visibility });
    this.#issuer.issue(request, response, { roomId: room.id, isOwner: false });
  }

  #limit(request, limiter) {
    assertWithinLimit({
      limiter,
      address: this.#readAddress(request),
      logger: this.#logger,
      clientRef: this.#issuer.clientRefOf(request),
    });
  }
}
