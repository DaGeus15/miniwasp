import { ServerEvent } from '../../shared/events.js';
import { CloseCode } from '../peers/peer-registry.js';

// Renueva la invitacion de la sala y la comparte con quienes siguen dentro.
export function announceInvite({ rooms, peers }, roomId) {
  const inviteToken = rooms.rotateInvite(rooms.find(roomId));
  peers.broadcast(roomId, { type: ServerEvent.ROOM_INVITE, inviteToken });
}

// Saca a una persona de la sala, por decision de quien la creo o por la moderacion:
// revoca su sesion, libera su nombre, la saca de videollamadas, cierra sus conexiones y
// renueva la invitacion para que el enlace que ya tenia no le sirva para volver.
// En las salas que vetan (las publicas), ademas guarda la huella de su IP para que no vuelva.
export function removeMember(context, roomId, sessionId) {
  const room = context.rooms.find(roomId);
  const [session] = context.sessions.findWhere((candidate) => candidate.id === sessionId);
  if (room?.profile.bansExpelled) {
    room.bans.ban(session?.clientRef);
  }
  context.sessions.revokeWhere((candidate) => candidate.id === sessionId);
  room?.names.release(sessionId);
  context.videoCalls.leaveAll(sessionId);
  context.peers.closeSession(sessionId, CloseCode.EXPELLED);
  context.logger.info('room.member.removed', { roomId });
  announceInvite(context, roomId);
}
