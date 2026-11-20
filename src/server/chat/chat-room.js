import { randomUUID } from 'node:crypto';
import { MAX_TEXT_LENGTH } from '../../shared/limits.js';
import { requireName, requireText } from '../validation.js';

export const MAX_HISTORY = 100;
const MESSAGE_FIELD = 'El mensaje';

// Con un adjunto, el texto es un pie de foto opcional; sin adjunto, es obligatorio.
export function readMessageText(text, hasAttachment) {
  const isBlank = text === undefined || text === null || (typeof text === 'string' && text.trim() === '');
  if (hasAttachment && isBlank) {
    return '';
  }
  return requireText(text, MAX_TEXT_LENGTH, MESSAGE_FIELD);
}

// Lo que ven todas las personas de la sala. Nunca incluye quien lo envio por dentro (sesion).
export function createMessage(input) {
  const attachment = input?.attachment ?? null;
  const message = {
    id: randomUUID(),
    name: requireName(input?.name),
    text: readMessageText(input?.text, attachment !== null),
    time: new Date().toISOString(),
  };
  return attachment ? { ...message, attachment } : message;
}

// Historial de una sala. Cada mensaje guarda en privado la sesion que lo envio (para saber
// quien puede borrarlo) y quienes lo reportaron (cada sesion cuenta una sola vez).
export class ChatRoom {
  #entries = [];
  #maxHistory;
  #onMessageRemoved;

  constructor({ maxHistory = MAX_HISTORY, onMessageRemoved = () => {} } = {}) {
    this.#maxHistory = maxHistory;
    this.#onMessageRemoved = onMessageRemoved;
  }

  post({ authorSessionId = null, ...input }) {
    const message = createMessage(input);
    this.#entries.push({ message, authorSessionId, reporters: new Set() });
    if (this.#entries.length > this.#maxHistory) {
      this.#onMessageRemoved(this.#entries.shift().message);
    }
    return message;
  }

  isAuthor(messageId, sessionId) {
    return this.#find(messageId)?.authorSessionId === sessionId;
  }

  has(messageId) {
    return this.#find(messageId) !== undefined;
  }

  // Devuelve cuantas sesiones distintas reportaron el mensaje, o 0 si no hay nada nuevo que
  // contar: el mensaje no existe o esa sesion ya lo habia reportado.
  report(messageId, reporterSessionId) {
    const entry = this.#find(messageId);
    if (!entry || entry.reporters.has(reporterSessionId)) {
      return 0;
    }
    entry.reporters.add(reporterSessionId);
    return entry.reporters.size;
  }

  remove(messageId) {
    const index = this.#entries.findIndex((entry) => entry.message.id === messageId);
    if (index === -1) {
      return null;
    }
    const [{ message }] = this.#entries.splice(index, 1);
    this.#onMessageRemoved(message);
    return message;
  }

  history() {
    return this.#entries.map((entry) => entry.message);
  }

  #find(messageId) {
    return this.#entries.find((entry) => entry.message.id === messageId);
  }
}
