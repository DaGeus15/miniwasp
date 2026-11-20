const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const BASE_HEADERS = Object.freeze({
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  // Aislamiento entre origenes (defensa frente a Spectre): todos los recursos son propios.
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});

const STRICT_TRANSPORT_SECURITY = 'max-age=31536000';

export function createSecurityHeaders({ isHttps }) {
  return isHttps
    ? { ...BASE_HEADERS, 'Strict-Transport-Security': STRICT_TRANSPORT_SECURITY }
    : { ...BASE_HEADERS };
}
