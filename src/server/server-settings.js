import { VideoCallRegistry } from './api/video-call-registry.js';
import { MemoryBlobStorage } from './attachments/memory-blob-storage.js';
import { ImageInspector } from './moderation/image-inspector.js';
import { StrikeTracker } from './moderation/strike-tracker.js';
import { TextModerator } from './moderation/text-moderator.js';
import { Logger } from './observability/logger.js';
import { Metrics } from './observability/metrics.js';
import { ConnectionGuard } from './security/connection-guard.js';
import { createRateLimiter } from './security/rate-limiter.js';
import { SessionStore } from './security/session-store.js';

// Los limites son por IP y varias computadoras pueden compartir una. Una sola negociacion
// envia decenas de candidatos ICE en pocos segundos, y perder uno puede arruinar la llamada.
const SIGNAL_RATE = { limit: 300, windowMs: 10000 };
const INVITE_RATE = { limit: 20, windowMs: 30000 };
const ROOM_CREATION_RATE = { limit: 10, windowMs: 10 * 60 * 1000 };
const ROOM_JOIN_RATE = { limit: 30, windowMs: 60000 };
// Cada cambio de nombre se difunde a toda la sala: su propio limite acota la amplificacion.
const PRESENCE_RATE = { limit: 10, windowMs: 10000 };
// Subir archivos y reportar mensajes tienen sus propios limites, separados del chat.
const ATTACHMENT_RATE = { limit: 30, windowMs: 60000 };
const REPORT_RATE = { limit: 10, windowMs: 60000 };
// Las salas publicas se ven en la portada: crearlas tiene un limite mas estricto.
const PUBLIC_ROOM_CREATION_RATE = { limit: 3, windowMs: 10 * 60 * 1000 };
const PUBLIC_LIST_RATE = { limit: 60, windowMs: 60000 };
const WHISPER_INVITE_RATE = { limit: 5, windowMs: 60000 };
// Tope de personas por sala: acota cuanto trafico genera cada difusion.
export const DEFAULT_MAX_ROOM_MEMBERS = 20;

// Valores por defecto del servidor. Cualquier pieza puede reemplazarse (por ejemplo, en pruebas).
export function withDefaults(options = {}) {
  return {
    sessions: new SessionStore({ maxSessions: options.maxSessions }),
    chatLimiter: createRateLimiter(),
    signalLimiter: createRateLimiter(SIGNAL_RATE),
    inviteLimiter: createRateLimiter(INVITE_RATE),
    roomCreationLimiter: createRateLimiter(ROOM_CREATION_RATE),
    roomJoinLimiter: createRateLimiter(ROOM_JOIN_RATE),
    presenceLimiter: createRateLimiter(PRESENCE_RATE),
    attachmentLimiter: createRateLimiter(ATTACHMENT_RATE),
    reportLimiter: createRateLimiter(REPORT_RATE),
    publicRoomCreationLimiter: createRateLimiter(PUBLIC_ROOM_CREATION_RATE),
    publicListLimiter: createRateLimiter(PUBLIC_LIST_RATE),
    whisperLimiter: createRateLimiter(WHISPER_INVITE_RATE),
    maxRoomMembers: DEFAULT_MAX_ROOM_MEMBERS,
    connectionGuard: new ConnectionGuard({ maxConnections: options.maxConnections }),
    logger: new Logger(),
    metrics: new Metrics(),
    videoCalls: new VideoCallRegistry(),
    // Sin bucket configurado, los archivos quedan en memoria (solo desarrollo y pruebas).
    blobStorage: new MemoryBlobStorage(),
    textModerator: new TextModerator(),
    strikes: new StrikeTracker(),
    // El analisis de imagenes arranca sus hilos solo cuando llega la primera imagen.
    imageInspector: new ImageInspector({ workers: options.imageModerationWorkers }),
    iceServers: [],
    trustedProxyHeader: null,
    tls: null,
    ...options,
  };
}
