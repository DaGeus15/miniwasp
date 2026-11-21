import { ServerEvent } from '../../shared/events.js';
import { Metric } from '../observability/metrics.js';
import { isRoomInUse } from '../rooms/room-occupancy.js';
import { isSameOrigin } from '../security/origin-guard.js';
import { readSessionToken } from '../security/session-cookie.js';

const HTTP_UNAUTHORIZED = 401;
const HTTP_SERVICE_UNAVAILABLE = 503;

function findRoomSession({ sessions, rooms }, request) {
  const session = sessions.find(readSessionToken(request));
  return session && rooms.find(session.roomId) ? session : null;
}

function hasCapacity(context, request, session) {
  const capacity = context.rooms.find(session.roomId).capacityWithin(context.maxRoomMembers);
  return (
    context.connectionGuard.admits(context.readAddress(request)) &&
    context.peers.admitsSession(session.roomId, session.id, capacity)
  );
}

function rejectionStatus(context, origin, request) {
  const session = findRoomSession(context, request);
  if (!isSameOrigin(origin, request.headers.host) || !session) {
    return HTTP_UNAUTHORIZED;
  }
  return hasCapacity(context, request, session) ? null : HTTP_SERVICE_UNAVAILABLE;
}

// Solo entra por WebSocket quien tiene una sesion de una sala abierta, desde el mismo origen
// y mientras haya lugar en el servidor y en la sala.
export function createHandshakeVerifier(context) {
  return ({ origin, req: request }, respond) => {
    const status = rejectionStatus(context, origin, request);
    if (status) {
      context.metrics.increment(Metric.CONNECTIONS_REJECTED);
      respond(false, status);
    } else {
      respond(true);
    }
  };
}

function welcome(context, peer, room) {
  peer.send({ type: ServerEvent.HISTORY, messages: room.chat.history() });
  peer.send({
    type: ServerEvent.WELCOME,
    peerId: peer.id,
    peers: context.peers.publicProfiles(room.id),
    iceServers: context.iceServers,
    inviteToken: room.inviteToken,
    isOwner: peer.isOwner,
    visibility: room.visibility,
    title: room.title,
  });
}

// Una conexion que se corta sin que la sesion termine (red inestable, pestaña en segundo
// plano) puede volver: sus llamadas la esperan unos segundos.
function canReturn({ sessions, rooms }, peer) {
  return sessions.isActive(peer.sessionId) && Boolean(rooms.find(peer.roomId));
}

function releaseConnection(context, messaging, peer, address) {
  const { peers, rooms, connectionGuard, metrics } = context;
  connectionGuard.release(address);
  messaging.calls.handleDeparture(peer, { canReturn: canReturn(context, peer) });
  context.whispers.handleDeparture(peer);
  peers.remove(peer);
  metrics.decrement(Metric.CONNECTIONS_ACTIVE);
  const room = rooms.find(peer.roomId);
  if (room && !isRoomInUse(context, room.id)) {
    rooms.markEmpty(room);
  }
}

export function acceptConnection(context, messaging, socket, request) {
  const { peers, rooms, connectionGuard, metrics, logger } = context;
  const address = context.readAddress(request);
  const session = findRoomSession(context, request);
  const room = rooms.find(session.roomId);
  const peer = peers.add({ socket, address, session });
  rooms.markOccupied(room);
  connectionGuard.track(address);
  messaging.heartbeat.watch(socket);
  metrics.increment(Metric.CONNECTIONS_ACTIVE);

  // Sin este listener, un mensaje que supere maxPayload terminaria todo el proceso.
  socket.on('error', (error) => logger.warn('connection.error', { peerId: peer.id, errorCode: error.code }));
  socket.on('close', () => releaseConnection(context, messaging, peer, address));
  socket.on('message', (data) => messaging.router.dispatch(peer, data));
  welcome(context, peer, room);
}
