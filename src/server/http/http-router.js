import { randomUUID } from 'node:crypto';
import { Metric } from '../observability/metrics.js';
import { HttpError } from './http-error.js';

const INTERNAL_ERROR = 'Error interno';
const BAD_REQUEST_ERROR = 'Solicitud mal formada';
const METHOD_NOT_ALLOWED_ERROR = 'Método no permitido';
const REQUEST_ID_HEADER = 'X-Request-Id';

function parsePathname(url) {
  if (!URL.canParse(url, 'http://localhost')) {
    throw new HttpError(400, BAD_REQUEST_ERROR);
  }
  return new URL(url, 'http://localhost').pathname;
}

// Una ruta asocia una ruta URL con { METODO: handler }. Las rutas con parametros usan una
// expresion con grupos con nombre, que llegan al handler como tercer argumento. Lo que no
// esta registrado pasa al manejador de archivos estaticos.
export class HttpRouter {
  #routes;
  #patterns;
  #fallback;
  #responder;
  #logger;
  #metrics;

  constructor({ routes, patterns = [], fallback, responder, logger, metrics }) {
    this.#routes = routes;
    this.#patterns = patterns;
    this.#fallback = fallback;
    this.#responder = responder;
    this.#logger = logger;
    this.#metrics = metrics;
  }

  async handle(request, response) {
    const requestId = randomUUID();
    response.setHeader(REQUEST_ID_HEADER, requestId);

    try {
      await this.#dispatch(request, response, parsePathname(request.url));
    } catch (error) {
      this.#respondToFailure(response, error, requestId);
    }
  }

  async #dispatch(request, response, pathname) {
    const route = this.#resolve(pathname);
    if (!route) {
      await this.#fallback(request, response, pathname);
      return;
    }

    const handler = route.handlers[request.method];
    if (!handler) {
      this.#responder.error(response, 405, METHOD_NOT_ALLOWED_ERROR, {
        Allow: Object.keys(route.handlers).join(', '),
      });
      return;
    }
    await handler(request, response, route.params);
  }

  #resolve(pathname) {
    const handlers = this.#routes.get(pathname);
    if (handlers) {
      return { handlers, params: {} };
    }
    for (const { pattern, handlers: patternHandlers } of this.#patterns) {
      const match = pattern.exec(pathname);
      if (match) {
        return { handlers: patternHandlers, params: { ...match.groups } };
      }
    }
    return null;
  }

  #respondToFailure(response, error, requestId) {
    if (error instanceof HttpError) {
      this.#responder.error(response, error.statusCode, error.message, error.headers, error.code);
      return;
    }
    this.#metrics.increment(Metric.HTTP_ERRORS);
    this.#logger.error('http.request.failed', error, { requestId });
    this.#responder.error(response, 500, INTERNAL_ERROR);
  }
}
