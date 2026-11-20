import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallEndReason, ServerEvent, SignalKind } from '../../src/shared/events.js';
import { parseServerEvent } from '../../src/shared/server-event.js';

const message = { id: '1', name: 'Ana', text: 'hola', time: '2026-11-04T10:00:00.000Z' };
const peer = { id: 'peer-1', name: 'Ana' };
const callId = 'call-1';

describe('parseServerEvent', () => {
  it('acepta los eventos conocidos', () => {
    const events = [
      { type: ServerEvent.HISTORY, messages: [message] },
      { type: ServerEvent.MESSAGE, message },
      { type: ServerEvent.ERROR, error: 'fallo' },
      {
        type: ServerEvent.WELCOME,
        peerId: 'peer-2',
        peers: [peer],
        iceServers: [{ urls: 'stun:stun.test' }],
        inviteToken: 'invitacion-1234567890',
        isOwner: true,
        visibility: 'private',
        title: null,
      },
      { type: ServerEvent.PRESENCE, peers: [peer] },
      { type: ServerEvent.ROOM_INVITE, inviteToken: 'invitacion-nueva-12345' },
      { type: ServerEvent.CALL_RINGING, callId, peer },
      { type: ServerEvent.CALL_INCOMING, callId, peer },
      { type: ServerEvent.CALL_ACCEPTED, callId },
      { type: ServerEvent.CALL_SIGNAL, callId, signal: { kind: SignalKind.OFFER, sdp: 'v=0' } },
      { type: ServerEvent.CALL_ENDED, callId, reason: CallEndReason.HANGUP },
      { type: ServerEvent.CALL_ENDED, callId: null, reason: CallEndReason.BUSY },
    ];

    for (const event of events) {
      assert.deepEqual(parseServerEvent(JSON.stringify(event)), event);
    }
  });

  it('devuelve null si el JSON esta corrupto', () => {
    assert.equal(parseServerEvent('{corrupto'), null);
  });

  it('rechaza eventos desconocidos o mal formados', () => {
    const invalid = [
      null,
      {},
      { type: 'constructor' },
      { type: ServerEvent.HISTORY, messages: 'nada' },
      { type: ServerEvent.HISTORY, messages: [{ id: '1' }] },
      { type: ServerEvent.HISTORY, messages: [message, { id: '1' }] },
      { type: ServerEvent.MESSAGE, message: { ...message, id: 5 } },
      { type: ServerEvent.MESSAGE, message: { ...message, name: 5 } },
      { type: ServerEvent.MESSAGE, message: { ...message, time: 'no es fecha' } },
      { type: ServerEvent.MESSAGE, message: { ...message, text: 5 } },
      { type: ServerEvent.ERROR, error: 5 },
      { type: ServerEvent.WELCOME, peerId: 5, peers: [], iceServers: [] },
      { type: ServerEvent.WELCOME, peerId: 'a', peers: 'nadie', iceServers: [] },
      { type: ServerEvent.WELCOME, peerId: 'a', peers: [], iceServers: [{ urls: 5 }] },
      { type: ServerEvent.WELCOME, peerId: 'a', peers: [], iceServers: 'stun' },
      {
        type: ServerEvent.WELCOME,
        peerId: 'a',
        peers: [],
        iceServers: [{ urls: 'stun:stun.test' }, { urls: 5 }],
      },
      { type: ServerEvent.PRESENCE, peers: [{ id: 'sin nombre' }] },
      { type: ServerEvent.PRESENCE, peers: [{ id: 5, name: 'Ana' }] },
      { type: ServerEvent.CALL_RINGING, callId: 5, peer },
      { type: ServerEvent.CALL_INCOMING, callId, peer: { id: 'sin nombre' } },
      { type: ServerEvent.CALL_ACCEPTED },
      { type: ServerEvent.CALL_SIGNAL, callId, signal: { kind: 'virus' } },
      { type: ServerEvent.CALL_ENDED, callId, reason: 'inventada' },
      { type: ServerEvent.CALL_ENDED, reason: CallEndReason.HANGUP },
    ];

    for (const event of invalid) {
      assert.equal(parseServerEvent(JSON.stringify(event)), null);
    }
  });
});
