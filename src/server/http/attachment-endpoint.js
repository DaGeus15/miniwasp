import { FILE_NAME_HEADER } from '../../shared/attachments.js';
import { sendAttachment } from '../attachments/attachment-sender.js';
import { Metric } from '../observability/metrics.js';
import { assertSameOrigin } from './assert-same-origin.js';
import { toHttpError } from './domain-error-mapper.js';
import { HttpError } from './http-error.js';
import { readRawBody } from './read-body.js';

const ATTACHMENT_PATH = /^\/rooms\/attachments\/(?<attachmentId>[\da-f-]{36})$/;
const TOO_MANY_UPLOADS_ERROR = 'Estás enviando archivos muy rápido. Espera un momento.';
const RETRY_AFTER_SECONDS = '30';

export function readFileNameHeader(request) {
  const header = request.headers[FILE_NAME_HEADER.toLowerCase()];
  try {
    return typeof header === 'string' ? decodeURIComponent(header) : '';
  } catch {
    return '';
  }
}

// Adjuntos desde el navegador: subir a la sala propia y descargar los enviados en ella.
// La identidad es la cookie de sesion; subir exige ademas el mismo origen.
export class AttachmentEndpoint {
  #requireSession;
  #rooms;
  #store;
  #uploader;
  #limiter;
  #readAddress;
  #responder;
  #logger;
  #metrics;

  constructor(dependencies) {
    this.#requireSession = dependencies.requireSession;
    this.#rooms = dependencies.rooms;
    this.#store = dependencies.attachments;
    this.#uploader = dependencies.attachmentUploader;
    this.#limiter = dependencies.attachmentLimiter;
    this.#readAddress = dependencies.readAddress;
    this.#responder = dependencies.responder;
    this.#logger = dependencies.logger;
    this.#metrics = dependencies.metrics;
  }

  routes() {
    return new Map([['/rooms/attachments', { POST: (request, response) => this.#upload(request, response) }]]);
  }

  patterns() {
    return [
      {
        pattern: ATTACHMENT_PATH,
        handlers: { GET: (request, response, params) => this.#download(request, response, params) },
      },
    ];
  }

  async #upload(request, response) {
    assertSameOrigin(request);
    const session = this.#requireSession(request);
    if (!this.#limiter.allow(this.#readAddress(request))) {
      throw new HttpError(429, TOO_MANY_UPLOADS_ERROR, { 'Retry-After': RETRY_AFTER_SECONDS });
    }
    try {
      const attachment = await this.#uploader.upload({
        room: this.#rooms.find(session.roomId),
        session,
        rawFileName: readFileNameHeader(request),
        readBytes: (maxBytes) => readRawBody(request, maxBytes),
      });
      this.#metrics.increment(Metric.ATTACHMENTS_UPLOADED);
      this.#logger.info('attachment.uploaded', { roomId: session.roomId, kind: attachment.kind, size: attachment.size });
      this.#responder.json(response, 201, attachment.toPublic());
    } catch (error) {
      throw toHttpError(error);
    }
  }

  async #download(request, response, { attachmentId }) {
    const session = this.#requireSession(request);
    try {
      const room = this.#rooms.find(session.roomId);
      const { attachment, bytes } = await this.#store.readSent(room, attachmentId);
      sendAttachment({ request, response, responder: this.#responder, attachment, bytes });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
