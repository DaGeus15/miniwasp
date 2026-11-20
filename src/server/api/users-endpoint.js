import { MAX_NAME_LENGTH } from '../../shared/limits.js';
import { apiError, ApiErrorCode } from './api-error.js';

const FORBIDDEN_QUERY_CHARACTERS = /\p{C}/u;
const INVALID_QUERY_ERROR = `El parámetro q admite hasta ${MAX_NAME_LENGTH} caracteres visibles`;

function readQuery(request) {
  const rawQuery = new URL(request.url, 'http://localhost').searchParams.get('q') ?? '';
  const query = rawQuery.trim().normalize('NFKC');
  if (query.length > MAX_NAME_LENGTH || FORBIDDEN_QUERY_CHARACTERS.test(query)) {
    throw apiError(400, ApiErrorCode.INVALID_QUERY, INVALID_QUERY_ERROR);
  }
  return query;
}

// Busqueda de personas de la propia sala por parte de su nombre, sin distinguir mayusculas.
// Nunca muestra personas de otras salas. Sin q, lista a todas.
export class UsersEndpoint {
  #authenticator;
  #sessions;
  #videoCalls;
  #responder;

  constructor({ authenticator, sessions, videoCalls, responder }) {
    this.#authenticator = authenticator;
    this.#sessions = sessions;
    this.#videoCalls = videoCalls;
    this.#responder = responder;
  }

  routes() {
    return new Map([['/api/v1/users', { GET: (request, response) => this.#search(request, response) }]]);
  }

  #search(request, response) {
    const { session } = this.#authenticator.authenticate(request);
    const query = readQuery(request);
    const needle = query.toLowerCase();
    const users = this.#sessions
      .findWhere(
        (candidate) =>
          candidate.roomId === session.roomId &&
          typeof candidate.name === 'string' &&
          candidate.name.toLowerCase().includes(needle),
      )
      .map((candidate) => this.#toProfile(candidate, session))
      .sort((first, second) => first.name.localeCompare(second.name));
    this.#responder.json(response, 200, { query, total: users.length, users });
  }

  #toProfile(candidate, viewer) {
    return {
      id: candidate.id,
      name: candidate.name,
      isOwner: candidate.isOwner,
      isYou: candidate.id === viewer.id,
      videocallId: this.#videoCalls.callOf(candidate.id)?.id ?? null,
    };
  }
}
