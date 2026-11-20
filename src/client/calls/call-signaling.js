import { ClientEvent } from '../../shared/events.js';

// Traduce las intenciones de la llamada a eventos del protocolo. Cada metodo devuelve
// false si no hubo conexion para enviarlo.
export class CallSignaling {
  #send;

  constructor(send) {
    this.#send = send;
  }


  invite(peerId) {
    return this.#send({ type: ClientEvent.CALL_INVITE, to: peerId });
  }

  accept(callId) {
    return this.#send({ type: ClientEvent.CALL_ACCEPT, callId });
  }

  reject(callId) {
    return this.#send({ type: ClientEvent.CALL_REJECT, callId });
  }

  hangUp(callId) {
    return this.#send({ type: ClientEvent.CALL_HANGUP, callId });
  }

  relay(callId, signal) {
    return this.#send({ type: ClientEvent.CALL_SIGNAL, callId, signal });
  }
}
