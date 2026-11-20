import { HttpError } from '../http/http-error.js';

// Codigos propios de la API REST. Cada uno identifica una situacion concreta, mas fina que
// el estado HTTP (por ejemplo, dos 409 distintos: llamada llena o persona ocupada).
export const ApiErrorCode = Object.freeze({
  TOKEN_MISSING: 'TOKEN_MISSING',
  TOKEN_INVALID: 'TOKEN_INVALID',
  INVALID_NAME: 'INVALID_NAME',
  INVALID_INVITE: 'INVALID_INVITE',
  INVITE_NOT_FOUND: 'INVITE_NOT_FOUND',
  NAME_TAKEN: 'NAME_TAKEN',
  SERVER_FULL: 'SERVER_FULL',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_QUERY: 'INVALID_QUERY',
  CALL_NOT_FOUND: 'CALL_NOT_FOUND',
  CALL_FULL: 'CALL_FULL',
  ALREADY_IN_CALL: 'ALREADY_IN_CALL',
  NOT_A_PARTICIPANT: 'NOT_A_PARTICIPANT',
  NOT_MESSAGE_AUTHOR: 'NOT_MESSAGE_AUTHOR',
  INVALID_LISTING: 'INVALID_LISTING',
  PUBLIC_ROOM_NOT_FOUND: 'PUBLIC_ROOM_NOT_FOUND',
  PUBLIC_ROOMS_FULL: 'PUBLIC_ROOMS_FULL',
});

export function apiError(statusCode, code, message, headers = {}) {
  return new HttpError(statusCode, message, headers, code);
}
