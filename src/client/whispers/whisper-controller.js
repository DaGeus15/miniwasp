import { validateName } from '../../shared/draft.js';
import { ClientEvent, WhisperEndReason } from '../../shared/events.js';

const PUBLIC = 'public';
const ACCEPTS_WHISPERS = 'si';
const REJECTS_WHISPERS = 'no';
const END_NOTICES = new Map([
  [WhisperEndReason.REJECTED, 'whisperRejected'],
  [WhisperEndReason.TIMEOUT, 'whisperTimeout'],
  [WhisperEndReason.UNAVAILABLE, 'whisperUnavailable'],
]);

// Susurros desde el navegador: invitar a alguien de la sala publica, responder una
// invitacion y, al aceptarse, mudarse con esa persona a una sala privada de dos.
export class WhisperController {
  #send;
  #view;
  #notices;
  #getName;
  #preference;
  #transfer;
  #pendingWhisperId = null;

  constructor({ send, view, notices, getName, preference, transfer }) {
    this.#send = send;
    this.#view = view;
    this.#notices = notices;
    this.#getName = getName;
    this.#preference = preference;
    this.#transfer = transfer;
  }

  get acceptsWhispers() {
    return this.#preference.load() !== REJECTS_WHISPERS;
  }

  // La preferencia se recuerda en el navegador y se vuelve a enviar en cada conexion.
  handleWelcome({ visibility }) {
    const isAvailable = visibility === PUBLIC;
    this.#view.showPreference({ isAvailable, acceptsWhispers: this.acceptsWhispers });
    if (isAvailable) {
      this.#send({ type: ClientEvent.WHISPER_PREFERENCE, acceptsWhispers: this.acceptsWhispers });
    }
  }

  setAcceptsWhispers(acceptsWhispers) {
    this.#preference.save(acceptsWhispers ? ACCEPTS_WHISPERS : REJECTS_WHISPERS);
    this.#send({ type: ClientEvent.WHISPER_PREFERENCE, acceptsWhispers });
  }

  invite(peer) {
    const { name, errorKey } = validateName(this.#getName());
    if (errorKey) {
      this.#notices.show(errorKey);
      return;
    }
    this.#send({ type: ClientEvent.PRESENCE, name });
    this.#send({ type: ClientEvent.WHISPER_INVITE, to: peer.id });
    this.#notices.show('whisperSent');
  }

  handleIncoming({ whisperId, from }) {
    this.#pendingWhisperId = whisperId;
    this.#view.showIncoming(from.name);
  }

  accept() {
    this.#respond(ClientEvent.WHISPER_ACCEPT);
  }

  reject() {
    this.#respond(ClientEvent.WHISPER_REJECT);
  }

  async handleReady({ transferToken }) {
    this.#closeIncoming();
    if (!(await this.#transfer(transferToken))) {
      this.#notices.show('whisperUnavailable');
    }
  }

  handleEnded({ whisperId, reason }) {
    if (whisperId === this.#pendingWhisperId) {
      this.#closeIncoming();
    }
    this.#notices.show(END_NOTICES.get(reason));
  }

  #respond(type) {
    if (this.#pendingWhisperId) {
      this.#send({ type, whisperId: this.#pendingWhisperId });
    }
    this.#closeIncoming();
  }

  #closeIncoming() {
    this.#pendingWhisperId = null;
    this.#view.hideIncoming();
  }
}
