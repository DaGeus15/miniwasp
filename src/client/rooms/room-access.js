import { parseInviteInput } from './invite-link.js';
import { RoomResult } from './room-client.js';

const ERROR_TEXT_KEYS = new Map([
  [RoomResult.NOT_FOUND, 'roomNotFound'],
  [RoomResult.INVALID, 'roomTitleInvalid'],
  [RoomResult.BLOCKED, 'roomTitleBlocked'],
  [RoomResult.BANNED, 'bannedFromRoom'],
  [RoomResult.THROTTLED, 'tooManyAttempts'],
  [RoomResult.FULL, 'roomsFull'],
  [RoomResult.UNREACHABLE, 'serverUnreachable'],
]);

// Decide si se muestra el inicio o la sala, y avisa cuando se entra o se sale de ella.
export class RoomAccess {
  #client;
  #view;
  #textFor;
  #onEnter;
  #onExit;
  #takeInviteFromLink;
  #onRoomChange;

  constructor({ client, view, textFor, onEnter, onExit, onRoomChange, takeInviteFromLink }) {
    this.#onRoomChange = onRoomChange;
    this.#client = client;
    this.#view = view;
    this.#textFor = textFor;
    this.#onEnter = onEnter;
    this.#onExit = onExit;
    this.#takeInviteFromLink = takeInviteFromLink;
  }

  // Un enlace de invitacion tiene prioridad: quien lo abre quiere entrar a esa sala. Si aun no
  // acepto las normas, la invitacion queda lista en el inicio para entrar al aceptarlas.
  async start() {
    const inviteToken = this.#takeInviteFromLink();
    if (inviteToken && this.#view.hasAcceptedRules()) {
      await this.#enterWith(this.#client.joinRoom(inviteToken));
      return;
    }
    if (inviteToken) {
      this.#view.showHome();
      this.#view.prefillInvite(inviteToken);
      this.#view.showError(this.#textFor('rulesRequired'));
      return;
    }
    const status = await this.#client.status();
    if (status === RoomResult.ACTIVE) {
      this.#enter();
      return;
    }
    this.#view.showHome();
    if (status === RoomResult.UNREACHABLE) {
      this.#view.showError(this.#textFor('serverUnreachable'));
    }
  }

  create() {
    if (!this.#requireAcceptedRules()) {
      return Promise.resolve();
    }
    return this.#enterWith(this.#client.createRoom());
  }

  createPublic(title) {
    if (!this.#requireAcceptedRules()) {
      return Promise.resolve();
    }
    return this.#enterWith(this.#client.createPublicRoom(title.trim()));
  }

  joinPublic(listingId) {
    if (!this.#requireAcceptedRules()) {
      return Promise.resolve();
    }
    return this.#enterWith(this.#client.joinPublicRoom(listingId));
  }

  // Un susurro aceptado muda la sesion: se cierra la conexion de la sala publica y se abre
  // la de la sala privada. Devuelve si se pudo mudar.
  async transfer(transferToken) {
    if ((await this.#client.transfer(transferToken)) !== RoomResult.GRANTED) {
      return false;
    }
    this.#onRoomChange();
    this.#view.showChat();
    return true;
  }

  join(input) {
    if (!this.#requireAcceptedRules()) {
      return Promise.resolve();
    }
    const inviteToken = parseInviteInput(input);
    if (!inviteToken) {
      this.#view.showError(this.#textFor('invalidInvite'));
      return Promise.resolve();
    }
    return this.#enterWith(this.#client.joinRoom(inviteToken));
  }

  // Una conexion caida puede deberse a una sala cerrada, una expulsion o un corte de red.
  // Solo lo primero obliga a volver al inicio; un corte se resuelve reconectando.
  async verifySession() {
    if ((await this.#client.status()) === RoomResult.EXPIRED) {
      this.#exit();
      this.#view.showError(this.#textFor('sessionExpired'));
    }
  }

  async leave() {
    await this.#client.leave();
    this.#exit();
  }

  #requireAcceptedRules() {
    if (this.#view.hasAcceptedRules()) {
      return true;
    }
    this.#view.showError(this.#textFor('rulesRequired'));
    return false;
  }

  async #enterWith(pendingResult) {
    const result = await pendingResult;
    if (result === RoomResult.GRANTED) {
      this.#enter();
      return;
    }
    this.#view.showHome();
    this.#view.showError(this.#textFor(ERROR_TEXT_KEYS.get(result)));
  }

  #enter() {
    this.#view.showChat();
    this.#onEnter();
  }

  #exit() {
    this.#onExit();
    this.#view.showHome();
  }
}
