import { isIP } from 'node:net';

// Cabeceras que un proxy de confianza escribe con la IP real y sobrescribe si el cliente
// la envia: Cloudflare (CF-Connecting-IP) y el borde de Railway (X-Real-IP). Nunca se usa
// X-Forwarded-For, cuyo primer elemento lo puede inventar el cliente.
const PROXY_HEADER_READERS = new Map([
  ['cf-connecting-ip', (request) => request.headers['cf-connecting-ip']],
  ['x-real-ip', (request) => request.headers['x-real-ip']],
]);

export const TRUSTED_PROXY_HEADERS = Object.freeze([...PROXY_HEADER_READERS.keys()]);

function readSocketAddress(request) {
  return request.socket.remoteAddress;
}

// Solo es seguro si el puerto no es accesible sin pasar por ese proxy: de lo contrario
// cualquiera podria falsificar la cabecera y evadir los limites. Un valor ausente o que
// no sea una IP valida se ignora y se usa la direccion del socket.
export function createAddressReader({ trustedProxyHeader = null } = {}) {
  const readForwardedAddress = PROXY_HEADER_READERS.get(trustedProxyHeader);
  if (!readForwardedAddress) {
    return readSocketAddress;
  }
  return (request) => {
    const forwardedAddress = readForwardedAddress(request);
    return isIP(forwardedAddress ?? '') ? forwardedAddress : readSocketAddress(request);
  };
}
