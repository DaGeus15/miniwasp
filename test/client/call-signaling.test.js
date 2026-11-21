import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallSignaling } from '../../src/client/calls/call-signaling.js';
import { ClientEvent, SignalKind } from '../../src/shared/events.js';

function setup({ isOnline = true } = {}) {
  const sent = [];
  const signaling = new CallSignaling((payload) => {
    sent.push(payload);
    return isOnline;
  });
  return { sent, signaling };
}

describe('CallSignaling', () => {
  it('traduce cada intencion a su evento del protocolo', () => {
    const { sent, signaling } = setup();
    const signal = { kind: SignalKind.OFFER, sdp: 'v=0' };

    signaling.invite('peer-1');
    signaling.accept('call-1');
    signaling.reject('call-1');
    signaling.hangUp('call-1');
    signaling.relay('call-1', signal);
    signaling.resume('call-1');

    assert.deepEqual(sent, [
      { type: ClientEvent.CALL_INVITE, to: 'peer-1' },
      { type: ClientEvent.CALL_ACCEPT, callId: 'call-1' },
      { type: ClientEvent.CALL_REJECT, callId: 'call-1' },
      { type: ClientEvent.CALL_HANGUP, callId: 'call-1' },
      { type: ClientEvent.CALL_SIGNAL, callId: 'call-1', signal },
      { type: ClientEvent.CALL_RESUME, callId: 'call-1' },
    ]);
  });

  it('informa si el evento no se pudo enviar', () => {
    assert.equal(setup().signaling.invite('peer-1'), true);
    assert.equal(setup({ isOnline: false }).signaling.invite('peer-1'), false);
  });
});
