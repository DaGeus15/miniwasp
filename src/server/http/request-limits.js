import { HttpError } from './http-error.js';

const TOO_MANY_ATTEMPTS_ERROR = 'Demasiados intentos. Espera un minuto.';
const RETRY_AFTER_SECONDS = '60';

// Corta una peticion del navegador que supera su limite por IP. Solo registra la huella
// seudonima de la direccion, nunca la IP.
export function assertWithinLimit({ limiter, address, logger, clientRef }) {
  if (!limiter.allow(address)) {
    logger.warn('http.rate_limited', { clientRef });
    throw new HttpError(429, TOO_MANY_ATTEMPTS_ERROR, { 'Retry-After': RETRY_AFTER_SECONDS });
  }
}
