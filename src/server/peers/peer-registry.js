import { ServerEvent } from '../../shared/events.js';
import { Peer } from './peer.js';

export const CloseCode = Object.freeze({
  SESSION_ENDED: 4401,
  EXPELLED: 4403,
  ROOM_CLOSED: 4404,
});

// Directorio de conexiones. Todo lo que se difunde queda dentro de la sala de cada conexion.
export class PeerRegistry {
  #peersById = new Map();

  add({ socket, address, session }) {
    const peer = new Peer({ socket, address, session });
    this.#peersById.set(peer.id, peer);
    return peer;
  }

  remove(peer) {
    this.#peersById.delete(peer.id);
    if (peer.isPresent) {
      this.#announcePresence(peer.roomId);
    }
  }

  find(peerId) {
    return this.#peersById.get(peerId);
  }

  hasMembers(roomId) {
    return this.#membersOf(roomId).length > 0;
  }

  // Cuenta personas, no pestanas: una sesion con varias conexiones cuenta una vez.
  admitsSession(roomId, sessionId, maxMembers) {
    const sessions = new Set(this.#membersOf(roomId).map((peer) => peer.sessionId));
    return sessions.has(sessionId) || sessions.size < maxMembers;
  }

  // Solo difunde cuando el nombre cambia: repetir el mismo nombre no genera trafico.
  rename(peer, name) {
    if (peer.rename(name)) {
      this.#announcePresence(peer.roomId);
    }
  }

  // Una persona aparece una sola vez aunque una reconexion deje por un momento su
  // conexion anterior abierta: se muestra la mas reciente de cada sesion.
  publicProfiles(roomId) {
    const latestPeerBySession = new Map();
    for (const peer of this.#membersOf(roomId)) {
      if (peer.isPresent) {
        latestPeerBySession.set(peer.sessionId, peer);
      }
    }
    return [...latestPeerBySession.values()].map((peer) => peer.toPublicProfile());
  }

  // Personas distintas conectadas (varias pestañas de la misma sesion cuentan una vez).
  countSessions(roomId) {
    return new Set(this.#membersOf(roomId).map((peer) => peer.sessionId)).size;
  }

  broadcast(roomId, event) {
    this.#deliverWhere(roomId, () => true, event);
  }

  // Avisos solo para quien creo la sala (por ejemplo, un mensaje reportado).
  notifyOwners(roomId, event) {
    this.#deliverWhere(roomId, (peer) => peer.isOwner, event);
  }

  closeSession(sessionId, code = CloseCode.SESSION_ENDED) {
    this.#closeWhere((peer) => peer.sessionId === sessionId, code);
  }

  closeRoom(roomId) {
    this.#closeWhere((peer) => peer.roomId === roomId, CloseCode.ROOM_CLOSED);
  }

  closeInactiveSessions(isSessionActive) {
    this.#closeWhere((peer) => !isSessionActive(peer.sessionId), CloseCode.SESSION_ENDED);
  }

  #deliverWhere(roomId, predicate, event) {
    const encodedEvent = JSON.stringify(event);
    for (const peer of this.#membersOf(roomId)) {
      if (predicate(peer)) {
        peer.deliver(encodedEvent);
      }
    }
  }

  #membersOf(roomId) {
    return [...this.#peersById.values()].filter((peer) => peer.roomId === roomId);
  }

  #closeWhere(predicate, code) {
    for (const peer of this.#peersById.values()) {
      if (predicate(peer)) {
        peer.close(code);
      }
    }
  }

  #announcePresence(roomId) {
    this.broadcast(roomId, { type: ServerEvent.PRESENCE, peers: this.publicProfiles(roomId) });
  }
}
