const JOIN_PREFIX = '#join=';
const INVITE_TOKEN_PATTERN = /^[\w-]{16,64}$/;

// La invitacion viaja en el fragmento (#join=...): el navegador nunca lo envia al
// servidor, asi que no queda en registros, proxies ni en el historial del servidor.
export function buildInviteLink(origin, inviteToken) {
  return `${origin}/${JOIN_PREFIX}${inviteToken}`;
}

export function readInviteFromHash(hash) {
  if (!hash?.startsWith(JOIN_PREFIX)) {
    return null;
  }
  const inviteToken = hash.slice(JOIN_PREFIX.length);
  return INVITE_TOKEN_PATTERN.test(inviteToken) ? inviteToken : null;
}

// Acepta el ID solo o el enlace completo pegado tal cual.
export function parseInviteInput(text) {
  const trimmed = text.trim();
  const hashStart = trimmed.indexOf('#');
  const candidate = hashStart === -1 ? trimmed : readInviteFromHash(trimmed.slice(hashStart));
  return candidate && INVITE_TOKEN_PATTERN.test(candidate) ? candidate : null;
}
