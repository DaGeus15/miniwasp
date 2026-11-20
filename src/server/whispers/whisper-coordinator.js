import { randomUUID } from 'node:crypto';
import { ServerEvent, WhisperEndReason } from '../../shared/events.js';
import { RoomVisibility } from '../rooms/room.js';
import { scheduleOnce } from '../scheduling.js';
import { ValidationError } from '../validation.js';

export const DEFAULT_WHISPER_TIMEOUT_MS = 30000;
const PUBLIC_ONLY_ERROR = 'Los susurros solo existen en las salas públicas';
const NAME_REQUIRED_ERROR = 'Escribe tu nombre antes de susurrar';

// Susurros: dos personas que coinciden en una sala publica pasan juntas a una sala privada
// solo para ellas. Quien recibe la invitacion decide; si no acepta susurros, esta ocupada o
// se fue, quien invito solo ve "no disponible". Ningun mensaje de un susurro ajeno o ya
// terminado tiene efecto ni recibe respuesta: responder revelaria si un id existe.
export class WhisperCoordinator {
  #directory;
  #rooms;
  #transferTokens;
  #schedule;
  #timeoutMs;
  #logger;
  #pendingById = new Map();
  #optedOutSessions = new Set();

  constructor({ directory, rooms, transferTokens, logger, schedule = scheduleOnce, timeoutMs = DEFAULT_WHISPER_TIMEOUT_MS }) {
    this.#directory = directory;
    this.#rooms = rooms;
    this.#transferTokens = transferTokens;
    this.#logger = logger;
    this.#schedule = schedule;
    this.#timeoutMs = timeoutMs;
  }

  invite(inviter, inviteeId) {
    this.#assertCanWhisper(inviter);
    const invitee = this.#directory.find(inviteeId);
    if (!this.#isAvailable(inviter, invitee)) {
      inviter.send({ type: ServerEvent.WHISPER_ENDED, whisperId: null, reason: WhisperEndReason.UNAVAILABLE });
      return;
    }
    const whisperId = randomUUID();
    const cancelTimeout = this.#schedule(() => this.#end(whisperId, WhisperEndReason.TIMEOUT), this.#timeoutMs);
    this.#pendingById.set(whisperId, { inviter, invitee, cancelTimeout });
    invitee.send({ type: ServerEvent.WHISPER_INCOMING, whisperId, from: inviter.toPublicProfile() });
  }

  // Al aceptar se crea la sala de dos y cada persona recibe su pase de un solo uso.
  accept(peer, whisperId) {
    const pending = this.#pendingFor(peer, whisperId);
    if (!pending) {
      return;
    }
    this.#forget(whisperId);
    const room = this.#rooms.create({ visibility: RoomVisibility.WHISPER });
    const tokens = room && [pending.inviter, pending.invitee].map((person) => this.#transferTokens.issue(person.sessionId, { roomId: room.id }));
    if (!tokens || tokens.includes(null)) {
      this.#notifyBoth(pending, { type: ServerEvent.WHISPER_ENDED, whisperId, reason: WhisperEndReason.UNAVAILABLE });
      return;
    }
    pending.inviter.send({ type: ServerEvent.WHISPER_READY, whisperId, transferToken: tokens[0] });
    pending.invitee.send({ type: ServerEvent.WHISPER_READY, whisperId, transferToken: tokens[1] });
    this.#logger.info('whisper.started', { roomId: room.id });
  }

  reject(peer, whisperId) {
    if (this.#pendingFor(peer, whisperId)) {
      this.#end(whisperId, WhisperEndReason.REJECTED);
    }
  }

  setAcceptsWhispers(peer, acceptsWhispers) {
    if (acceptsWhispers === false) {
      this.#optedOutSessions.add(peer.sessionId);
    } else {
      this.#optedOutSessions.delete(peer.sessionId);
    }
  }

  handleDeparture(peer) {
    for (const [whisperId, pending] of this.#pendingById) {
      if (pending.inviter === peer || pending.invitee === peer) {
        this.#end(whisperId, WhisperEndReason.UNAVAILABLE);
      }
    }
  }

  forgetSession(sessionId) {
    this.#optedOutSessions.delete(sessionId);
  }

  #assertCanWhisper(inviter) {
    if (this.#rooms.find(inviter.roomId)?.visibility !== RoomVisibility.PUBLIC) {
      throw new ValidationError(PUBLIC_ONLY_ERROR);
    }
    if (!inviter.isPresent) {
      throw new ValidationError(NAME_REQUIRED_ERROR);
    }
  }

  #isAvailable(inviter, invitee) {
    return (
      Boolean(invitee) &&
      invitee !== inviter &&
      invitee.sessionId !== inviter.sessionId &&
      inviter.sharesRoomWith(invitee) &&
      invitee.isPresent &&
      !this.#optedOutSessions.has(invitee.sessionId) &&
      !this.#isInvolved(inviter) &&
      !this.#isInvolved(invitee)
    );
  }

  #isInvolved(peer) {
    return [...this.#pendingById.values()].some((pending) => pending.inviter === peer || pending.invitee === peer);
  }

  #pendingFor(peer, whisperId) {
    const pending = this.#pendingById.get(whisperId);
    return pending?.invitee === peer ? pending : null;
  }

  #end(whisperId, reason) {
    const pending = this.#pendingById.get(whisperId);
    if (pending) {
      this.#forget(whisperId);
      this.#notifyBoth(pending, { type: ServerEvent.WHISPER_ENDED, whisperId, reason });
    }
  }

  #forget(whisperId) {
    this.#pendingById.get(whisperId).cancelTimeout();
    this.#pendingById.delete(whisperId);
  }

  #notifyBoth({ inviter, invitee }, event) {
    inviter.send(event);
    invitee.send(event);
  }
}
