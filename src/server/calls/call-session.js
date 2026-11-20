import { randomUUID } from 'node:crypto';
import { SignalKind } from '../../shared/events.js';

// Estado de una llamada entre dos personas. No sabe nada de sockets ni de mensajes.
// La negociacion sigue un orden fijo: una oferta de quien llama, una respuesta de quien
// recibe, y candidatos de cada lado solo despues de su propia descripcion. Asi se
// descartan mensajes repetidos o fuera de secuencia.
export class CallSession {
  #isRinging = true;
  #cancelRingTimeout = null;
  #relayedKinds = new Set();
  #signalRules;

  constructor(caller, callee) {
    this.id = randomUUID();
    this.caller = caller;
    this.callee = callee;
    this.#signalRules = new Map([
      [SignalKind.OFFER, (peer) => peer === caller && !this.#hasRelayed(SignalKind.OFFER)],
      [
        SignalKind.ANSWER,
        (peer) =>
          peer === callee &&
          this.#hasRelayed(SignalKind.OFFER) &&
          !this.#hasRelayed(SignalKind.ANSWER),
      ],
      [SignalKind.CANDIDATE, (peer) => this.#hasRelayed(this.#descriptionKindOf(peer))],
    ]);
  }

  get participants() {
    return [this.caller, this.callee];
  }

  includes(peer) {
    return this.participants.includes(peer);
  }

  awaitsAnswerFrom(peer) {
    return this.#isRinging && peer === this.callee;
  }

  counterpartOf(peer) {
    return peer === this.caller ? this.callee : this.caller;
  }

  // Las direcciones de red solo circulan cuando la otra persona ya acepto.
  canSignal(peer, kind) {
    return !this.#isRinging && this.includes(peer) && this.#signalRules.get(kind)(peer);
  }

  recordSignal(kind) {
    this.#relayedKinds.add(kind);
  }

  startRinging(schedule, delayMs, onTimeout) {
    this.#cancelRingTimeout = schedule(onTimeout, delayMs);
  }

  answer() {
    this.#isRinging = false;
    this.stopRinging();
  }

  stopRinging() {
    this.#cancelRingTimeout?.();
  }

  #hasRelayed(kind) {
    return this.#relayedKinds.has(kind);
  }

  #descriptionKindOf(peer) {
    return peer === this.caller ? SignalKind.OFFER : SignalKind.ANSWER;
  }
}
