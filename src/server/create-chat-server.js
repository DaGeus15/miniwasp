import { WebSocketServer } from 'ws';
import { AttachmentStore } from './attachments/attachment-store.js';
import { AttachmentUploader } from './attachments/attachment-uploader.js';
import { UploadGate } from './attachments/upload-gate.js';
import { CallCoordinator } from './calls/call-coordinator.js';
import { ChatServer } from './chat-server.js';
import { createHttpListener } from './http/create-http-listener.js';
import { HttpResponder } from './http/http-responder.js';
import { RoomSessionIssuer } from './http/room-session-issuer.js';
import { createHandshakeHeaders, createSecurityHeaders } from './http/security-headers.js';
import { MessageRouter } from './messaging/message-router.js';
import { RoomMessenger } from './messaging/room-messenger.js';
import { createCallRoutes, createRoomRoutes, createWhisperRoutes } from './messaging/routes.js';
import { ContentGate } from './moderation/content-gate.js';
import { createClientReferencer } from './observability/client-reference.js';
import { Metric } from './observability/metrics.js';
import { ConnectionHeartbeat } from './peers/connection-heartbeat.js';
import { PeerRegistry } from './peers/peer-registry.js';
import { acceptConnection, createHandshakeVerifier } from './peers/socket-lifecycle.js';
import { isRoomInUse } from './rooms/room-occupancy.js';
import { removeMember } from './rooms/room-membership.js';
import { Room } from './rooms/room.js';
import { PublicRoomDirectory } from './rooms/public-room-directory.js';
import { RoomRegistry } from './rooms/room-registry.js';
import { TransferTokens } from './rooms/transfer-tokens.js';
import { createAddressReader } from './security/client-address.js';
import { withDefaults } from './server-settings.js';
import { WhisperCoordinator } from './whispers/whisper-coordinator.js';

// Confiar en un proxy implica que este termina HTTPS delante de la app.
function isServedOverHttps({ tls, trustedProxyHeader }) {
  return Boolean(tls) || Boolean(trustedProxyHeader);
}

// Debe superar MAX_SDP_LENGTH: una oferta WebRTC es mucho mas grande que un mensaje de chat.
const MAX_PAYLOAD_BYTES = 32768;

// Al cerrarse una sala se borran su historial, sus archivos (y la clave que los descifra),
// sus sesiones y sus conexiones.
function createRooms(settings, { peers, attachments, publicRooms }) {
  return new RoomRegistry({
    emptyRoomTtlMs: settings.emptyRoomTtlMs,
    maxRooms: settings.maxRooms,
    createRoom:
      settings.createRoom ??
      ((options) =>
        new Room({ ...options, onMessageRemoved: (message) => message.attachment && attachments.delete(message.attachment.id) })),
    onRoomClosed(room) {
      publicRooms.remove(room);
      settings.sessions.revokeWhere((session) => session.roomId === room.id);
      settings.videoCalls.closeRoom(room.id);
      peers.closeRoom(room.id);
      attachments.deleteRoom(room.id);
      room.cipher.destroy();
      settings.metrics.increment(Metric.ROOMS_CLOSED);
      settings.logger.info('room.closed', { roomId: room.id });
    },
  });
}

// Moderacion, adjuntos y mensajeria: los servicios que comparten el navegador y la API.
function createServices(context) {
  const { logger, metrics } = context;
  const contentGate = new ContentGate({
    ...context,
    onExpel: (session) => removeMember(context, session.roomId, session.id),
  });
  const attachmentUploader = new AttachmentUploader({
    store: context.attachments,
    contentGate,
    uploadGate: new UploadGate({ maxConcurrent: context.uploadConcurrency }),
  });
  const messenger = new RoomMessenger({ ...context, contentGate, logger, metrics });
  const whispers = new WhisperCoordinator({ ...context, directory: context.peers, timeoutMs: context.whisperTimeoutMs });
  return { contentGate, attachmentUploader, messenger, whispers };
}

// Al terminar una sesion se libera todo lo que se recordaba de ella.
function forgetSession(context, session) {
  context.rooms.find(session.roomId)?.names.release(session.id);
  context.contentGate.forget(session.id);
  context.messenger.forgetSession(session.id);
  context.whispers.forgetSession(session.id);
  context.peers.closeSession(session.id);
}

function createContext(settings) {
  const peers = new PeerRegistry();
  const attachments = settings.attachments ?? new AttachmentStore({ storage: settings.blobStorage, logger: settings.logger });
  const publicRooms = new PublicRoomDirectory({
    countMembers: (roomId) => peers.countSessions(roomId),
    maxRoomMembers: settings.maxRoomMembers,
    maxRooms: settings.maxPublicRooms,
  });
  const context = {
    ...settings,
    peers,
    attachments,
    publicRooms,
    transferTokens: new TransferTokens(),
    rooms: createRooms(settings, { peers, attachments, publicRooms }),
    readAddress: createAddressReader(settings),
    referenceClient: createClientReferencer(),
    responder: new HttpResponder(
      createSecurityHeaders({ isHttps: isServedOverHttps(settings) }),
    ),
    onSessionRevoked: (session) => forgetSession(context, session),
  };
  context.sessionIssuer = new RoomSessionIssuer(context);
  return Object.assign(context, createServices(context));
}

function createMessageRouter(context) {
  const { peers, logger, metrics } = context;
  const calls = new CallCoordinator({ directory: peers, logger, metrics, ringTimeoutMs: context.ringTimeoutMs });
  const router = new MessageRouter({
    routes: new Map([
      ...createRoomRoutes(context),
      ...createWhisperRoutes(context),
      ...createCallRoutes({ calls, ...context }),
    ]),
    fallbackLimiter: context.chatLimiter,
    logger,
    metrics,
  });
  return { calls, router };
}

// Punto de composicion del servidor: aqui se conectan las piezas y no hay reglas de negocio.
export function createChatServer(options) {
  const context = createContext(withDefaults(options));
  const listener = createHttpListener(context);
  const sockets = new WebSocketServer({
    server: listener,
    maxPayload: MAX_PAYLOAD_BYTES,
    verifyClient: createHandshakeVerifier(context),
  });
  const handshakeHeaders = createHandshakeHeaders({ isHttps: isServedOverHttps(context) });
  sockets.on('headers', (headers) => headers.push(...handshakeHeaders));
  const heartbeat = new ConnectionHeartbeat(sockets.clients, {
    intervalMs: context.heartbeatIntervalMs,
    onBeat() {
      context.peers.closeInactiveSessions((id) => context.sessions.isActive(id));
      context.rooms.sweep((roomId) => isRoomInUse(context, roomId));
    },
  });
  const messaging = { ...createMessageRouter(context), heartbeat };
  sockets.on('connection', (socket, request) => acceptConnection(context, messaging, socket, request));

  return new ChatServer({ listener, sockets, heartbeat, onClose: () => context.imageInspector.close() });
}
