// Servidores ICE para una llamada. Con solo STUN se conectan aparatos de la misma red o
// detras de NAT sencillos; entre un celular con datos moviles y una PC en wifi suele hacer
// falta TURN, que retransmite el audio y el video (siguen cifrados de punta a punta con DTLS-SRTP).
const CLOUDFLARE_TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
// Corta a proposito: una credencial robada sirve poco tiempo. El navegador pide credenciales
// nuevas antes de que venzan si la llamada sigue (al vencer, Cloudflare corta la retransmision).
export const DEFAULT_TURN_TTL_SECONDS = 60 * 60;
const DEFAULT_TIMEOUT_MS = 5000;
const ICE_SCHEMES = new Set(['stun', 'turn', 'turns']);
const TRANSPORT_QUERIES = new Set(['', '?transport=udp', '?transport=tcp']);
const HOST_PATTERN = /^[\w.-]+$/;
const PORT_PATTERN = /^\d{1,5}$/;
// Los navegadores bloquean el puerto 53: esa ruta solo haria esperar a la negociacion.
const BLOCKED_PORT = '53';
const MAX_CREDENTIAL_LENGTH = 512;

function isUsablePort(port) {
  return port === undefined || (PORT_PATTERN.test(port) && port !== BLOCKED_PORT);
}

// esquema:host[:puerto][?transport=udp|tcp], sin nada mas.
function isUsableUrl(url) {
  if (typeof url !== 'string') {
    return false;
  }
  const queryStart = url.includes('?') ? url.indexOf('?') : url.length;
  const [scheme, host, port, ...rest] = url.slice(0, queryStart).split(':');
  return (
    ICE_SCHEMES.has(scheme) &&
    HOST_PATTERN.test(host ?? '') &&
    isUsablePort(port) &&
    rest.length === 0 &&
    TRANSPORT_QUERIES.has(url.slice(queryStart))
  );
}

function isBoundedText(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_CREDENTIAL_LENGTH;
}

// Solo pasa al navegador lo que reconoce: URLs validas y, si las hay, usuario y clave.
function sanitizeIceServer(entry) {
  const urls = [entry?.urls].flat().filter(isUsableUrl);
  if (urls.length === 0) {
    return null;
  }
  const { username, credential } = entry;
  const hasCredentials = isBoundedText(username) && isBoundedText(credential);
  return hasCredentials ? { urls, username, credential } : { urls };
}

export function sanitizeIceServers(entries) {
  return Array.isArray(entries) ? entries.map(sanitizeIceServer).filter(Boolean) : [];
}

// Sin clave TURN: siempre los mismos servidores STUN de la configuracion.
export class StaticIceServers {
  #iceServers;

  constructor(iceServers) {
    this.#iceServers = iceServers;
  }

  async forCall() {
    return this.#iceServers;
  }
}

// Pide a Cloudflare credenciales TURN de corta duracion para cada llamada. La clave de la
// API nunca sale del servidor. Si Cloudflare no responde, la llamada sigue con STUN.
export class CloudflareTurnServers {
  #endpoint;
  #apiToken;
  #fallback;
  #fetch;
  #ttlSeconds;
  #timeoutMs;
  #logger;

  constructor({
    keyId,
    apiToken,
    fallback,
    logger,
    fetch = globalThis.fetch,
    ttlSeconds = DEFAULT_TURN_TTL_SECONDS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }) {
    this.#endpoint = `${CLOUDFLARE_TURN_API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;
    this.#apiToken = apiToken;
    this.#fallback = fallback;
    this.#fetch = fetch;
    this.#ttlSeconds = ttlSeconds;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  async forCall() {
    try {
      const iceServers = sanitizeIceServers((await this.#request()).iceServers);
      if (iceServers.length === 0) {
        throw new Error('respuesta sin servidores ICE');
      }
      return iceServers;
    } catch (error) {
      this.#logger.warn('turn.credentials_failed', { reason: error.message });
      return this.#fallback;
    }
  }

  async #request() {
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: this.#ttlSeconds }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Cloudflare respondio ${response.status}`);
    }
    return response.json();
  }
}
