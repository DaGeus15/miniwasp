import { defaultErrorCode } from './error-codes.js';

const JSON_TYPE = 'application/json; charset=utf-8';
// Ninguna respuesta se guarda en caches compartidas ni se reutiliza sin revalidar.
const NO_STORE = { 'Cache-Control': 'no-cache, no-store, must-revalidate' };

// Unico punto que escribe respuestas: ninguna puede salir sin las cabeceras de seguridad.
export class HttpResponder {
  #securityHeaders;

  constructor(securityHeaders) {
    this.#securityHeaders = securityHeaders;
  }

  json(response, statusCode, payload) {
    this.#send(response, statusCode, { ...NO_STORE, 'Content-Type': JSON_TYPE }, JSON.stringify(payload));
  }

  error(response, statusCode, message, headers = {}, code = defaultErrorCode(statusCode)) {
    this.#send(
      response,
      statusCode,
      { ...NO_STORE, ...headers, 'Content-Type': JSON_TYPE },
      JSON.stringify({ error: message, code }),
    );
  }

  empty(response, headers = {}) {
    this.#send(response, 204, { ...NO_STORE, ...headers });
  }

  asset(response, contentType, body) {
    this.#send(response, 200, { ...NO_STORE, 'Content-Type': contentType }, body);
  }

  // Contenido que subio una persona. Sus cabeceras pueden endurecer las de seguridad (por
  // ejemplo, una CSP con sandbox), pero nunca quitar ninguna.
  file(response, statusCode, headers, body) {
    this.#send(response, statusCode, { ...NO_STORE, ...headers }, body);
  }

  #send(response, statusCode, headers, body) {
    response.writeHead(statusCode, { ...this.#securityHeaders, ...headers });
    response.end(body);
  }
}
