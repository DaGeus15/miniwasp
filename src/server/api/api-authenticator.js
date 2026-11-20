import { apiError, ApiErrorCode } from './api-error.js';

const BEARER_PATTERN = /^Bearer\s+([\w-]+)$/i;
const CHALLENGE = 'Bearer realm="miniwasp"';
const TOKEN_MISSING_ERROR = 'Falta el encabezado Authorization: Bearer <token>';
const TOKEN_INVALID_ERROR = 'El token no es válido, expiró o la sesión ya se cerró';

export function readBearerToken(request) {
  const header = request.headers.authorization;
  return typeof header === 'string' ? (BEARER_PATTERN.exec(header.trim())?.[1] ?? null) : null;
}

// Identifica a quien llama a la API por su token Bearer. Solo valen las sesiones creadas por
// la API (tienen nombre) cuya sala sigue abierta. Un token mal formado, inventado, vencido o
// revocado recibe la misma respuesta: no se revela cual de los casos ocurrio.
export class ApiAuthenticator {
  #sessions;
  #rooms;

  constructor({ sessions, rooms }) {
    this.#sessions = sessions;
    this.#rooms = rooms;
  }

  authenticate(request) {
    if (request.headers.authorization === undefined) {
      throw apiError(401, ApiErrorCode.TOKEN_MISSING, TOKEN_MISSING_ERROR, {
        'WWW-Authenticate': CHALLENGE,
      });
    }
    const token = readBearerToken(request);
    const session = this.#sessions.find(token);
    const room = session?.name ? this.#rooms.find(session.roomId) : null;
    if (!room) {
      throw apiError(401, ApiErrorCode.TOKEN_INVALID, TOKEN_INVALID_ERROR, {
        'WWW-Authenticate': `${CHALLENGE}, error="invalid_token"`,
      });
    }
    return { token, session, room };
  }
}
