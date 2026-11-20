import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import {
  CallCoordinator,
  DEFAULT_RING_TIMEOUT_MS,
} from '../../src/server/calls/call-coordinator.js';
import { Metric, Metrics } from '../../src/server/observability/metrics.js';
import { ValidationError } from '../../src/server/validation.js';
import { createRecordingLogger } from '../support/recording-logger.js';
import { createSilentLogger } from '../support/test-server.js';
import { CallEndReason, ServerEvent, SignalKind } from '../../src/shared/events.js';

const offer = { kind: SignalKind.OFFER, sdp: 'v=0' };
const answer = { kind: SignalKind.ANSWER, sdp: 'v=0' };
const candidate = { kind: SignalKind.CANDIDATE, candidate: { candidate: 'candidate:1' } };

class FakePeer {
  events = [];
  isPresent = true;
  roomId = 'sala';

  sharesRoomWith(other) {
    return other?.roomId === this.roomId;
  }

  constructor(id) {
    this.id = id;
  }

  toPublicProfile() {
    return { id: this.id, name: this.id };
  }

  send(event) {
    this.events.push(event);
  }

  get lastEvent() {
    return this.events.at(-1);
  }
}

function setup({ logger = createSilentLogger(), metrics = new Metrics() } = {}) {
  const caller = new FakePeer('ana');
  const callee = new FakePeer('luis');
  const outsider = new FakePeer('rosa');
  const directory = new Map([caller, callee, outsider].map((peer) => [peer.id, peer]));
  const rings = [];

  const coordinator = new CallCoordinator({
    directory: { find: (id) => directory.get(id) },
    logger,
    metrics,
    schedule(onTimeout, delayMs) {
      const ring = { onTimeout, delayMs, isCancelled: false };
      rings.push(ring);
      return () => {
        ring.isCancelled = true;
      };
    },
  });

  return { coordinator, caller, callee, outsider, rings, metrics };
}

function startCall(context) {
  context.coordinator.invite(context.caller, context.callee.id);
  return context.caller.lastEvent.callId;
}

function establishCall(context) {
  const callId = startCall(context);
  context.coordinator.accept(context.callee, callId);
  return callId;
}

function negotiate(context, callId) {
  context.coordinator.relaySignal(context.caller, callId, offer);
  context.coordinator.relaySignal(context.callee, callId, answer);
}

describe('CallCoordinator: invitacion', () => {
  it('avisa a ambas personas con un id comun', () => {
    const context = setup();

    const callId = startCall(context);

    assert.equal(context.caller.lastEvent.type, ServerEvent.CALL_RINGING);
    assert.deepEqual(context.caller.lastEvent.peer, { id: 'luis', name: 'luis' });
    assert.equal(context.callee.lastEvent.type, ServerEvent.CALL_INCOMING);
    assert.deepEqual(context.callee.lastEvent.peer, { id: 'ana', name: 'ana' });
    assert.equal(context.callee.lastEvent.callId, callId);
  });

  it('exige un nombre para llamar', () => {
    const { coordinator, caller, callee } = setup();
    caller.isPresent = false;

    assert.throws(() => coordinator.invite(caller, callee.id), ValidationError);
    assert.equal(callee.events.length, 0);
  });

  it('informa si la persona no esta disponible', () => {
    const { coordinator, caller, callee } = setup();
    const unavailable = {
      type: ServerEvent.CALL_ENDED,
      callId: null,
      reason: CallEndReason.UNAVAILABLE,
    };

    coordinator.invite(caller, 'desconocido');
    assert.deepEqual(caller.lastEvent, unavailable);

    callee.isPresent = false;
    coordinator.invite(caller, callee.id);
    assert.deepEqual(caller.lastEvent, unavailable);
  });

  it('no permite llamarse a si mismo', () => {
    const { coordinator, caller } = setup();

    coordinator.invite(caller, caller.id);

    assert.equal(caller.lastEvent.reason, CallEndReason.UNAVAILABLE);
  });

  it('informa si alguna persona ya esta en una llamada', () => {
    const context = setup();
    startCall(context);
    const { coordinator, callee, outsider, caller } = context;

    coordinator.invite(outsider, callee.id);
    assert.equal(outsider.lastEvent.reason, CallEndReason.BUSY);

    coordinator.invite(caller, outsider.id);
    assert.equal(caller.lastEvent.reason, CallEndReason.BUSY);
    assert.equal(outsider.events.length, 1);
  });

  it('usa el tiempo de espera por defecto', () => {
    const context = setup();

    startCall(context);

    assert.equal(context.rings[0].delayMs, DEFAULT_RING_TIMEOUT_MS);
  });

  it('corta la llamada si nadie contesta y libera a ambos', () => {
    const context = setup();
    const callId = startCall(context);

    context.rings[0].onTimeout();

    assert.deepEqual(context.caller.lastEvent, {
      type: ServerEvent.CALL_ENDED,
      callId,
      reason: CallEndReason.TIMEOUT,
    });
    assert.equal(context.callee.lastEvent.reason, CallEndReason.TIMEOUT);

    startCall(context);
    assert.equal(context.caller.lastEvent.type, ServerEvent.CALL_RINGING);
  });
});

