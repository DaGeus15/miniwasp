import { randomUUID } from 'node:crypto';

// Las videollamadas son uno a uno: medios P2P entre dos navegadores, sin servidor de medios.
export const VIDEO_CALL_CAPACITY = 2;

export const VideoCallStatus = Object.freeze({
  WAITING: 'waiting',
  ACTIVE: 'active',
});

function timestamp(now) {
  return new Date(now()).toISOString();
}

// Estado de una videollamada: quienes estan dentro. No sabe nada de HTTP.
export class VideoCall {
  #participants = new Map();
  #now;

  constructor({ roomId, now = Date.now }) {
    this.id = randomUUID();
    this.roomId = roomId;
    this.#now = now;
    this.createdAt = timestamp(now);
  }

  get isFull() {
    return this.#participants.size >= VIDEO_CALL_CAPACITY;
  }

  get isEmpty() {
    return this.#participants.size === 0;
  }

  get participantIds() {
    return [...this.#participants.keys()];
  }

  has(sessionId) {
    return this.#participants.has(sessionId);
  }

  add(session) {
    this.#participants.set(session.id, {
      id: session.id,
      name: session.name,
      joinedAt: timestamp(this.#now),
    });
  }

  remove(sessionId) {
    this.#participants.delete(sessionId);
  }

  toPublic() {
    return {
      id: this.id,
      status: this.isFull ? VideoCallStatus.ACTIVE : VideoCallStatus.WAITING,
      capacity: VIDEO_CALL_CAPACITY,
      participants: [...this.#participants.values()],
      createdAt: this.createdAt,
    };
  }
}
