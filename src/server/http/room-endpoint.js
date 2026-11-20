import { ModerationProfiles } from '../moderation/moderation-profile.js';
import { Metric } from '../observability/metrics.js';
import { RoomVisibility } from '../rooms/room.js';
import { createExpiredSessionCookie, readSessionToken } from '../security/session-cookie.js';
import { requireRoomTitle } from '../validation.js';
import { assertSameOrigin } from './assert-same-origin.js';
import { requireAcceptedRules } from './community-rules.js';
import { toHttpError } from './domain-error-mapper.js';
import { HttpError } from './http-error.js';
import { readJsonBody } from './read-body.js';
import { assertWithinLimit } from './request-limits.js';

const NO_SESSION_ERROR = 'No estás en ninguna sala';
const ROOM_NOT_FOUND_ERROR = 'La sala no existe o el enlace ya no es válido';
const SERVER_FULL_ERROR = 'El servidor está lleno por ahora. Inténtalo más tarde.';
const PUBLIC_ROOMS_FULL_ERROR = 'Hay demasiadas salas públicas abiertas. Inténtalo más tarde.';
export const BANNED_ERROR = 'No puedes volver a entrar a esta sala';
export const BANNED_CODE = 'BANNED_FROM_ROOM';

// Ciclo de vida de una persona en una sala: crearla (privada o publica), unirse por
// invitacion, consultar y salir. Cada sesion pertenece a una sola sala, fijada al crearla.
export class RoomEndpoint {
  #rooms;
  #sessions;
  #publicRooms;
  #issuer;
  #contentGate;
  #limiters;
  #readAddress;
  #responder;
  #metrics;
  #logger;

  constructor(dependencies) {
    this.#rooms = dependencies.rooms;
    this.#sessions = dependencies.sessions;
    this.#publicRooms = dependencies.publicRooms;
    this.#issuer = dependencies.sessionIssuer;
    this.#contentGate = dependencies.contentGate;
    this.#limiters = dependencies.limiters;
    this.#readAddress = dependencies.readAddress;
    this.#responder = dependencies.responder;
    this.#metrics = dependencies.metrics;
    this.#logger = dependencies.logger;
  }

  routes() {
    return new Map([
      ['/rooms', { POST: (request, response) => this.#create(request, response) }],
      ['/rooms/join', { POST: (request, response) => this.#join(request, response) }],
      [
        '/session',
        {
          GET: (request, response) => this.#status(request, response),
          DELETE: (request, response) => this.#leave(request, response),
        },
      ],
    ]);
  }

  // Una sesion solo es valida mientras su sala siga existiendo.
  requireSession(request) {
    const session = this.#sessions.find(readSessionToken(request));
    if (!session || !this.#rooms.find(session.roomId)) {
      throw new HttpError(401, NO_SESSION_ERROR);
    }
    return session;
  }

  async #create(request, response) {
    this.#assertAllowed(request, this.#limiters.create);
    const body = await readJsonBody(request);
    requireAcceptedRules(body);
    const options = this.#readRoomOptions(request, body);
    const room = this.#rooms.create(options);
    if (!room) {
      throw new HttpError(503, SERVER_FULL_ERROR);
    }
    this.#publicRooms.add(room);
    this.#metrics.increment(Metric.ROOMS_CREATED);
    this.#logger.info('room.created', { roomId: room.id, visibility: room.visibility });
    this.#issuer.issue(request, response, { roomId: room.id, isOwner: true });
  }

  async #join(request, response) {
    this.#assertAllowed(request, this.#limiters.join);
    const body = await readJsonBody(request);
    requireAcceptedRules(body);
    const { inviteToken } = body;
    const room = typeof inviteToken === 'string' ? this.#rooms.findByInvite(inviteToken) : null;
    if (!room) {
      this.#metrics.increment(Metric.JOINS_FAILED);
      this.#logger.warn('room.join.denied', { clientRef: this.#issuer.clientRefOf(request) });
      throw new HttpError(404, ROOM_NOT_FOUND_ERROR);
    }
    assertNotBanned(room, this.#issuer.clientRefOf(request));
    this.#logger.info('room.joined', { roomId: room.id });
    this.#issuer.issue(request, response, { roomId: room.id, isOwner: false });
  }

  #status(request, response) {
    const session = this.requireSession(request);
    const room = this.#rooms.find(session.roomId);
    this.#responder.json(response, 200, {
      inviteToken: room.inviteToken,
      isOwner: session.isOwner,
      visibility: room.visibility,
      title: room.title,
    });
  }

  #leave(request, response) {
    assertSameOrigin(request);
    this.#issuer.endCurrent(request);
    this.#responder.empty(response, { 'Set-Cookie': createExpiredSessionCookie() });
  }

  // Una sala publica necesita titulo (moderado con las reglas estrictas) y lugar en la lista.
  #readRoomOptions(request, { visibility, title }) {
    if (visibility !== RoomVisibility.PUBLIC) {
      return { visibility: RoomVisibility.PRIVATE };
    }
    this.#assertAllowed(request, this.#limiters.createPublic);
    if (!this.#publicRooms.hasCapacity) {
      throw new HttpError(503, PUBLIC_ROOMS_FULL_ERROR);
    }
    try {
      const safeTitle = requireRoomTitle(title);
      this.#contentGate.reviewWithoutSession(safeTitle, ModerationProfiles.STRICT);
      return { visibility: RoomVisibility.PUBLIC, title: safeTitle };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  #assertAllowed(request, limiter) {
    assertSameOrigin(request);
    assertWithinLimit({
      limiter,
      address: this.#readAddress(request),
      logger: this.#logger,
      clientRef: this.#issuer.clientRefOf(request),
    });
  }
}

// Quien fue expulsado de una sala que veta (las publicas) no puede volver a entrar.
export function assertNotBanned(room, clientRef) {
  if (room.bans.isBanned(clientRef)) {
    throw new HttpError(403, BANNED_ERROR, {}, BANNED_CODE);
  }
}
