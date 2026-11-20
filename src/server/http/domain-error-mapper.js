import { AttachmentError, AttachmentRefusal } from '../attachments/attachment-error.js';
import { ContentBlockedError } from '../moderation/content-blocked-error.js';
import { SessionMutedError } from '../moderation/content-gate.js';
import { ValidationError } from '../validation.js';
import { HttpError } from './http-error.js';

// Codigos estables de los errores del dominio, iguales en el navegador y en la API REST.
export const DomainErrorCode = Object.freeze({
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  STORAGE_FULL: 'STORAGE_FULL',
  SERVER_BUSY: 'SERVER_BUSY',
  ATTACHMENT_NOT_FOUND: 'ATTACHMENT_NOT_FOUND',
  CONTENT_BLOCKED: 'CONTENT_BLOCKED',
  SENDER_MUTED: 'SENDER_MUTED',
  INVALID_INPUT: 'INVALID_INPUT',
});

const RETRY_SOON = { 'Retry-After': '5' };

const ATTACHMENT_RESPONSES = new Map([
  [AttachmentRefusal.TYPE_NOT_ALLOWED, [415, DomainErrorCode.FILE_TYPE_NOT_ALLOWED, {}]],
  [AttachmentRefusal.TOO_LARGE, [413, DomainErrorCode.FILE_TOO_LARGE, {}]],
  [AttachmentRefusal.STORAGE_FULL, [507, DomainErrorCode.STORAGE_FULL, {}]],
  [AttachmentRefusal.BUSY, [503, DomainErrorCode.SERVER_BUSY, RETRY_SOON]],
  [AttachmentRefusal.NOT_FOUND, [404, DomainErrorCode.ATTACHMENT_NOT_FOUND, {}]],
]);

// Traduce un error del dominio a su respuesta HTTP. Lo que no es del dominio (un fallo
// inesperado) sigue igual y termina como 500 sin revelar detalles.
export function toHttpError(error) {
  if (error instanceof AttachmentError) {
    const [statusCode, code, headers] = ATTACHMENT_RESPONSES.get(error.refusal);
    return new HttpError(statusCode, error.message, headers, code);
  }
  if (error instanceof ContentBlockedError) {
    return new HttpError(422, error.message, {}, DomainErrorCode.CONTENT_BLOCKED);
  }
  if (error instanceof SessionMutedError) {
    return new HttpError(429, error.message, { 'Retry-After': String(error.retryAfterSeconds) }, DomainErrorCode.SENDER_MUTED);
  }
  if (error instanceof ValidationError) {
    return new HttpError(400, error.message, {}, DomainErrorCode.INVALID_INPUT);
  }
  return error;
}
