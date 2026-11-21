import { readFileSync } from 'node:fs';
import { TRUSTED_PROXY_HEADERS } from './security/client-address.js';

const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
const LOOPBACK_HOST = '127.0.0.1';
// Sin STUN solo se conectan computadoras de la misma red. El servidor STUN solo ve la IP
// publica de quien hace una llamada; nunca recibe audio ni video.
const DEFAULT_STUN_URLS = 'stun:stun.cloudflare.com:3478';
const STUN_SCHEMES = new Set(['stun', 'stuns']);
const HOST_PATTERN = /^[\w.-]+$/;
const PORT_PATTERN = /^\d{1,5}$/;

function isValidStunUrl(url) {
  const [scheme, host, port, ...rest] = url.split(':');
  return (
    STUN_SCHEMES.has(scheme) &&
    HOST_PATTERN.test(host ?? '') &&
    (port === undefined || PORT_PATTERN.test(port)) &&
    rest.length === 0
  );
}

function parsePort(rawPort = String(DEFAULT_PORT)) {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new Error('PORT debe ser un numero de puerto valido');
  }
  return port;
}

function parseIceServers(stunUrls = DEFAULT_STUN_URLS) {
  const urls = stunUrls
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  const invalidUrl = urls.find((url) => !isValidStunUrl(url));
  if (invalidUrl) {
    throw new Error(`STUN_URLS contiene una URL no valida: ${invalidUrl}`);
  }
  return urls.map((url) => ({ urls: url }));
}

function loadTlsCredentials({ TLS_CERT_FILE: certFile, TLS_KEY_FILE: keyFile }, readFile) {
  if (!certFile && !keyFile) {
    return null;
  }
  if (!certFile || !keyFile) {
    throw new Error('TLS_CERT_FILE y TLS_KEY_FILE deben configurarse juntos');
  }
  return { cert: readFile(certFile), key: readFile(keyFile) };
}

function parseTrustedProxyHeader(rawHeader) {
  if (!rawHeader) {
    return null;
  }
  const header = rawHeader.toLowerCase();
  if (!TRUSTED_PROXY_HEADERS.includes(header)) {
    throw new Error(`TRUSTED_PROXY_HEADER debe ser uno de: ${TRUSTED_PROXY_HEADERS.join(', ')}`);
  }
  return header;
}

function parsePositiveInteger(name, rawValue) {
  if (rawValue === undefined || rawValue === '') {
    return undefined;
  }
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} debe ser un entero positivo`);
  }
  return value;
}

// Topes de capacidad. Sin variable, cada pieza usa su valor por defecto.
function loadCapacity(env) {
  const capacity = {
    maxConnections: parsePositiveInteger('MAX_CONNECTIONS', env.MAX_CONNECTIONS),
    maxSessions: parsePositiveInteger('MAX_SESSIONS', env.MAX_SESSIONS),
    maxRooms: parsePositiveInteger('MAX_ROOMS', env.MAX_ROOMS),
    uploadConcurrency: parsePositiveInteger('UPLOAD_CONCURRENCY', env.UPLOAD_CONCURRENCY),
    imageModerationWorkers: parsePositiveInteger('IMAGE_MODERATION_WORKERS', env.IMAGE_MODERATION_WORKERS),
  };
  return Object.fromEntries(Object.entries(capacity).filter(([, value]) => value !== undefined));
}

const OBJECT_STORAGE_VARIABLES = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];

function requireHttpsEndpoint(rawEndpoint) {
  if (!URL.canParse(rawEndpoint) || new URL(rawEndpoint).protocol !== 'https:') {
    throw new Error('S3_ENDPOINT debe ser una URL https');
  }
  return rawEndpoint;
}

// Bucket donde se guardan los archivos cifrados. En produccion es obligatorio: los archivos
// nunca deben caer en silencio a la memoria del servidor.
function loadObjectStorage(env) {
  const required = [env.S3_ENDPOINT, env.S3_BUCKET, env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY];
  const configured = required.filter(Boolean);
  if (configured.length === 0) {
    if (env.NODE_ENV === 'production') {
      throw new Error(`En producción se necesita un bucket: configura ${OBJECT_STORAGE_VARIABLES.join(', ')}`);
    }
    return null;
  }
  if (configured.length < OBJECT_STORAGE_VARIABLES.length) {
    throw new Error(`Configura juntas las variables del bucket: ${OBJECT_STORAGE_VARIABLES.join(', ')}`);
  }
  return {
    endpoint: requireHttpsEndpoint(env.S3_ENDPOINT),
    bucket: env.S3_BUCKET,
    region: env.S3_REGION || 'auto',
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
  };
}

const TURN_VARIABLES = ['TURN_KEY_ID', 'TURN_KEY_API_TOKEN'];
const TURN_KEY_ID_PATTERN = /^[\w-]{1,128}$/;

// Clave TURN de Cloudflare Realtime (opcional). Sin ella las llamadas usan solo STUN.
function loadTurnKey({ TURN_KEY_ID: keyId, TURN_KEY_API_TOKEN: apiToken }) {
  if (!keyId && !apiToken) {
    return null;
  }
  if (!keyId || !apiToken) {
    throw new Error(`Configura juntas las variables de TURN: ${TURN_VARIABLES.join(', ')}`);
  }
  if (!TURN_KEY_ID_PATTERN.test(keyId)) {
    throw new Error('TURN_KEY_ID no es un identificador valido');
  }
  return { keyId, apiToken };
}

// Falla al arrancar: una configuracion invalida no debe descubrirse durante una llamada.
// Siempre se escucha solo en esta maquina salvo que HOST lo indique de forma explicita.
export function loadConfig(env = process.env, readFile = readFileSync) {
  return {
    port: parsePort(env.PORT),
    host: env.HOST ?? LOOPBACK_HOST,
    tls: loadTlsCredentials(env, readFile),
    iceServers: parseIceServers(env.STUN_URLS),
    turnKey: loadTurnKey(env),
    trustedProxyHeader: parseTrustedProxyHeader(env.TRUSTED_PROXY_HEADER),
    objectStorage: loadObjectStorage(env),
    ...loadCapacity(env),
  };
}
