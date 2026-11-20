import { requestJson } from './https-client.mjs';

const SESSION_COOKIE_NAME = 'miniwasp_session';
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;

function extractToken(setCookieHeaders = []) {
  const prefix = `${SESSION_COOKIE_NAME}=`;
  const cookie = setCookieHeaders.find((header) => header.startsWith(prefix));
  const token = cookie?.slice(prefix.length).split(';')[0];
  if (!token) {
    throw new Error('La creacion de la sala no devolvio la cookie de sesion');
  }
  return token;
}

export function sessionCookieHeader(token) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

// Crea una sala como lo haria el navegador (POST /rooms con el mismo Origin) y devuelve el
// token de la cookie HttpOnly. El token nunca se imprime: a ZAP llega por variable de entorno.
export async function createRoomAndGetToken(client, { origin }) {
  const response = await client('/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ acceptedRules: true }),
  });
  if (response.status !== HTTP_NO_CONTENT) {
    throw new Error(`No se pudo crear la sala: HTTP ${response.status}`);
  }
  return extractToken(response.headers['set-cookie']);
}

// Comprueba que la cookie abre las rutas protegidas y devuelve la invitacion de la sala.
export async function readRoomInvite(client, token) {
  const headers = { Cookie: sessionCookieHeader(token) };
  await requestJson(client, '/metrics', { headers }, HTTP_OK);
  const { inviteToken } = await requestJson(client, '/session', { headers }, HTTP_OK);
  return inviteToken;
}
