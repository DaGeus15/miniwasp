import { defaultErrorCode } from './error-codes.js';

// Error esperado de una peticion. Su mensaje esta pensado para mostrarse al cliente y su
// codigo para que un programa lo distinga sin leer el texto.
export class HttpError extends Error {
  name = 'HttpError';

  constructor(statusCode, message, headers = {}, code = defaultErrorCode(statusCode)) {
    super(message);
    this.statusCode = statusCode;
    this.headers = headers;
    this.code = code;
  }
}
