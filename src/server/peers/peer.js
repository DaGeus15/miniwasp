import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { ServerEvent } from '../../shared/events.js';

function toNameKey(name) {
  return name.toLowerCase();
}

// Una conexion WebSocket dentro de una sala. El id es aleatorio para que no se pueda
// adivinar a quien llamar; la sala y el rol vienen de la sesion, nunca del cliente.
export class Peer {
  #socket;
  #name = null;

  constructor({ socket, address, session }) {
    this.id = randomUUID();
    this.address = address;
    this.sessionId = session.id;
    this.roomId = session.roomId;
    this.isOwner = session.isOwner;
    this.#socket = socket;
  }

  get name() {
    return this.#name;
  }

  get isPresent() {
    return this.#name !== null;
  }

  isNamed(name) {
    return this.isPresent && toNameKey(this.#name) === toNameKey(name);
  }

  sharesRoomWith(other) {
    return other?.roomId === this.roomId;
  }

  rename(name) {
    const hasChanged = this.#name !== name;
    this.#name = name;
    return hasChanged;
  }

  toPublicProfile() {
    return { id: this.id, name: this.#name, isOwner: this.isOwner };
  }

  send(event) {
    this.deliver(JSON.stringify(event));
  }

  sendError(error) {
    this.send({ type: ServerEvent.ERROR, error });
  }

  deliver(encodedEvent) {
    if (this.#socket.readyState === WebSocket.OPEN) {
      this.#socket.send(encodedEvent);
    }
  }

  close(code) {
    this.#socket.close(code);
  }
}
