import { readJsonBody } from '../http/read-body.js';
import { apiError, ApiErrorCode } from './api-error.js';
import { createRateGuard, ratePolicy, withDomainErrors } from './api-request-guard.js';

const MESSAGE_PATH = /^\/api\/v1\/messages\/(?<messageId>[\da-f-]{36})$/;
const REPORT_PATH = /^\/api\/v1\/messages\/(?<messageId>[\da-f-]{36})\/report$/;
// Un texto de 500 caracteres puede ocupar varios bytes por caracter (o escaparse como
// \uXXXX en JSON): el tope del cuerpo es mayor que el de los demas JSON de la API.
const MAX_MESSAGE_BODY_BYTES = 8 * 1024;
const NOT_MESSAGE_AUTHOR_ERROR = 'Solo puedes borrar tus propios mensajes, salvo que hayas creado la sala';
const TOO_MANY_MESSAGES_ERROR = 'Estás enviando mensajes muy rápido. Espera un momento.';
const TOO_MANY_REPORTS_ERROR = 'Demasiados reportes. Espera un minuto.';
const CHAT_RETRY_AFTER_SECONDS = 5;
const REPORT_RETRY_AFTER_SECONDS = 60;

// Mensajes de la sala propia por la API REST: listar, enviar, borrar y reportar. Las reglas
// (moderacion, adjuntos de un solo uso, permisos, reportes) viven en RoomMessenger y son las
// mismas del navegador; los mensajes enviados aqui tambien llegan por WebSocket a la sala.
export class MessagesEndpoint {
  #authenticator;
  #messenger;
  #responder;
  #logger;
  #guardRate;
  #chatRate;
  #reportRate;

  constructor({ authenticator, messenger, chatLimiter, reportLimiter, readAddress, responder, logger }) {
    this.#authenticator = authenticator;
    this.#messenger = messenger;
    this.#responder = responder;
    this.#logger = logger;
    this.#guardRate = createRateGuard(readAddress);
    this.#chatRate = ratePolicy(chatLimiter, CHAT_RETRY_AFTER_SECONDS, TOO_MANY_MESSAGES_ERROR);
    this.#reportRate = ratePolicy(reportLimiter, REPORT_RETRY_AFTER_SECONDS, TOO_MANY_REPORTS_ERROR);
  }

  routes() {
    return new Map([
      [
        '/api/v1/messages',
        {
          GET: (request, response) => this.#list(request, response),
          POST: (request, response) => this.#send(request, response),
        },
      ],
    ]);
  }

  patterns() {
    return [
      {
        pattern: MESSAGE_PATH,
        handlers: { DELETE: (request, response, params) => this.#delete(request, response, params) },
      },
      {
        pattern: REPORT_PATH,
        handlers: { POST: (request, response, params) => this.#report(request, response, params) },
      },
    ];
  }

  #list(request, response) {
    const { room } = this.#authenticator.authenticate(request);
    this.#responder.json(response, 200, { messages: room.chat.history() });
  }

  // El autor es siempre el nombre de la sesion: un campo "name" en el cuerpo se ignora.
  async #send(request, response) {
    const { session, room } = this.#authenticator.authenticate(request);
    this.#guardRate(request, this.#chatRate);
    const { text, attachmentId } = Object(await readJsonBody(request, MAX_MESSAGE_BODY_BYTES));
    const message = await withDomainErrors(() =>
      this.#messenger.send({ room, session, name: session.name, text, attachmentId }),
    );
    this.#logger.info('api.message.sent', { roomId: room.id, hasAttachment: message.attachment !== undefined });
    this.#responder.json(response, 201, { message });
  }

  // Borrar es idempotente: un mensaje que ya no existe (o nunca existio en esta sala)
  // responde 204 igual. Solo su autor o quien creo la sala pueden borrar uno que existe.
  #delete(request, response, { messageId }) {
    const { session, room } = this.#authenticator.authenticate(request);
    this.#guardRate(request, this.#chatRate);
    if (room.chat.has(messageId)) {
      if (!session.isOwner && !room.chat.isAuthor(messageId, session.id)) {
        throw apiError(403, ApiErrorCode.NOT_MESSAGE_AUTHOR, NOT_MESSAGE_AUTHOR_ERROR);
      }
      this.#messenger.delete({ room, session, messageId });
      this.#logger.info('api.message.deleted', { roomId: room.id });
    }
    this.#responder.empty(response);
  }

  // Un reporte siempre se acepta (202): reportar dos veces, un mensaje propio o uno que no
  // existe no tiene efecto, y la respuesta no revela cual de los casos ocurrio.
  #report(request, response, { messageId }) {
    const { session, room } = this.#authenticator.authenticate(request);
    this.#guardRate(request, this.#reportRate);
    this.#messenger.report({ room, session, messageId });
    this.#responder.json(response, 202, { status: 'reported' });
  }
}
