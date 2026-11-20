import { ClientEvent } from '../../shared/events.js';

// Mensajes sobre la sala y la propia presencia. Cada metodo devuelve false si no hubo
// conexion para enviarlo.
export class RoomSignaling {
  #send;

  constructor(send) {
    this.#send = send;
  }

  announce(name) {
    return this.#send({ type: ClientEvent.PRESENCE, name });
  }

  expel(peerId) {
    return this.#send({ type: ClientEvent.ROOM_EXPEL, peerId });
  }

  rotateInvite() {
    return this.#send({ type: ClientEvent.ROOM_ROTATE_INVITE });
  }
}
