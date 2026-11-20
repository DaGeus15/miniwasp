import { validateName } from '../../shared/draft.js';

// Mantiene la lista de personas de la sala y anuncia el nombre propio al servidor.
export class PresenceController {
  #signaling;
  #view;
  #notices;
  #getName;
  #onCallApproved;
  #ownPeerId = null;
  #isOwner = false;
  #canWhisper = false;

  constructor({ signaling, view, notices, getName, onCallApproved }) {
    this.#signaling = signaling;
    this.#view = view;
    this.#notices = notices;
    this.#getName = getName;
    this.#onCallApproved = onCallApproved;
  }

  // El servidor asigna otro id en cada conexion, asi que tras reconectar hay que anunciarse de nuevo.
  handleWelcome({ peerId, peers, isOwner, visibility }) {
    this.#ownPeerId = peerId;
    this.#isOwner = isOwner;
    this.#canWhisper = visibility === 'public';
    this.announceName();
    this.handlePresence({ peers });
  }

  handlePresence({ peers }) {
    const others = peers.filter((peer) => peer.id !== this.#ownPeerId);
    this.#view.render(others, { canExpel: this.#isOwner, canWhisper: this.#canWhisper });
  }

  handleConnectionLost() {
    this.#view.render([], { canExpel: false, canWhisper: false });
  }

  announceName() {
    const { name } = validateName(this.#getName());
    if (name) {
      this.#signaling.announce(name);
    }
  }

  requestCall(peer) {
    const { name, errorKey } = validateName(this.#getName());
    if (errorKey) {
      this.#notices.show(errorKey);
      return;
    }
    this.#signaling.announce(name);
    this.#onCallApproved(peer);
  }

  // El servidor vuelve a comprobar que quien lo pide creo la sala: esto solo evita
  // ofrecer una accion que no tendria efecto.
  requestExpel(peer) {
    if (this.#isOwner) {
      this.#signaling.expel(peer.id);
    }
  }
}
