import { ServerEvent } from '../../shared/events.js';
import { readMessageText } from '../chat/chat-room.js';
import { Metric } from '../observability/metrics.js';
import { ValidationError } from '../validation.js';
import { SlowMode } from './slow-mode.js';

const NOT_ALLOWED_TO_DELETE_ERROR = 'Solo puedes borrar tus propios mensajes';

// Publicar, borrar y reportar mensajes de una sala. Lo usan por igual el WebSocket del
// navegador y la API REST, asi que las reglas viven en un solo lugar.
export class RoomMessenger {
  #peers;
  #attachments;
  #contentGate;
  #slowMode;
  #metrics;
  #logger;

  // slowMode: recuerda cuando escribio cada sesion por ultima vez en salas con modo lento.
  constructor({ peers, attachments, contentGate, slowMode = new SlowMode(), metrics, logger }) {
    this.#peers = peers;
    this.#slowMode = slowMode;
    this.#attachments = attachments;
    this.#contentGate = contentGate;
    this.#metrics = metrics;
    this.#logger = logger;
  }

  // Todo se valida y modera antes de tocar el adjunto: un mensaje rechazado no lo consume.
  send({ room, session, name, text, attachmentId }) {
    const hasAttachment = attachmentId !== undefined && attachmentId !== null;
    const caption = readMessageText(text, hasAttachment);
    const { profile } = room;
    this.#contentGate.reviewText(session, name, profile);
    if (caption) {
      this.#contentGate.reviewText(session, caption, profile);
    }
    this.#slowMode.claimTurn(session.id, profile.slowModeMs);
    const attachment = hasAttachment
      ? this.#attachments.claim({ roomId: room.id, sessionId: session.id, attachmentId: String(attachmentId) })
      : null;
    const message = room.chat.post({ name, text: caption, attachment: attachment?.toPublic(), authorSessionId: session.id });
    this.#peers.broadcast(room.id, { type: ServerEvent.MESSAGE, message });
    return message;
  }

  forgetSession(sessionId) {
    this.#slowMode.forget(sessionId);
  }

  // Borra para todas las personas. Puede hacerlo quien lo envio o quien creo la sala.
  delete({ room, session, messageId }) {
    if (!session.isOwner && !room.chat.isAuthor(messageId, session.id)) {
      throw new ValidationError(NOT_ALLOWED_TO_DELETE_ERROR);
    }
    this.#remove(room, messageId);
  }

  // Un reporte avisa a quien creo la sala. Con varios reportes de personas distintas (segun
  // la sala) el mensaje se borra solo, sin depender de que quien la creo este conectada.
  // Reportar un mensaje propio no tiene efecto.
  report({ room, session, messageId }) {
    if (room.chat.isAuthor(messageId, session.id)) {
      return;
    }
    const reports = room.chat.report(messageId, session.id);
    if (reports === 0) {
      return;
    }
    this.#metrics.increment(Metric.MESSAGES_REPORTED);
    this.#logger.info('message.reported', { roomId: room.id, reports });
    if (reports >= room.profile.reportsToRemove) {
      this.#remove(room, messageId);
      return;
    }
    this.#peers.notifyOwners(room.id, { type: ServerEvent.MESSAGE_REPORTED, messageId, reports });
  }

  #remove(room, messageId) {
    if (room.chat.remove(messageId)) {
      this.#metrics.increment(Metric.MESSAGES_DELETED);
      this.#peers.broadcast(room.id, { type: ServerEvent.MESSAGE_DELETED, messageId });
    }
  }
}
