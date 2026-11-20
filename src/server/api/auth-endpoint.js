import { assertSameOrigin } from '../http/assert-same-origin.js';
import { requireAcceptedRules } from '../http/community-rules.js';
import { readJsonBody } from '../http/read-body.js';
import { Metric } from '../observability/metrics.js';
import { requireName } from '../validation.js';
import { apiError, ApiErrorCode } from './api-error.js';

const TOKEN_TYPE = 'Bearer';
const NAME_TAKEN_ERROR = 'Ese nombre ya lo usa otra persona de esta sala';
const SERVER_FULL_ERROR = 'El servidor está lleno por ahora. Inténtalo más tarde.';

// requireName solo lanza ValidationError, cuyo mensaje esta pensado para mostrarse.
function requireApiName(rawName) {
  try {
    return requireName(rawName);
  } catch (error) {
    throw apiError(400, ApiErrorCode.INVALID_NAME, error.message);
  }
}

// Lo que necesita saber un cliente de la sala en la que entro. listingId y title solo tienen
// valor en las salas publicas.
function describeRoom(room) {
  return {
    id: room.id,
    inviteToken: room.inviteToken,
    visibility: room.visibility,
    title: room.title,
    listingId: room.listingId,
  };
}

// Inicio y cierre de sesion de la API REST. ApiRoomResolver decide la sala: una privada nueva
// (quien entra es su dueno), una publica nueva, una existente por invitacion o una de la lista
// publica. El nombre queda reservado en la sala mientras dure la sesion y el token viaja en
// Authorization: Bearer. La sesion guarda la huella seudonima de la IP, como en el navegador,
// para que una expulsion de una sala publica tambien impida volver por la API.
export class ApiAuthEndpoint {
  #authenticator;
  #resolver;
  #rooms;
  #sessions;
  #issuer;
  #responder;
  #logger;
  #metrics;
  #onLogout;

  constructor(dependencies) {
    this.#authenticator = dependencies.authenticator;
    this.#resolver = dependencies.resolver;
    this.#rooms = dependencies.rooms;
    this.#sessions = dependencies.sessions;
    this.#issuer = dependencies.sessionIssuer;
    this.#responder = dependencies.responder;
    this.#logger = dependencies.logger;
    this.#metrics = dependencies.metrics;
    this.#onLogout = dependencies.onLogout;
  }

  routes() {
    return new Map([
      ['/api/v1/auth/login', { POST: (request, response) => this.#login(request, response) }],
      ['/api/v1/auth/logout', { POST: (request, response) => this.#logout(request, response) }],
    ]);
  }

  async #login(request, response) {
    assertSameOrigin(request);
    const body = Object(await readJsonBody(request));
    requireAcceptedRules(body);
    const name = requireApiName(body.name);
    const { room, isOwner } = this.#resolver.resolve(request, body, name);
    const { token, session } = this.#startSession(request, room, { name, isOwner });
    this.#metrics.increment(Metric.API_LOGINS);
    this.#logger.info('api.login', { roomId: room.id, sessionId: session.id, isOwner, visibility: room.visibility });
    this.#responder.json(response, 201, {
      tokenType: TOKEN_TYPE,
      accessToken: token,
      expiresIn: Math.floor(this.#sessions.ttlMs / 1000),
      user: { id: session.id, name: session.name, isOwner },
      room: describeRoom(room),
    });
  }

  #logout(request, response) {
    const { token, session, room } = this.#authenticator.authenticate(request);
    this.#sessions.revoke(token);
    this.#onLogout(session, room);
    this.#logger.info('api.logout', { sessionId: session.id });
    this.#responder.empty(response);
  }

  #startSession(request, room, { name, isOwner }) {
    if (!room.names.isAvailableFor(null, name)) {
      throw apiError(409, ApiErrorCode.NAME_TAKEN, NAME_TAKEN_ERROR);
    }
    const clientRef = this.#issuer.clientRefOf(request);
    const created = this.#sessions.create({ roomId: room.id, isOwner, name, clientRef });
    if (!created) {
      throw apiError(503, ApiErrorCode.SERVER_FULL, SERVER_FULL_ERROR);
    }
    room.names.claim(created.session.id, name);
    this.#rooms.markOccupied(room);
    return created;
  }
}
