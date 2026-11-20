import { isRoomInUse } from '../rooms/room-occupancy.js';
import { ApiAuthenticator } from './api-authenticator.js';
import { ApiRoomResolver } from './api-room-resolver.js';
import { ApiAttachmentsEndpoint } from './attachments-endpoint.js';
import { ApiAuthEndpoint } from './auth-endpoint.js';
import { MessagesEndpoint } from './messages-endpoint.js';
import { ApiPublicRoomsEndpoint } from './public-rooms-endpoint.js';
import { UsersEndpoint } from './users-endpoint.js';
import { VideoCallEndpoint } from './video-call-endpoint.js';

// Cerrar sesion libera el nombre, saca a la persona de su videollamada y cierra sus
// conexiones del navegador. Si la sala queda sin nadie, empieza su tiempo de gracia.
function endApiSession(context, session, room) {
  room.names.release(session.id);
  context.videoCalls.leaveAll(session.id);
  context.peers.closeSession(session.id);
  if (!isRoomInUse(context, room.id)) {
    context.rooms.markEmpty(room);
  }
}

// Los mismos limites por IP que usa el navegador para crear salas y entrar a ellas.
function createRoomResolver(context) {
  return new ApiRoomResolver({
    ...context,
    limiters: {
      create: context.roomCreationLimiter,
      createPublic: context.publicRoomCreationLimiter,
      join: context.roomJoinLimiter,
    },
  });
}

// Punto de composicion de la API REST (/api/v1). Devuelve rutas fijas y rutas con parametros
// para el HttpRouter. Comparte salas, sesiones y limites con la aplicacion del navegador.
// Los susurros no tienen rutas REST: necesitan dos conexiones WebSocket vivas.
export function createApiRoutes(context) {
  const shared = { ...context, authenticator: new ApiAuthenticator(context) };
  const auth = new ApiAuthEndpoint({
    ...shared,
    resolver: createRoomResolver(context),
    onLogout: (session, room) => endApiSession(context, session, room),
  });
  const users = new UsersEndpoint(shared);
  const videoCalls = new VideoCallEndpoint(shared);
  const messages = new MessagesEndpoint(shared);
  const attachments = new ApiAttachmentsEndpoint(shared);
  const publicRooms = new ApiPublicRoomsEndpoint(shared);
  return {
    routes: [
      ...auth.routes(),
      ...publicRooms.routes(),
      ...users.routes(),
      ...videoCalls.routes(),
      ...messages.routes(),
      ...attachments.routes(),
    ],
    patterns: [...videoCalls.patterns(), ...messages.patterns(), ...attachments.patterns()],
  };
}
