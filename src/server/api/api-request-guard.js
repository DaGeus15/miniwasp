import { toHttpError } from '../http/domain-error-mapper.js';
import { apiError, ApiErrorCode } from './api-error.js';

// Una politica de limite: el limitador compartido con el navegador, cuanto esperar y que
// mensaje mostrar cuando se supera.
export function ratePolicy(limiter, retryAfterSeconds, message) {
  return Object.freeze({ limiter, retryAfterSeconds, message });
}

// Devuelve una funcion que rechaza con 429 RATE_LIMITED a la direccion que supero el limite
// de la politica indicada. La direccion se lee igual que en el resto del servidor.
export function createRateGuard(readAddress) {
  return (request, { limiter, retryAfterSeconds, message }) => {
    if (!limiter.allow(readAddress(request))) {
      throw apiError(429, ApiErrorCode.RATE_LIMITED, message, { 'Retry-After': String(retryAfterSeconds) });
    }
  };
}

// Ejecuta una accion del dominio y traduce sus errores (adjunto, moderacion, validacion) a
// respuestas HTTP con codigo estable. Un fallo inesperado sigue igual y termina como 500.
export async function withDomainErrors(action) {
  try {
    return await action();
  } catch (error) {
    throw toHttpError(error);
  }
}

// Version sincronica de withDomainErrors, para validar y moderar antes de crear nada.
export function mapDomainErrors(action) {
  try {
    return action();
  } catch (error) {
    throw toHttpError(error);
  }
}
