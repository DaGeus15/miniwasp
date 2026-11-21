import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallEndReason, ClientEvent, ServerEvent, SignalKind, WhisperEndReason } from '../../src/shared/events.js';

// Contrato del protocolo: estos textos viajan por la red. Cambiar uno rompe la
// compatibilidad con clientes ya cargados en los navegadores, asi que deben fijarse.
describe('contrato del protocolo', () => {
  it('fija los eventos que envia el navegador', () => {
    assert.deepEqual(ClientEvent, {
      CHAT_MESSAGE: 'chat-message',
      PRESENCE: 'presence',
      ROOM_EXPEL: 'room-expel',
      ROOM_ROTATE_INVITE: 'room-rotate-invite',
      MESSAGE_DELETE: 'message-delete',
      MESSAGE_REPORT: 'message-report',
      WHISPER_INVITE: 'whisper-invite',
      WHISPER_ACCEPT: 'whisper-accept',
      WHISPER_REJECT: 'whisper-reject',
      WHISPER_PREFERENCE: 'whisper-preference',
      CALL_INVITE: 'call-invite',
      CALL_ACCEPT: 'call-accept',
      CALL_REJECT: 'call-reject',
      CALL_HANGUP: 'call-hangup',
      CALL_SIGNAL: 'call-signal',
      CALL_RESUME: 'call-resume',
    });
  });

  it('fija los eventos que envia el servidor', () => {
    assert.deepEqual(ServerEvent, {
      HISTORY: 'history',
      MESSAGE: 'message',
      ERROR: 'error',
      WELCOME: 'welcome',
      PRESENCE: 'presence',
      ROOM_INVITE: 'room-invite',
      MESSAGE_DELETED: 'message-deleted',
      MESSAGE_REPORTED: 'message-reported',
      WHISPER_INCOMING: 'whisper-incoming',
      WHISPER_READY: 'whisper-ready',
      WHISPER_ENDED: 'whisper-ended',
      CALL_RINGING: 'call-ringing',
      CALL_INCOMING: 'call-incoming',
      CALL_ACCEPTED: 'call-accepted',
      CALL_SIGNAL: 'call-signal',
      CALL_ENDED: 'call-ended',
    });
  });

  it('fija los motivos de fin de llamada y los tipos de senal', () => {
    assert.deepEqual(CallEndReason, {
      REJECTED: 'rejected',
      HANGUP: 'hangup',
      BUSY: 'busy',
      UNAVAILABLE: 'unavailable',
      DISCONNECTED: 'disconnected',
      TIMEOUT: 'timeout',
    });
    assert.deepEqual(SignalKind, { OFFER: 'offer', ANSWER: 'answer', CANDIDATE: 'candidate' });
  });

  it('fija los motivos de fin de un susurro', () => {
    assert.deepEqual(WhisperEndReason, { REJECTED: 'rejected', TIMEOUT: 'timeout', UNAVAILABLE: 'unavailable' });
  });

  it('impide modificar el vocabulario en tiempo de ejecucion', () => {
    for (const vocabulary of [ClientEvent, ServerEvent, CallEndReason, SignalKind]) {
      assert.equal(Object.isFrozen(vocabulary), true);
    }
  });
});
