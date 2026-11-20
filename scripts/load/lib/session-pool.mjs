// Inicia una sesion por usuario simulado con POST /session, igual que el navegador.
// El servidor permite 6 intentos de acceso por minuto e IP: cada direccion de origen
// del pool hace como maximo LOGINS_PER_ADDRESS intentos.
import { request } from 'node:https';

export const LOGINS_PER_ADDRESS = 4;
const LOGIN_CONCURRENCY = 16;
const LOGIN_ADDRESS_THIRD_OCTET = 0;
const FIRST_HOST_OCTET = 10;

export function loopbackAddress(thirdOctet, index) {
  return `127.0.${thirdOctet}.${FIRST_HOST_OCTET + index}`;
}

function postSession({ baseUrl, accessCode, localAddress }) {
  const body = JSON.stringify({ accessCode });
  const url = new URL('/session', baseUrl);
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      method: 'POST',
      localAddress,
      rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Origin: url.origin },
    });
    outgoing.on('response', (response) => {
      response.resume();
      const [cookie] = response.headers['set-cookie'] ?? [];
      resolve({ status: response.statusCode, cookie: cookie?.split(';')[0] ?? null });
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

async function loginBatch(options, indexes) {
  return Promise.all(
    indexes.map(async (index) => {
      const localAddress = loopbackAddress(LOGIN_ADDRESS_THIRD_OCTET, Math.floor(index / LOGINS_PER_ADDRESS));
      const result = await postSession({ ...options, localAddress });
      if (result.status !== 204 || !result.cookie) {
        throw new Error(`Login ${index} desde ${localAddress} respondio ${result.status}`);
      }
      return result.cookie;
    }),
  );
}

export async function createSessions({ baseUrl, accessCode, count }) {
  const cookies = [];
  for (let start = 0; start < count; start += LOGIN_CONCURRENCY) {
    const indexes = Array.from({ length: Math.min(LOGIN_CONCURRENCY, count - start) }, (_, offset) => start + offset);
    cookies.push(...(await loginBatch({ baseUrl, accessCode }, indexes)));
  }
  return cookies;
}

// GET autenticado (por ejemplo /metrics) con la cookie de una sesion de observacion.
export function getJson({ baseUrl, path, cookie }) {
  return new Promise((resolve, reject) => {
    const outgoing = request(new URL(path, baseUrl), { rejectUnauthorized: false, headers: { Cookie: cookie } });
    outgoing.on('response', (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        text += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text || 'null') }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}
