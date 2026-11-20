import { CallEndReason, ServerEvent } from '../../shared/events.js';
import { sanitizeSignal } from '../../shared/signal.js';
import { Metric } from '../observability/metrics.js';
import { scheduleOnce } from '../scheduling.js';
import { ValidationError } from '../validation.js';
import { CallSession } from './call-session.js';

export const DEFAULT_RING_TIMEOUT_MS = 30000;

const NAME_REQUIRED_ERROR = 'Escribe tu nombre antes de llamar';
const INVALID_SIGNAL_ERROR = 'La señal de la llamada no es válida';

// Decide que puede ocurrir en cada llamada y a quien se le avisa.
// Ignora en silencio los mensajes de llamadas ajenas o ya terminadas: pueden ser
// carreras normales (una senal en vuelo al colgar) y responder revelaria si un id existe.
export class CallCoordinator {
  #directory;
  #schedule;
  #ringTimeoutMs;
  #logger;
  #metrics;
  #sessionsById = new Map();
  #sessionsByPeer = new Map();

  constructor({
    directory,
    logger,
    metrics,
    schedule = scheduleOnce,
    ringTimeoutMs = DEFAULT_RING_TIMEOUT_MS,
  }) {
    this.#directory = directory;
    this.#logger = logger;
    this.#metrics = metrics;
    this.#schedule = schedule;
    this.#ringTimeoutMs = ringTimeoutMs;
  }

  invite(caller, calleeId) {
    if (!caller.isPresent) {
      throw new ValidationError(NAME_REQUIRED_ERROR);
    }

    const callee = this.#directory.find(calleeId);
    const refusalReason = this.#refusalReason(caller, callee);
    if (refusalReason) {
      caller.send({ type: ServerEvent.CALL_ENDED, callId: null, reason: refusalReason });
      return;
    }

    const session = this.#open(caller, callee);
    caller.send({
      type: ServerEvent.CALL_RINGING,
      callId: session.id,
      peer: callee.toPublicProfile(),
    });
    callee.send({
      type: ServerEvent.CALL_INCOMING,
      callId: session.id,
      peer: caller.toPublicProfile(),
    });
  }

  accept(peer, callId) {
    const session = this.#sessionsById.get(callId);
    if (session?.awaitsAnswerFrom(peer)) {
      session.answer();
      session.caller.send({ type: ServerEvent.CALL_ACCEPTED, callId });
      this.#logger.info('call.accepted', { callId });
    }
  }

  reject(peer, callId) {
    const session = this.#sessionsById.get(callId);
    if (session?.awaitsAnswerFrom(peer)) {
      this.#end(session, CallEndReason.REJECTED);
    }
  }

  hangUp(peer, callId) {
    const session = this.#sessionsById.get(callId);
    if (session?.includes(peer)) {
      this.#end(session, CallEndReason.HANGUP);
    }
  }

  relaySignal(sender, callId, rawSignal) {
    const signal = sanitizeSignal(rawSignal);
    if (signal === null) {
      throw new ValidationError(INVALID_SIGNAL_ERROR);
    }

    const session = this.#sessionsById.get(callId);
    if (session?.canSignal(sender, signal.kind)) {
      session.recordSignal(signal.kind);
      session.counterpartOf(sender).send({ type: ServerEvent.CALL_SIGNAL, callId, signal });
    }
  }

  handleDeparture(peer) {
    const session = this.#sessionsByPeer.get(peer);
    if (session) {
      this.#end(session, CallEndReason.DISCONNECTED);
    }
  }

  #refusalReason(caller, callee) {
    if (!callee?.isPresent || callee === caller || !caller.sharesRoomWith(callee)) {
      return CallEndReason.UNAVAILABLE;
    }
    const isSomeoneBusy = this.#sessionsByPeer.has(caller) || this.#sessionsByPeer.has(callee);
    return isSomeoneBusy ? CallEndReason.BUSY : null;
  }

  #open(caller, callee) {
    const session = new CallSession(caller, callee);
    this.#sessionsById.set(session.id, session);
    for (const participant of session.participants) {
      this.#sessionsByPeer.set(participant, session);
    }
    session.startRinging(this.#schedule, this.#ringTimeoutMs, () => {
      this.#end(session, CallEndReason.TIMEOUT);
    });
    this.#metrics.increment(Metric.CALLS_STARTED);
    this.#metrics.increment(Metric.CALLS_ACTIVE);
    this.#logger.info('call.started', { callId: session.id });
    return session;
  }

  #end(session, reason) {
    session.stopRinging();
    this.#sessionsById.delete(session.id);
    for (const participant of session.participants) {
      this.#sessionsByPeer.delete(participant);
      participant.send({ type: ServerEvent.CALL_ENDED, callId: session.id, reason });
    }
    this.#metrics.decrement(Metric.CALLS_ACTIVE);
    this.#metrics.increment(Metric.CALLS_ENDED);
    this.#logger.info('call.ended', { callId: session.id, reason });
  }
}
