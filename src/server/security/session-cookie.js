const COOKIE_NAME = 'miniwasp_session';
// Secure siempre: los navegadores la aceptan en localhost, y fuera de esta maquina
// la app solo se publica con HTTPS.
const COOKIE_ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Strict';

function formatCookie(value, maxAgeSeconds) {
  return `${COOKIE_NAME}=${value}; ${COOKIE_ATTRIBUTES}; Max-Age=${maxAgeSeconds}`;
}

export function readSessionToken(request) {
  const prefix = `${COOKIE_NAME}=`;
  const cookie = request.headers.cookie
    ?.split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  return cookie?.slice(prefix.length) ?? null;
}

export function createSessionCookie(token, ttlMs) {
  return formatCookie(token, Math.floor(ttlMs / 1000));
}

export function createExpiredSessionCookie() {
  return formatCookie('', 0);
}