describe('CallCoordinator: respuesta', () => {
  it('avisa a quien llamo y detiene la espera', () => {
    const context = setup();
    const callId = startCall(context);

    context.coordinator.accept(context.callee, callId);

    assert.deepEqual(context.caller.lastEvent, { type: ServerEvent.CALL_ACCEPTED, callId });
    assert.equal(context.rings[0].isCancelled, true);
  });

  it('solo acepta quien recibe la llamada', () => {
    const context = setup();
    const callId = startCall(context);
    const eventsBefore = context.caller.events.length;

    context.coordinator.accept(context.caller, callId);
    context.coordinator.accept(context.outsider, callId);

    assert.equal(context.caller.events.length, eventsBefore);
  });

  it('una llamada no se puede aceptar dos veces', () => {
    const context = setup();
    const callId = establishCall(context);
    const eventsBefore = context.caller.events.length;

    context.coordinator.accept(context.callee, callId);

    assert.equal(context.caller.events.length, eventsBefore);
  });

  it('rechazar termina la llamada para ambos', () => {
    const context = setup();
    const callId = startCall(context);

    context.coordinator.reject(context.callee, callId);

    assert.equal(context.caller.lastEvent.reason, CallEndReason.REJECTED);
    assert.equal(context.rings[0].isCancelled, true);
  });

  it('una llamada en curso no se puede rechazar', () => {
    const context = setup();
    const callId = establishCall(context);

    context.coordinator.reject(context.callee, callId);

    assert.equal(context.caller.lastEvent.type, ServerEvent.CALL_ACCEPTED);
  });
});

