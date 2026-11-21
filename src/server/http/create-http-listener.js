import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { join } from 'node:path';
import { createApiRoutes } from '../api/create-api-routes.js';
import { AttachmentEndpoint } from './attachment-endpoint.js';
import { HttpRouter } from './http-router.js';
import { IceServersEndpoint } from './ice-servers-endpoint.js';
import { PublicRoomsEndpoint } from './public-rooms-endpoint.js';
import { PUBLIC_ASSETS } from './public-assets.js';
import { RoomEndpoint } from './room-endpoint.js';
import { StaticAssetHandler } from './static-asset-handler.js';
import { TransferEndpoint } from './transfer-endpoint.js';

const SOURCE_DIRECTORY = join(import.meta.dirname, '..', '..');
// Una conexion HTTP lenta no debe quedar abierta indefinidamente.
const HTTP_TIMEOUTS = { headersTimeout: 10000, requestTimeout: 15000, keepAliveTimeout: 5000 };
const MAX_HTTP_CONNECTIONS = 1000;

function createRoomEndpoints(context) {
  const roomEndpoint = new RoomEndpoint({
    ...context,
    limiters: {
      create: context.roomCreationLimiter,
      createPublic: context.publicRoomCreationLimiter,
      join: context.roomJoinLimiter,
    },
  });
  const publicRoomsEndpoint = new PublicRoomsEndpoint({
    ...context,
    limiters: { list: context.publicListLimiter, join: context.roomJoinLimiter },
  });
  return { roomEndpoint, publicRoomsEndpoint };
}

// Rutas que solo atienden a quien ya esta en una sala.
function createMemberEndpoints(context, requireSession) {
  return {
    attachmentEndpoint: new AttachmentEndpoint({ ...context, requireSession }),
    transferEndpoint: new TransferEndpoint({ ...context, requireSession }),
    iceServersEndpoint: new IceServersEndpoint({
      ...context,
      requireSession,
      limiters: { address: context.iceServerLimiter, session: context.iceServerSessionLimiter },
    }),
  };
}

function createHttpRouter(context) {
  const { responder, logger, metrics } = context;
  const { roomEndpoint, publicRoomsEndpoint } = createRoomEndpoints(context);
  const requireSession = (request) => roomEndpoint.requireSession(request);
  const { attachmentEndpoint, transferEndpoint, iceServersEndpoint } = createMemberEndpoints(context, requireSession);
  const assets = new StaticAssetHandler({ rootDirectory: SOURCE_DIRECTORY, assets: PUBLIC_ASSETS, responder });
  const api = createApiRoutes(context);
  const readMetrics = (request, response) => {
    requireSession(request);
    responder.json(response, 200, metrics.snapshot());
  };

  return new HttpRouter({
    routes: new Map([
      ...roomEndpoint.routes(),
      ...attachmentEndpoint.routes(),
      ...publicRoomsEndpoint.routes(),
      ...transferEndpoint.routes(),
      ...iceServersEndpoint.routes(),
      ['/healthz', { GET: (_request, response) => responder.json(response, 200, { status: 'ok' }) }],
      ['/metrics', { GET: readMetrics }],
      ...api.routes,
    ]),
    patterns: [...attachmentEndpoint.patterns(), ...publicRoomsEndpoint.patterns(), ...api.patterns],
    fallback: (request, response, pathname) => assets.handle(request, response, pathname),
    responder,
    logger,
    metrics,
  });
}

// Servidor HTTP (o HTTPS si hay certificado) con todas las rutas y tiempos limite.
export function createHttpListener(context) {
  const router = createHttpRouter(context);
  const handleRequest = (request, response) => router.handle(request, response);
  const listener = context.tls ? createHttpsServer(context.tls, handleRequest) : createHttpServer(handleRequest);
  Object.assign(listener, HTTP_TIMEOUTS, { maxConnections: MAX_HTTP_CONNECTIONS });
  return listener;
}
