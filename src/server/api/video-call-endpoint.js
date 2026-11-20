import { Metric } from '../observability/metrics.js';
import { apiError, ApiErrorCode } from './api-error.js';
import { VIDEO_CALL_CAPACITY } from './video-call.js';
import { VideoCallRefusal } from './video-call-registry.js';

const CALL_PATH = /^\/api\/v1\/videocalls\/(?<callId>[\da-f-]{36})$/;
const JOIN_PATH = /^\/api\/v1\/videocalls\/(?<callId>[\da-f-]{36})\/join$/;
const LEAVE_PATH = /^\/api\/v1\/videocalls\/(?<callId>[\da-f-]{36})\/leave$/;

// Como se comunica cada negativa del registro: [estado HTTP, codigo, mensaje].
const REFUSAL_RESPONSES = new Map([
  [VideoCallRefusal.NOT_FOUND, [404, ApiErrorCode.CALL_NOT_FOUND, 'La videollamada no existe o ya terminó']],
  [
    VideoCallRefusal.FULL,
    [409, ApiErrorCode.CALL_FULL, `La videollamada está llena: admite ${VIDEO_CALL_CAPACITY} personas`],
  ],
  [
    VideoCallRefusal.BUSY,
    [409, ApiErrorCode.ALREADY_IN_CALL, 'Ya estás en otra videollamada. Sal de ella antes de entrar a otra.'],
  ],
  [VideoCallRefusal.NOT_PARTICIPANT, [403, ApiErrorCode.NOT_A_PARTICIPANT, 'No participas en esta videollamada']],
]);

function unwrap({ call, refusal }) {
  if (refusal) {
    const [statusCode, code, message] = REFUSAL_RESPONSES.get(refusal);
    throw apiError(statusCode, code, message);
  }
  return call;
}

// Videollamadas uno a uno de la API: crear (y entrar), consultar, entrar y salir.
// Un tercero que intenta entrar a una llamada con dos personas recibe 409 CALL_FULL.
export class VideoCallEndpoint {
  #authenticator;
  #videoCalls;
  #responder;
  #logger;
  #metrics;

  constructor({ authenticator, videoCalls, responder, logger, metrics }) {
    this.#authenticator = authenticator;
    this.#videoCalls = videoCalls;
    this.#responder = responder;
    this.#logger = logger;
    this.#metrics = metrics;
  }

  routes() {
    return new Map([['/api/v1/videocalls', { POST: (request, response) => this.#start(request, response) }]]);
  }

  patterns() {
    return [
      { pattern: CALL_PATH, handlers: { GET: (request, response, params) => this.#show(request, response, params) } },
      { pattern: JOIN_PATH, handlers: { POST: (request, response, params) => this.#join(request, response, params) } },
      { pattern: LEAVE_PATH, handlers: { POST: (request, response, params) => this.#leave(request, response, params) } },
    ];
  }

  #start(request, response) {
    const { session } = this.#authenticator.authenticate(request);
    const call = unwrap(this.#videoCalls.start(session));
    this.#metrics.increment(Metric.VIDEOCALLS_STARTED);
    this.#logger.info('videocall.started', { callId: call.id, roomId: call.roomId });
    this.#responder.json(response, 201, call.toPublic());
  }

  #show(request, response, { callId }) {
    const { session } = this.#authenticator.authenticate(request);
    const call = this.#videoCalls.find(session, callId) ?? unwrap({ refusal: VideoCallRefusal.NOT_FOUND });
    this.#responder.json(response, 200, call.toPublic());
  }

  #join(request, response, { callId }) {
    const { session } = this.#authenticator.authenticate(request);
    const result = this.#videoCalls.join(session, callId);
    if (result.refusal) {
      this.#metrics.increment(Metric.VIDEOCALL_JOINS_DENIED);
      this.#logger.warn('videocall.join.denied', { callId, reason: result.refusal });
    }
    const call = unwrap(result);
    this.#logger.info('videocall.joined', { callId: call.id });
    this.#responder.json(response, 200, call.toPublic());
  }

  #leave(request, response, { callId }) {
    const { session } = this.#authenticator.authenticate(request);
    unwrap(this.#videoCalls.leave(session, callId));
    this.#logger.info('videocall.left', { callId });
    this.#responder.empty(response);
  }
}
