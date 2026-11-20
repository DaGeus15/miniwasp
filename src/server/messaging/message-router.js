import { Metric } from '../observability/metrics.js';
import { ValidationError } from '../validation.js';

const GENERIC_ERROR = 'No se pudo procesar el mensaje';
const RATE_LIMIT_ERROR = 'Estás enviando mensajes muy rápido. Espera unos segundos.';
const UNKNOWN_EVENT_ERROR = 'Mensaje no reconocido';

function parseJson(data) {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

// Una ruta es { limiter, handle(peer, payload) }. Agregar un tipo de mensaje no
// requiere tocar esta clase: basta con registrar otra ruta. Todo mensaje debe declarar
// su tipo; lo que no lo hace (incluido JSON invalido) se rechaza sin llegar a ninguna regla.
export class MessageRouter {
  #routes;
  #unknownRoute;
  #logger;
  #metrics;

  constructor({ routes, fallbackLimiter, logger, metrics }) {
    this.#routes = routes;
    this.#logger = logger;
    this.#metrics = metrics;
    this.#unknownRoute = {
      limiter: fallbackLimiter,
      handle() {
        throw new ValidationError(UNKNOWN_EVENT_ERROR);
      },
    };
  }

  dispatch(peer, data) {
    const payload = parseJson(data);
    const route = this.#routes.get(payload?.type) ?? this.#unknownRoute;

    // Se cuenta por IP: abrir mas conexiones no permite saltarse el limite.
    if (!route.limiter.allow(peer.address)) {
      this.#metrics.increment(Metric.MESSAGES_RATE_LIMITED);
      peer.sendError(RATE_LIMIT_ERROR);
      return;
    }

    try {
      route.handle(peer, payload);
    } catch (error) {
      peer.sendError(this.#describeFailure(error, peer));
    }
  }

  #describeFailure(error, peer) {
    if (error instanceof ValidationError) {
      return error.message;
    }
    this.#metrics.increment(Metric.MESSAGES_FAILED);
    this.#logger.error('message.failed', error, { peerId: peer.id });
    return GENERIC_ERROR;
  }
}
