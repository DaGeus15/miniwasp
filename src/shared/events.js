// Vocabulario del protocolo entre el navegador y el servidor.
export const ClientEvent = Object.freeze({
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

export const ServerEvent = Object.freeze({
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

export const CallEndReason = Object.freeze({
  REJECTED: 'rejected',
  HANGUP: 'hangup',
  BUSY: 'busy',
  UNAVAILABLE: 'unavailable',
  DISCONNECTED: 'disconnected',
  TIMEOUT: 'timeout',
});

// Por que termino una invitacion a susurrar. "unavailable" cubre a proposito varios casos
// (no acepta susurros, esta ocupada, se fue): quien invita no sabe cual fue.
export const WhisperEndReason = Object.freeze({
  REJECTED: 'rejected',
  TIMEOUT: 'timeout',
  UNAVAILABLE: 'unavailable',
});

export const SignalKind = Object.freeze({
  OFFER: 'offer',
  ANSWER: 'answer',
  CANDIDATE: 'candidate',
});
