// Codigo estable por estado HTTP. El campo "error" esta pensado para personas; "code" permite
// que un cliente (o una prueba en Insomnia) decida sin depender del texto.
const CODES_BY_STATUS = new Map([
  [400, 'BAD_REQUEST'],
  [401, 'UNAUTHORIZED'],
  [403, 'FORBIDDEN'],
  [404, 'NOT_FOUND'],
  [405, 'METHOD_NOT_ALLOWED'],
  [409, 'CONFLICT'],
  [413, 'PAYLOAD_TOO_LARGE'],
  [415, 'UNSUPPORTED_MEDIA_TYPE'],
  [429, 'TOO_MANY_REQUESTS'],
  [500, 'INTERNAL_ERROR'],
  [503, 'SERVICE_UNAVAILABLE'],
]);

const UNKNOWN_ERROR_CODE = 'ERROR';

export function defaultErrorCode(statusCode) {
  return CODES_BY_STATUS.get(statusCode) ?? UNKNOWN_ERROR_CODE;
}