describe('CallCoordinator: senales', () => {
  it('reenvia cada senal solo a la otra persona', () => {
    const context = setup();
    const callId = establishCall(context);

    context.coordinator.relaySignal(context.caller, callId, offer);
    assert.deepEqual(context.callee.lastEvent, {
      type: ServerEvent.CALL_SIGNAL,
      callId,
      signal: offer,
    });

    context.coordinator.relaySignal(context.callee, callId, answer);
    assert.deepEqual(context.caller.lastEvent, {
      type: ServerEvent.CALL_SIGNAL,
      callId,
      signal: answer,
    });

    assert.equal(context.outsider.events.length, 0);
  });

  it('los candidatos viajan en ambas direcciones', () => {
    const context = setup();
    const callId = establishCall(context);
    negotiate(context, callId);

    context.coordinator.relaySignal(context.caller, callId, candidate);
    context.coordinator.relaySignal(context.callee, callId, candidate);

    assert.equal(context.callee.lastEvent.signal.kind, SignalKind.CANDIDATE);
    assert.equal(context.caller.lastEvent.signal.kind, SignalKind.CANDIDATE);
  });

  it('ignora senales antes de aceptar', () => {
    const context = setup();
    const callId = startCall(context);
    const eventsBefore = context.callee.events.length;

    context.coordinator.relaySignal(context.caller, callId, offer);

    assert.equal(context.callee.events.length, eventsBefore);
  });

  it('solo quien llama puede ofertar y solo quien contesta puede responder', () => {
    const context = setup();
    const callId = establishCall(context);
    const callerEvents = context.caller.events.length;
    const calleeEvents = context.callee.events.length;

    context.coordinator.relaySignal(context.callee, callId, offer);
    context.coordinator.relaySignal(context.caller, callId, answer);

    assert.equal(context.caller.events.length, callerEvents);
    assert.equal(context.callee.events.length, calleeEvents);
  });

  it('ignora a quien no participa en la llamada', () => {
    const context = setup();
    const callId = establishCall(context);
    negotiate(context, callId);
    const eventsBefore = context.callee.events.length;

    context.coordinator.relaySignal(context.outsider, callId, candidate);

    assert.equal(context.callee.events.length, eventsBefore);
  });

  it('ignora senales de llamadas que ya terminaron', () => {
    const context = setup();
    const callId = establishCall(context);
    context.coordinator.hangUp(context.caller, callId);
    const eventsBefore = context.callee.events.length;

    context.coordinator.relaySignal(context.caller, callId, candidate);

    assert.equal(context.callee.events.length, eventsBefore);
  });

  it('rechaza senales mal formadas', () => {
    const context = setup();
    const callId = establishCall(context);

    assert.throws(
      () => context.coordinator.relaySignal(context.caller, callId, { kind: 'virus' }),
      ValidationError,
    );
  });

  it('solo reenvia los campos conocidos', () => {
    const context = setup();
    const callId = establishCall(context);

    context.coordinator.relaySignal(context.caller, callId, { ...offer, extra: 'x' });

    assert.deepEqual(context.callee.lastEvent.signal, offer);
  });
});

describe('CallCoordinator: fin de la llamada', () => {
  it('cualquiera de los participantes puede colgar', () => {
    for (const hangingUp of ['caller', 'callee']) {
      const context = setup();
      const callId = establishCall(context);

      context.coordinator.hangUp(context[hangingUp], callId);

      assert.deepEqual(context.caller.lastEvent, {
        type: ServerEvent.CALL_ENDED,
        callId,
        reason: CallEndReason.HANGUP,
      });
      assert.equal(context.callee.lastEvent.reason, CallEndReason.HANGUP);
    }
  });

  it('quien llama puede cancelar mientras suena', () => {
    const context = setup();
    const callId = startCall(context);

    context.coordinator.hangUp(context.caller, callId);

    assert.equal(context.callee.lastEvent.reason, CallEndReason.HANGUP);
    assert.equal(context.rings[0].isCancelled, true);
  });

  it('nadie mas puede colgar una llamada ajena', () => {
    const context = setup();
    const callId = establishCall(context);

    context.coordinator.hangUp(context.outsider, callId);

    assert.equal(context.caller.lastEvent.type, ServerEvent.CALL_ACCEPTED);
  });

  it('ignora colgar una llamada inexistente', () => {
    const { coordinator, caller } = setup();

    assert.doesNotThrow(() => coordinator.hangUp(caller, 'no-existe'));
    assert.equal(caller.events.length, 0);
  });

  it('avisa a la otra persona si alguien se desconecta', () => {
    const context = setup();
    establishCall(context);

    context.coordinator.handleDeparture(context.callee);

    assert.equal(context.caller.lastEvent.reason, CallEndReason.DISCONNECTED);
  });

  it('desconectarse sin llamada no hace nada', () => {
    const { coordinator, outsider } = setup();

    assert.doesNotThrow(() => coordinator.handleDeparture(outsider));
    assert.equal(outsider.events.length, 0);
  });

  it('los participantes quedan libres para otra llamada', () => {
    const context = setup();
    const callId = establishCall(context);
    context.coordinator.hangUp(context.caller, callId);

    context.coordinator.invite(context.outsider, context.callee.id);

    assert.equal(context.outsider.lastEvent.type, ServerEvent.CALL_RINGING);
  });
});

