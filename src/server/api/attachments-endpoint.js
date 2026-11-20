import { sendAttachment } from '../attachments/attachment-sender.js';
import { readFileNameHeader } from '../http/attachment-endpoint.js';
import { readRawBody } from '../http/read-body.js';
import { Metric } from '../observability/metrics.js';
import { createRateGuard, ratePolicy, withDomainErrors } from './api-request-guard.js';

const ATTACHMENT_PATH = /^\/api\/v1\/attachments\/(?<attachmentId>[\da-f-]{36})$/;
const TOO_MANY_UPLOADS_ERROR = 'Estás enviando archivos muy rápido. Espera un momento.';
const UPLOAD_RETRY_AFTER_SECONDS = 30;

// Adjuntos por la API REST, con el mismo recorrido que el navegador: el cuerpo es el archivo
// tal cual y su nombre viaja codificado en X-File-Name. Un adjunto subido solo lo conoce
// quien lo subio; se descarga recien cuando se envio en un mensaje, y solo desde su sala.
export class ApiAttachmentsEndpoint {
  #authenticator;
  #store;
  #uploader;
  #responder;
  #logger;
  #metrics;
  #guardRate;
  #uploadRate;

  constructor(dependencies) {
    this.#authenticator = dependencies.authenticator;
    this.#store = dependencies.attachments;
    this.#uploader = dependencies.attachmentUploader;
    this.#responder = dependencies.responder;
    this.#logger = dependencies.logger;
    this.#metrics = dependencies.metrics;
    this.#guardRate = createRateGuard(dependencies.readAddress);
    this.#uploadRate = ratePolicy(dependencies.attachmentLimiter, UPLOAD_RETRY_AFTER_SECONDS, TOO_MANY_UPLOADS_ERROR);
  }

  routes() {
    return new Map([['/api/v1/attachments', { POST: (request, response) => this.#upload(request, response) }]]);
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
    const { session, room } = this.#authenticator.authenticate(request);
    this.#guardRate(request, this.#uploadRate);
    const attachment = await withDomainErrors(() =>
      this.#uploader.upload({
        room,
        session,
        rawFileName: readFileNameHeader(request),
        readBytes: (maxBytes) => readRawBody(request, maxBytes),
      }),
    );
    this.#metrics.increment(Metric.ATTACHMENTS_UPLOADED);
    this.#logger.info('api.attachment.uploaded', { roomId: room.id, kind: attachment.kind, size: attachment.size });
    this.#responder.json(response, 201, attachment.toPublic());
  }

  // Mismas cabeceras endurecidas y soporte de Range que la descarga del navegador.
  async #download(request, response, { attachmentId }) {
    const { room } = this.#authenticator.authenticate(request);
    const { attachment, bytes } = await withDomainErrors(() => this.#store.readSent(room, attachmentId));
    sendAttachment({ request, response, responder: this.#responder, attachment, bytes });
  }
}
