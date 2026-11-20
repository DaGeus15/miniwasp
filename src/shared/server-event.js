import { ATTACHMENT_ID_PATTERN, findAttachmentType } from './attachments.js';
import { CallEndReason, ServerEvent, WhisperEndReason } from './events.js';
import { sanitizeSignal } from './signal.js';

const CALL_END_REASONS = new Set(Object.values(CallEndReason));
const ROOM_VISIBILITIES = new Set(['private', 'public', 'whisper']);
const WHISPER_END_REASONS = new Set(Object.values(WhisperEndReason));

// Stryker disable OptionalChaining: parseServerEvent atrapa cualquier TypeError y devuelve
// null, el mismo resultado que da el validador con ?. al recibir null o un tipo desconocido.
// El tipo debe ser uno de los aceptados y coincidir con su clase: el cliente decide como
// mostrar el adjunto a partir de estos datos.
function isAttachment(value) {
  const type = findAttachmentType(value?.mimeType);
  return (
    type !== null &&
    type.kind === value.kind &&
    ATTACHMENT_ID_PATTERN.test(value.id) &&
    typeof value.fileName === 'string' &&
    Number.isInteger(value.size)
  );
}

function isMessage(value) {
  return (
    typeof value?.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.text === 'string' &&
    !Number.isNaN(Date.parse(value.time)) &&
    (value.attachment === undefined || isAttachment(value.attachment))
  );
}

function hasWhisperId(event) {
  return typeof event.whisperId === 'string';
}

function isWhisperEndedEvent(event) {
  // whisperId es null cuando la invitacion se rechaza antes de existir.
  return (hasWhisperId(event) || event.whisperId === null) && WHISPER_END_REASONS.has(event.reason);
}

function hasMessageId(event) {
  return typeof event.messageId === 'string';
}

function isPeer(value) {
  return typeof value?.id === 'string' && typeof value.name === 'string';
}

function isPeerList(value) {
  return Array.isArray(value) && value.every(isPeer);
}

function isIceServerList(value) {
  return Array.isArray(value) && value.every((server) => typeof server?.urls === 'string');
}

function isInviteToken(value) {
  return typeof value === 'string' && value.length > 0;
}

function hasCallId(event) {
  return typeof event.callId === 'string';
}

function isCallParticipantEvent(event) {
  return hasCallId(event) && isPeer(event.peer);
}

function isCallEndedEvent(event) {
  // callId es null cuando el servidor rechaza una invitacion que nunca llego a ser llamada.
  return (hasCallId(event) || event.callId === null) && CALL_END_REASONS.has(event.reason);
}

// Para aceptar un evento nuevo basta con agregar su validador aqui.
const EVENT_VALIDATORS = new Map([
  [ServerEvent.HISTORY, (event) => Array.isArray(event.messages) && event.messages.every(isMessage)],
  [ServerEvent.MESSAGE, (event) => isMessage(event.message)],
  [ServerEvent.ERROR, (event) => typeof event.error === 'string'],
  [
    ServerEvent.WELCOME,
    (event) =>
      typeof event.peerId === 'string' &&
      isPeerList(event.peers) &&
      isIceServerList(event.iceServers) &&
      isInviteToken(event.inviteToken) &&
      typeof event.isOwner === 'boolean' &&
      ROOM_VISIBILITIES.has(event.visibility) &&
      (event.title === null || typeof event.title === 'string'),
  ],
  [ServerEvent.PRESENCE, (event) => isPeerList(event.peers)],
  [ServerEvent.ROOM_INVITE, (event) => isInviteToken(event.inviteToken)],
  [ServerEvent.MESSAGE_DELETED, hasMessageId],
  [ServerEvent.WHISPER_INCOMING, (event) => hasWhisperId(event) && isPeer(event.from)],
  [ServerEvent.WHISPER_READY, (event) => hasWhisperId(event) && typeof event.transferToken === 'string'],
  [ServerEvent.WHISPER_ENDED, isWhisperEndedEvent],
  [ServerEvent.MESSAGE_REPORTED, (event) => hasMessageId(event) && Number.isInteger(event.reports)],
  [ServerEvent.CALL_RINGING, isCallParticipantEvent],
  [ServerEvent.CALL_INCOMING, isCallParticipantEvent],
  [ServerEvent.CALL_ACCEPTED, hasCallId],
  [ServerEvent.CALL_SIGNAL, (event) => hasCallId(event) && sanitizeSignal(event.signal) !== null],
  [ServerEvent.CALL_ENDED, isCallEndedEvent],
]);

export function parseServerEvent(data) {
  try {
    const event = JSON.parse(data);
    const isValid = EVENT_VALIDATORS.get(event?.type);
    return isValid?.(event) ? event : null;
  } catch {
    return null;
  }
}
// Stryker restore OptionalChaining