describe('CallCoordinator: temporizador real', () => {
  it('programa y cancela sin bloquear el proceso', () => {
    const caller = new FakePeer('ana');
    const callee = new FakePeer('luis');
    const coordinator = new CallCoordinator({
      directory: { find: () => callee },
      logger: createSilentLogger(),
      metrics: new Metrics(),
    });

    coordinator.invite(caller, callee.id);

    assert.doesNotThrow(() => coordinator.hangUp(caller, caller.lastEvent.callId));
  });
});

describe('CallCoordinator: orden de la negociacion', () => {
  function signalCount(peer) {
    return peer.events.filter((event) => event.type === ServerEvent.CALL_SIGNAL).length;
  }

  it('reenvia una sola oferta y una sola respuesta', () => {
    const context = setup();
    const callId = establishCall(context);

    negotiate(context, callId);
    negotiate(context, callId);

    assert.equal(signalCount(context.callee), 1);
    assert.equal(signalCount(context.caller), 1);
  });

  it('descarta una respuesta que llega antes de la oferta', () => {
    const context = setup();
    const callId = establishCall(context);

    context.coordinator.relaySignal(context.callee, callId, answer);

    assert.equal(signalCount(context.caller), 0);
  });

  it('descarta candidatos de quien aun no envio su descripcion', () => {
    const context = setup();
    const callId = establishCall(context);

    context.coordinator.relaySignal(context.caller, callId, candidate);
    assert.equal(signalCount(context.callee), 0);

    context.coordinator.relaySignal(context.caller, callId, offer);
    context.coordinator.relaySignal(context.callee, callId, candidate);
    assert.equal(signalCount(context.caller), 0, 'quien recibe necesita enviar su respuesta antes');

    context.coordinator.relaySignal(context.caller, callId, candidate);
    assert.equal(signalCount(context.callee), 2);
  });

  it('permite varios candidatos una vez negociada la llamada', () => {
    const context = setup();
    const callId = establishCall(context);
    negotiate(context, callId);

    context.coordinator.relaySignal(context.callee, callId, candidate);
    context.coordinator.relaySignal(context.callee, callId, candidate);

    assert.equal(signalCount(context.caller), 3);
  });
});

describe('CallCoordinator: llamadas inexistentes o terminadas', () => {
  it('ignora aceptar o rechazar una llamada inexistente sin fallar', () => {
    const { coordinator, callee, caller } = setup();

    assert.doesNotThrow(() => coordinator.accept(callee, 'no-existe'));
    assert.doesNotThrow(() => coordinator.reject(callee, 'no-existe'));
    assert.equal(caller.events.length + callee.events.length, 0);
  });

  it('una llamada terminada no se puede colgar de nuevo ni sigue reenviando senales', () => {
    const context = setup();
    const callId = establishCall(context);
    negotiate(context, callId);
    context.coordinator.hangUp(context.caller, callId);
    const callerEvents = context.caller.events.length;
    const calleeEvents = context.callee.events.length;

    context.coordinator.hangUp(context.callee, callId);
    context.coordinator.relaySignal(context.caller, callId, candidate);
    context.coordinator.relaySignal(context.callee, callId, candidate);

    assert.equal(context.caller.events.length, callerEvents);
    assert.equal(context.callee.events.length, calleeEvents);
  });

  it('explica por que rechaza una llamada sin nombre o una senal invalida', () => {
    const context = setup();
    context.caller.isPresent = false;
    assert.throws(() => context.coordinator.invite(context.caller, context.callee.id), {
      name: 'ValidationError',
      message: 'Escribe tu nombre antes de llamar',
    });

    context.caller.isPresent = true;
    const callId = establishCall(context);
    assert.throws(() => context.coordinator.relaySignal(context.caller, callId, { kind: 'x' }), {
      name: 'ValidationError',
      message: 'La señal de la llamada no es válida',
    });
  });
});

