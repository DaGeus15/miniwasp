import { ClientEvent } from '../../shared/events.js';
import { announceInvite, removeMember } from '../rooms/room-membership.js';
import { ValidationError, requireName } from '../validation.js';

const OWNER_ONLY_ERROR = 'Solo quien creó la sala puede hacer esto';
const NAME_TAKEN_ERROR = 'Ese nombre ya lo usa otra persona de esta sala';

// La sesion detras de una conexion: es la identidad que juzgan la moderacion y los permisos.
function sessionOf(peer) {
  return { id: peer.sessionId, roomId: peer.roomId, isOwner: peer.isOwner };
}

// El nombre debe estar libre en la sala y pasar la moderacion antes de usarse.
function requireAvailableName({ contentGate }, room, peer, rawName) {
  const name = requireName(rawName);
  if (!room.names.isAvailableFor(peer.sessionId, name)) {
    throw new ValidationError(NAME_TAKEN_ERROR);
  }
  contentGate.reviewText(sessionOf(peer), name, room.profile);
  return name;
}

function adoptName({ peers }, room, peer, name) {
  room.names.claim(peer.sessionId, name);
  peers.rename(peer, name);
}

// El autor del mensaje siempre es la identidad validada de la conexion. Todo se valida y
// modera antes de guardar nada: un mensaje invalido o bloqueado no tiene efectos.
export function createChatRoute(context) {
  return {
    limiter: context.chatLimiter,
    handle(peer, payload) {
      const room = context.rooms.find(peer.roomId);
      const name = requireAvailableName(context, room, peer, payload.name);
      context.messenger.send({
        room,
        session: sessionOf(peer),
        name,
        text: payload.text,
        attachmentId: payload.attachmentId,
      });
      adoptName(context, room, peer, name);
    },
  };
}

function createPresenceRoute(context) {
  return {
    limiter: context.presenceLimiter,
    handle(peer, { name: rawName }) {
      const room = context.rooms.find(peer.roomId);
      adoptName(context, room, peer, requireAvailableName(context, room, peer, rawName));
    },
  };
}

function requireOwner(peer) {
  if (!peer.isOwner) {
    throw new ValidationError(OWNER_ONLY_ERROR);
  }
}

function expel(context, owner, peerId) {
  requireOwner(owner);
  const target = context.peers.find(peerId);
  if (!target || target === owner || !owner.sharesRoomWith(target)) {
    return;
  }
  removeMember(context, owner.roomId, target.sessionId);
}

export function createRoomRoutes(context) {
  const signalRoute = (handle) => ({ limiter: context.signalLimiter, handle });
  // Borrar y reportar comparten la forma: { messageId } sobre la sala de la conexion.
  const messageRoute = (limiter, act) => ({
    limiter,
    handle: (peer, { messageId }) =>
      act({ room: context.rooms.find(peer.roomId), session: sessionOf(peer), messageId }),
  });

  return new Map([
    [ClientEvent.CHAT_MESSAGE, createChatRoute(context)],
    [ClientEvent.PRESENCE, createPresenceRoute(context)],
    [ClientEvent.MESSAGE_DELETE, messageRoute(context.chatLimiter, (input) => context.messenger.delete(input))],
    [ClientEvent.MESSAGE_REPORT, messageRoute(context.reportLimiter, (input) => context.messenger.report(input))],
    [ClientEvent.ROOM_EXPEL, signalRoute((peer, { peerId }) => expel(context, peer, peerId))],
    [
      ClientEvent.ROOM_ROTATE_INVITE,
      signalRoute((peer) => {
        requireOwner(peer);
        announceInvite(context, peer.roomId);
      }),
    ],
  ]);
}

// Susurros: invitar tiene su propio limite (evita el acoso con invitaciones repetidas).
export function createWhisperRoutes({ whispers, whisperLimiter, signalLimiter }) {
  const signalRoute = (handle) => ({ limiter: signalLimiter, handle });

  return new Map([
    [ClientEvent.WHISPER_INVITE, { limiter: whisperLimiter, handle: (peer, { to }) => whispers.invite(peer, to) }],
    [ClientEvent.WHISPER_ACCEPT, signalRoute((peer, { whisperId }) => whispers.accept(peer, whisperId))],
    [ClientEvent.WHISPER_REJECT, signalRoute((peer, { whisperId }) => whispers.reject(peer, whisperId))],
    [
      ClientEvent.WHISPER_PREFERENCE,
      signalRoute((peer, { acceptsWhispers }) => whispers.setAcceptsWhispers(peer, acceptsWhispers)),
    ],
  ]);
}

export function createCallRoutes({ calls, signalLimiter, inviteLimiter }) {
  const signalRoute = (handle) => ({ limiter: signalLimiter, handle });

  return new Map([
    [
      ClientEvent.CALL_INVITE,
      { limiter: inviteLimiter, handle: (peer, { to }) => calls.invite(peer, to) },
    ],
    [ClientEvent.CALL_ACCEPT, signalRoute((peer, { callId }) => calls.accept(peer, callId))],
    [ClientEvent.CALL_REJECT, signalRoute((peer, { callId }) => calls.reject(peer, callId))],
    [ClientEvent.CALL_HANGUP, signalRoute((peer, { callId }) => calls.hangUp(peer, callId))],
    [
      ClientEvent.CALL_SIGNAL,
      signalRoute((peer, { callId, signal }) => calls.relaySignal(peer, callId, signal)),
    ],
  ]);
}
