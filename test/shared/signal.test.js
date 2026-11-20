import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SignalKind } from '../../src/shared/events.js';
import { MAX_CANDIDATE_LENGTH, MAX_SDP_LENGTH } from '../../src/shared/limits.js';
import { sanitizeSignal } from '../../src/shared/signal.js';

const candidate = {
  candidate: 'candidate:1 1 udp 2122260223 192.168.1.2 50000 typ host',
  sdpMid: '0',
  sdpMLineIndex: 0,
  usernameFragment: 'abcd',
};

describe('sanitizeSignal', () => {
  it('acepta ofertas y respuestas', () => {
    for (const kind of [SignalKind.OFFER, SignalKind.ANSWER]) {
      assert.deepEqual(sanitizeSignal({ kind, sdp: 'v=0' }), { kind, sdp: 'v=0' });
    }
  });

  it('acepta candidatos completos', () => {
    const signal = { kind: SignalKind.CANDIDATE, candidate };

    assert.deepEqual(sanitizeSignal(signal), signal);
  });

  it('completa con null los campos opcionales de un candidato', () => {
    const signal = { kind: SignalKind.CANDIDATE, candidate: { candidate: 'candidate:1' } };

    assert.deepEqual(sanitizeSignal(signal).candidate, {
      candidate: 'candidate:1',
      sdpMid: null,
      sdpMLineIndex: null,
      usernameFragment: null,
    });
  });

  it('descarta los campos que no forman parte de la senal', () => {
    const offer = sanitizeSignal({ kind: SignalKind.OFFER, sdp: 'v=0', admin: true });
    const ice = sanitizeSignal({
      kind: SignalKind.CANDIDATE,
      candidate: { ...candidate, extra: 'x' },
      extra: 'x',
    });

    assert.deepEqual(Object.keys(offer), ['kind', 'sdp']);
    assert.deepEqual(Object.keys(ice), ['kind', 'candidate']);
    assert.equal(Object.hasOwn(ice.candidate, 'extra'), false);
  });

  it('rechaza senales mal formadas', () => {
    const invalid = [
      null,
      undefined,
      'texto',
      {},
      { kind: 'constructor' },
      { kind: SignalKind.OFFER },
      { kind: SignalKind.OFFER, sdp: '' },
      { kind: SignalKind.ANSWER, sdp: 5 },
      { kind: SignalKind.OFFER, sdp: 'a'.repeat(MAX_SDP_LENGTH + 1) },
      { kind: SignalKind.CANDIDATE },
      { kind: SignalKind.CANDIDATE, candidate: { candidate: '' } },
      { kind: SignalKind.CANDIDATE, candidate: { candidate: 'a'.repeat(MAX_CANDIDATE_LENGTH + 1) } },
      { kind: SignalKind.CANDIDATE, candidate: { ...candidate, sdpMid: 5 } },
      { kind: SignalKind.CANDIDATE, candidate: { ...candidate, sdpMLineIndex: -1 } },
      { kind: SignalKind.CANDIDATE, candidate: { ...candidate, sdpMLineIndex: 'cero' } },
      { kind: SignalKind.CANDIDATE, candidate: { ...candidate, usernameFragment: {} } },
    ];

    for (const signal of invalid) {
      assert.equal(sanitizeSignal(signal), null);
    }
  });
});
