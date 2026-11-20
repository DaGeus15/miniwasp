import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StrikeAction, StrikeTracker } from '../../../src/server/moderation/strike-tracker.js';
import { ModerationCategory } from '../../../src/server/moderation/text-moderator.js';

const MINUTE = 60_000;
const { HATE, MINORS_SEXUAL } = ModerationCategory;

function createClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

function createTracker(options = {}) {
  const clock = createClock();
  const tracker = new StrikeTracker({ now: clock.now, ...options });
  return { clock, tracker };
}

function recordTimes(tracker, sessionId, times) {
  let result;
  for (let i = 0; i < times; i += 1) {
    result = tracker.record(sessionId, HATE);
  }
  return result;
}

describe('StrikeTracker: advertencias y silencio', () => {
  it('advierte hasta el maximo y entonces silencia durante muteMs', () => {
    const { clock, tracker } = createTracker();

    assert.deepEqual(tracker.record('ana', HATE), { action: StrikeAction.NONE, strikes: 1 });
    assert.deepEqual(tracker.record('ana', HATE), { action: StrikeAction.NONE, strikes: 2 });
    assert.equal(tracker.isMuted('ana'), false);

    const third = tracker.record('ana', HATE);

    assert.deepEqual(third, { action: StrikeAction.MUTE, strikes: 3, mutedUntil: clock.now() + 10 * MINUTE });
    assert.ok(Object.isFrozen(third));
    assert.equal(tracker.isMuted('ana'), true);
    assert.equal(tracker.muteRemainingMs('ana'), 10 * MINUTE);
  });

  it('el silencio termina exactamente al cumplirse muteMs', () => {
    const { clock, tracker } = createTracker();
    recordTimes(tracker, 'ana', 3);

    clock.advance(10 * MINUTE - 1);
    assert.equal(tracker.isMuted('ana'), true);
    assert.equal(tracker.muteRemainingMs('ana'), 1);

    clock.advance(1);
    assert.equal(tracker.isMuted('ana'), false);
    assert.equal(tracker.muteRemainingMs('ana'), 0);
  });

  it('respeta las opciones de maximo y duracion', () => {
    const { clock, tracker } = createTracker({ maxStrikes: 1, muteMs: 5 * MINUTE });

    assert.deepEqual(tracker.record('ana', HATE), {
      action: StrikeAction.MUTE,
      strikes: 1,
      mutedUntil: clock.now() + 5 * MINUTE,
    });
  });

  it('cada sesion lleva su propia cuenta', () => {
    const { tracker } = createTracker();
    recordTimes(tracker, 'ana', 2);

    assert.deepEqual(tracker.record('luis', HATE), { action: StrikeAction.NONE, strikes: 1 });
    assert.equal(tracker.isMuted('desconocido'), false);
    assert.equal(tracker.muteRemainingMs('desconocido'), 0);
  });
});

describe('StrikeTracker: ventana deslizante', () => {
  it('olvida infracciones al cumplirse windowMs', () => {
    const { clock, tracker } = createTracker();
    recordTimes(tracker, 'ana', 2);

    clock.advance(15 * MINUTE);

    assert.deepEqual(tracker.record('ana', HATE), { action: StrikeAction.NONE, strikes: 1 });
  });

  it('una infraccion justo antes del limite de la ventana todavia cuenta', () => {
    const { clock, tracker } = createTracker();
    recordTimes(tracker, 'ana', 2);

    clock.advance(15 * MINUTE - 1);

    assert.equal(tracker.record('ana', HATE).action, StrikeAction.MUTE);
  });

  it('reincidir hasta el maximo dentro de la ventana tras un silencio expulsa', () => {
    const { clock, tracker } = createTracker();
    recordTimes(tracker, 'ana', 3);
    clock.advance(10 * MINUTE);

    assert.deepEqual(recordTimes(tracker, 'ana', 2), { action: StrikeAction.NONE, strikes: 2 });

    clock.advance(5 * MINUTE - 1);
    assert.deepEqual(tracker.record('ana', HATE), { action: StrikeAction.EXPEL, strikes: 3 });
    assert.equal(tracker.size, 0);
  });

  it('si el silencio anterior ya salio de la ventana vuelve a silenciar', () => {
    const { clock, tracker } = createTracker();
    recordTimes(tracker, 'ana', 3);
    clock.advance(15 * MINUTE);

    assert.equal(recordTimes(tracker, 'ana', 3).action, StrikeAction.MUTE);
  });
});

describe('StrikeTracker: menores y memoria', () => {
  it('contenido sexual con menores expulsa a la primera y olvida la sesion', () => {
    const { tracker } = createTracker();
    tracker.record('ana', HATE);

    const result = tracker.record('ana', MINORS_SEXUAL);

    assert.deepEqual(result, { action: StrikeAction.EXPEL, strikes: 3 });
    assert.ok(Object.isFrozen(result));
    assert.equal(tracker.size, 0);
  });

  it('forget borra el historial y el silencio', () => {
    const { tracker } = createTracker();
    recordTimes(tracker, 'ana', 3);

    tracker.forget('ana');

    assert.equal(tracker.isMuted('ana'), false);
    assert.deepEqual(tracker.record('ana', HATE), { action: StrikeAction.NONE, strikes: 1 });
  });

  it('poda sesiones inactivas para acotar la memoria', () => {
    const { clock, tracker } = createTracker();
    tracker.record('ana', HATE);
    recordTimes(tracker, 'luis', 3);
    assert.equal(tracker.size, 2);

    clock.advance(15 * MINUTE);
    tracker.record('eva', HATE);

    assert.equal(tracker.size, 1);
  });

  it('no poda sesiones silenciadas ni con un silencio reciente', () => {
    const { clock, tracker } = createTracker({ muteMs: 20 * MINUTE });
    recordTimes(tracker, 'luis', 3);

    clock.advance(15 * MINUTE);
    tracker.record('eva', HATE);

    assert.equal(tracker.size, 2);
    assert.equal(tracker.isMuted('luis'), true);
  });

  it('poda como mucho una vez por minuto', () => {
    const { clock, tracker } = createTracker({ windowMs: 1000, muteMs: 1000 });
    tracker.record('ana', HATE);

    clock.advance(MINUTE - 1);
    tracker.record('eva', HATE);
    assert.equal(tracker.size, 2);

    clock.advance(1);
    tracker.record('eva', HATE);
    assert.equal(tracker.size, 1);
  });

  it('usa el reloj del sistema por defecto', () => {
    const tracker = new StrikeTracker();

    assert.deepEqual(tracker.record('ana', HATE), { action: StrikeAction.NONE, strikes: 1 });
  });
});