describe('CallCoordinator: quien contesta no puede ofertar ni quien llama responder', () => {
  it('descarta una respuesta de quien llamo aunque su oferta ya se reenvio', () => {
    const context = setup();
    const callId = establishCall(context);
    context.coordinator.relaySignal(context.caller, callId, offer);
    const calleeEvents = context.callee.events.length;

    context.coordinator.relaySignal(context.caller, callId, answer);

    assert.equal(context.callee.events.length, calleeEvents);
  });
});

describe('CallCoordinator: auditoria y metricas', () => {
  it('registra el inicio, la aceptacion y el fin de cada llamada con su id', () => {
    const { logger, entries } = createRecordingLogger();
    const context = setup({ logger });

    const callId = establishCall(context);
    context.coordinator.hangUp(context.callee, callId);

    assert.deepEqual(
      entries.map(({ event, callId: loggedId, reason }) => ({ event, loggedId, reason })),
      [
        { event: 'call.started', loggedId: callId, reason: undefined },
        { event: 'call.accepted', loggedId: callId, reason: undefined },
        { event: 'call.ended', loggedId: callId, reason: CallEndReason.HANGUP },
      ],
    );
  });

  it('cuenta las llamadas iniciadas, activas y terminadas', () => {
    const context = setup();

    const callId = startCall(context);
    assert.deepEqual(context.metrics.snapshot(), {
      [Metric.CALLS_STARTED]: 1,
      [Metric.CALLS_ACTIVE]: 1,
    });

    context.coordinator.reject(context.callee, callId);
    assert.deepEqual(context.metrics.snapshot(), {
      [Metric.CALLS_STARTED]: 1,
      [Metric.CALLS_ACTIVE]: 0,
      [Metric.CALLS_ENDED]: 1,
    });
  });
});

describe('CallCoordinator: temporizador real de timbre', () => {
  const SHORT_RING_MS = 20;

  function setupWithRealTimer() {
    const caller = new FakePeer('ana');
    const callee = new FakePeer('luis');
    const coordinator = new CallCoordinator({
      directory: { find: () => callee },
      logger: createSilentLogger(),
      metrics: new Metrics(),
      ringTimeoutMs: SHORT_RING_MS,
    });
    return { coordinator, caller, callee };
  }

  function activeTimers() {
    return process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
  }

  it('el timbre no mantiene vivo el proceso', () => {
    const { coordinator, caller, callee } = setupWithRealTimer();
    const timersBefore = activeTimers();

    coordinator.invite(caller, callee.id);

    assert.equal(activeTimers(), timersBefore);
    coordinator.hangUp(caller, caller.lastEvent.callId);
  });

  it('corta la llamada cuando vence el tiempo real de espera', async () => {
    const { coordinator, caller, callee } = setupWithRealTimer();
    coordinator.invite(caller, callee.id);

    await wait(SHORT_RING_MS * 3);

    assert.equal(caller.lastEvent.reason, CallEndReason.TIMEOUT);
    assert.equal(callee.lastEvent.reason, CallEndReason.TIMEOUT);
  });

  it('colgar cancela el temporizador y no llega un segundo aviso', async () => {
    const { coordinator, caller, callee } = setupWithRealTimer();
    coordinator.invite(caller, callee.id);
    coordinator.hangUp(caller, caller.lastEvent.callId);
    const eventsAfterHangUp = callee.events.length;

    await wait(SHORT_RING_MS * 3);

    assert.equal(callee.events.length, eventsAfterHangUp);
    assert.equal(callee.lastEvent.reason, CallEndReason.HANGUP);
  });
});

describe('CallCoordinator: salas', () => {
  it('no permite llamar a alguien de otra sala', () => {
    const { coordinator, caller, callee } = setup();
    callee.roomId = 'otra-sala';

    coordinator.invite(caller, callee.id);

    assert.equal(caller.lastEvent.reason, CallEndReason.UNAVAILABLE);
    assert.equal(callee.events.length, 0);
  });
});
