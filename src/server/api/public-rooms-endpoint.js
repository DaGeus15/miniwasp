import { createRateGuard, ratePolicy } from './api-request-guard.js';

const TOO_MANY_LISTINGS_ERROR = 'Consultaste la lista demasiadas veces. Espera un minuto.';
const LIST_RETRY_AFTER_SECONDS = 60;

// Lista de salas publicas por la API REST. Igual que la portada del navegador, no exige token:
// solo muestra titulo, ocupacion y el id de lista (nunca nombres, ids internos ni invitaciones).
// El limite por IP acota la enumeracion. Para entrar se usa POST /api/v1/auth/login con listingId.
export class ApiPublicRoomsEndpoint {
  #publicRooms;
  #responder;
  #guardRate;
  #listRate;

  constructor({ publicRooms, publicListLimiter, readAddress, responder }) {
    this.#publicRooms = publicRooms;
    this.#responder = responder;
    this.#guardRate = createRateGuard(readAddress);
    this.#listRate = ratePolicy(publicListLimiter, LIST_RETRY_AFTER_SECONDS, TOO_MANY_LISTINGS_ERROR);
  }

  routes() {
    return new Map([['/api/v1/rooms/public', { GET: (request, response) => this.#list(request, response) }]]);
  }

  #list(request, response) {
    this.#guardRate(request, this.#listRate);
    this.#responder.json(response, 200, { rooms: this.#publicRooms.list() });
  }
}
