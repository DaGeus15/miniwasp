import { isSameOrigin } from '../security/origin-guard.js';
import { HttpError } from './http-error.js';

const FORBIDDEN_ORIGIN_ERROR = 'Origen no permitido';

// Una pagina de otro origen no puede crear salas ni sesiones desde el navegador de un visitante.
export function assertSameOrigin(request) {
  if (!isSameOrigin(request.headers.origin, request.headers.host)) {
    throw new HttpError(403, FORBIDDEN_ORIGIN_ERROR);
  }
}
