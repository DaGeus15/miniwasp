import { VideoCall } from './video-call.js';

// Motivos por los que no se puede hacer algo con una videollamada. La capa HTTP decide como
// se comunican; este registro solo aplica las reglas.
export const VideoCallRefusal = Object.freeze({
  NOT_FOUND: 'not-found',
  FULL: 'full',
  BUSY: 'busy',
  NOT_PARTICIPANT: 'not-participant',
});

// Videollamadas abiertas. Una persona esta como mucho en una a la vez, y una llamada vacia
// desaparece. Cada operacion devuelve { call } o { refusal }.
export class VideoCallRegistry {
  #callsById = new Map();
  #callBySession = new Map();
  #now;

  constructor({ now = Date.now } = {}) {
    this.#now = now;
  }

  start(session) {
    if (this.#callBySession.has(session.id)) {
      return { refusal: VideoCallRefusal.BUSY };
    }
    const call = new VideoCall({ roomId: session.roomId, now: this.#now });
    this.#callsById.set(call.id, call);
    this.#enter(call, session);
    return { call };
  }

  // Una sesion solo ve llamadas de su sala: una ajena responde igual que una inexistente.
  find(session, callId) {
    const call = this.#callsById.get(callId);
    return call?.roomId === session.roomId ? call : null;
  }

  // Volver a entrar a la llamada en la que ya se esta no es un error.
  join(session, callId) {
    const call = this.find(session, callId);
    if (!call) {
      return { refusal: VideoCallRefusal.NOT_FOUND };
    }
    if (call.has(session.id)) {
      return { call };
    }
    if (this.#callBySession.has(session.id)) {
      return { refusal: VideoCallRefusal.BUSY };
    }
    if (call.isFull) {
      return { refusal: VideoCallRefusal.FULL };
    }
    this.#enter(call, session);
    return { call };
  }

  leave(session, callId) {
    const call = this.find(session, callId);
    if (!call) {
      return { refusal: VideoCallRefusal.NOT_FOUND };
    }
    if (!call.has(session.id)) {
      return { refusal: VideoCallRefusal.NOT_PARTICIPANT };
    }
    this.#exit(call, session.id);
    return { call };
  }

  // Al cerrar sesion, la persona sale de la llamada en la que estuviera.
  leaveAll(sessionId) {
    const call = this.#callBySession.get(sessionId);
    if (call) {
      this.#exit(call, sessionId);
    }
  }

  callOf(sessionId) {
    return this.#callBySession.get(sessionId) ?? null;
  }

  closeRoom(roomId) {
    for (const call of [...this.#callsById.values()]) {
      if (call.roomId === roomId) {
        call.participantIds.forEach((sessionId) => this.#exit(call, sessionId));
      }
    }
  }

  #enter(call, session) {
    call.add(session);
    this.#callBySession.set(session.id, call);
  }

  #exit(call, sessionId) {
    call.remove(sessionId);
    this.#callBySession.delete(sessionId);
    if (call.isEmpty) {
      this.#callsById.delete(call.id);
    }
  }
}
