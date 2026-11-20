import { createChatServer } from '../../src/server/create-chat-server.js';
import { Logger } from '../../src/server/observability/logger.js';

export function createSilentLogger() {
  return new Logger({ write() {} });
}

export function createTestServer(options = {}) {
  return createChatServer({ logger: createSilentLogger(), ...options });
}

function readCookie(response) {
  return response.headers.get('set-cookie')?.split(';')[0] ?? null;
}

// Crea una sala como lo haria el navegador y devuelve la cookie de quien la creo.
export async function createRoomCookie(httpUrl, headers = {}) {
  const response = await fetch(`${httpUrl}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: httpUrl, ...headers },
    body: JSON.stringify({ acceptedRules: true }),
  });
  return readCookie(response);
}

export async function joinRoomCookie(httpUrl, inviteToken, headers = {}) {
  const response = await fetch(`${httpUrl}/rooms/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: httpUrl, ...headers },
    body: JSON.stringify({ inviteToken, acceptedRules: true }),
  });
  return readCookie(response);
}

// Servidor con una sala abierta. Cada llamada a memberCookie une a una persona distinta,
// con su propia sesion, como si abriera el enlace de invitacion en otro navegador.
export async function startRoomServer(options = {}) {
  const server = createTestServer(options);
  const port = await server.listen(0, '127.0.0.1');
  const httpUrl = `http://127.0.0.1:${port}`;
  const ownerCookie = await createRoomCookie(httpUrl);
  const { inviteToken } = await readRoomStatus(httpUrl, ownerCookie);
  return {
    server,
    httpUrl,
    wsUrl: `ws://127.0.0.1:${port}`,
    ownerCookie,
    inviteToken,
    memberCookie: () => joinRoomCookie(httpUrl, inviteToken),
  };
}

export async function readRoomStatus(httpUrl, cookie) {
  const response = await fetch(`${httpUrl}/session`, { headers: { Cookie: cookie } });
  return response.status === 200 ? response.json() : null;
}
