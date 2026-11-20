import { ROOM_FULL_CODE } from '../http/public-rooms-endpoint.js';
import { assertNotBanned } from '../http/room-endpoint.js';
import { ModerationProfiles } from '../moderation/moderation-profile.js';
import { Metric } from '../observability/metrics.js';
import { RoomVisibility } from '../rooms/room.js';
import { requireRoomTitle } from '../validation.js';
import { apiError, ApiErrorCode } from './api-error.js';
import { createRateGuard, mapDomainErrors, ratePolicy } from './api-request-guard.js';

const RETRY_AFTER_SECONDS = 60;
// El limite de salas publicas se mide en ventanas de 10 minutos.
const PUBLIC_RETRY_AFTER_SECONDS = 600;
const TOO_MANY_ATTEMPTS_ERROR = 'Demasiados intentos. Espera un minuto.';
const TOO_MANY_PUBLIC_ROOMS_ERROR = 'Creaste demasiadas salas públicas. Espera unos minutos.';
const SERVER_FULL_ERROR = 'El servidor está lleno por ahora. Inténtalo más tarde.';
const PUBLIC_ROOMS_FULL_ERROR = 'Hay demasiadas salas públicas abiertas. Inténtalo más tarde.';
const INVALID_INVITE_ERROR = 'inviteToken debe ser texto';
const INVITE_NOT_FOUND_ERROR = 'La sala no existe o la invitación ya no es válida';
const INVALID_LISTING_ERROR = 'listingId debe ser el id de una sala de la lista pública';
const PUBLIC_ROOM_NOT_FOUND_ERROR = 'Esa sala pública ya no existe';
const ROOM_FULL_ERROR = 'La sala está llena. Prueba con otra.';

// Decide a que sala entra quien inicia sesion por la API, con las mismas reglas que el
// navegador: listingId (lista publica), inviteToken (invitacion), visibility 'public' (sala
// publica nueva) o, sin nada de eso, una sala privada nueva. El nombre se modera con las reglas
// de la sala de destino (estrictas en las publicas) antes de crear nada.
export class ApiRoomResolver {
  #rooms;
  #publicRooms;
  #contentGate;
  #issuer;
  #metrics;
  #logger;
  #guardRate;
  #policies;

  constructor({ rooms, publicRooms, contentGate, sessionIssuer, readAddress, metrics, logger, limiters }) {
    this.#rooms = rooms;
    this.#publicRooms = publicRooms;
    this.#contentGate = contentGate;
    this.#issuer = sessionIssuer;
    this.#metrics = metrics;
    this.#logger = logger;
    this.#guardRate = createRateGuard(readAddress);
    this.#policies = {
      create: ratePolicy(limiters.create, RETRY_AFTER_SECONDS, TOO_MANY_ATTEMPTS_ERROR),
      createPublic: ratePolicy(limiters.createPublic, PUBLIC_RETRY_AFTER_SECONDS, TOO_MANY_PUBLIC_ROOMS_ERROR),
      join: ratePolicy(limiters.join, RETRY_AFTER_SECONDS, TOO_MANY_ATTEMPTS_ERROR),
    };
  }

  resolve(request, body, name) {
    if (body.listingId !== undefined) {
      return { room: this.#joinListed(request, body.listingId, name), isOwner: false };
    }
    if (body.inviteToken !== undefined) {
      return { room: this.#joinByInvite(request, body.inviteToken, name), isOwner: false };
    }
    const room = body.visibility === RoomVisibility.PUBLIC ? this.#openPublic(request, body.title, name) : this.#openPrivate(request, name);
    return { room, isOwner: true };
  }

  #openPrivate(request, name) {
    this.#guardRate(request, this.#policies.create);
    this.#review(name, ModerationProfiles.STANDARD);
    return this.#create({ visibility: RoomVisibility.PRIVATE });
  }

  // Una sala publica necesita titulo (moderado con las reglas estrictas) y lugar en la lista.
  #openPublic(request, rawTitle, name) {
    this.#guardRate(request, this.#policies.create);
    this.#guardRate(request, this.#policies.createPublic);
    if (!this.#publicRooms.hasCapacity) {
      throw apiError(503, ApiErrorCode.PUBLIC_ROOMS_FULL, PUBLIC_ROOMS_FULL_ERROR);
    }
    const title = mapDomainErrors(() => requireRoomTitle(rawTitle));
    this.#review(title, ModerationProfiles.STRICT);
    this.#review(name, ModerationProfiles.STRICT);
    const room = this.#create({ visibility: RoomVisibility.PUBLIC, title });
    this.#publicRooms.add(room);
    return room;
  }

  #joinByInvite(request, inviteToken, name) {
    this.#guardRate(request, this.#policies.join);
    if (typeof inviteToken !== 'string') {
      throw apiError(400, ApiErrorCode.INVALID_INVITE, INVALID_INVITE_ERROR);
    }
    const room = this.#rooms.findByInvite(inviteToken);
    if (!room) {
      this.#metrics.increment(Metric.JOINS_FAILED);
      throw apiError(404, ApiErrorCode.INVITE_NOT_FOUND, INVITE_NOT_FOUND_ERROR);
    }
    return this.#admit(request, room, name);
  }

  #joinListed(request, listingId, name) {
    this.#guardRate(request, this.#policies.join);
    if (typeof listingId !== 'string') {
      throw apiError(400, ApiErrorCode.INVALID_LISTING, INVALID_LISTING_ERROR);
    }
    const room = this.#publicRooms.find(listingId);
    if (!room) {
      this.#metrics.increment(Metric.JOINS_FAILED);
      throw apiError(404, ApiErrorCode.PUBLIC_ROOM_NOT_FOUND, PUBLIC_ROOM_NOT_FOUND_ERROR);
    }
    return this.#admit(request, room, name, () => {
      if (this.#publicRooms.isFull(room)) {
        throw apiError(503, ROOM_FULL_CODE, ROOM_FULL_ERROR);
      }
    });
  }

  // Quien fue expulsado de una sala que veta no vuelve a entrar, por ningun camino. Despues
  // se comprueba el lugar libre (si corresponde) y se modera el nombre con las reglas de la sala.
  #admit(request, room, name, assertHasRoom = () => {}) {
    assertNotBanned(room, this.#issuer.clientRefOf(request));
    assertHasRoom();
    this.#review(name, room.profile);
    return room;
  }

  #create(options) {
    const room = this.#rooms.create(options);
    if (!room) {
      throw apiError(503, ApiErrorCode.SERVER_FULL, SERVER_FULL_ERROR);
    }
    this.#metrics.increment(Metric.ROOMS_CREATED);
    this.#logger.info('room.created', { roomId: room.id, visibility: room.visibility });
    return room;
  }

  #review(text, profile) {
    mapDomainErrors(() => this.#contentGate.reviewWithoutSession(text, profile));
  }
}
