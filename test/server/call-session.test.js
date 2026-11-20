import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallSession } from '../../src/server/calls/call-session.js';
import { SignalKind } from '../../src/shared/events.js';

describe('CallSession', () => {
  const caller = { id: 'ana' };
  const callee = { id: 'luis' };

  it('se puede contestar o detener aunque nunca haya empezado a sonar', () => {
    const session = new CallSession(caller, callee);

    assert.doesNotThrow(() => session.stopRinging());
    assert.doesNotThrow(() => session.answer());
    assert.equal(session.awaitsAnswerFrom(callee), false);
  });

  it('solo quien recibe puede responder, incluso despues de la oferta', () => {
    const session = new CallSession(caller, callee);
    session.answer();
    session.recordSignal(SignalKind.OFFER);

    assert.equal(session.canSignal(caller, SignalKind.ANSWER), false);
    assert.equal(session.canSignal(callee, SignalKind.ANSWER), true);
  });
});
