import { once } from 'node:events';
import { WebSocket } from 'ws';
import { sessionCookieHeader } from './session-login.mjs';

const OPEN_TIMEOUT_MS = 10000;

// La app cierra una sala vacia a los pocos minutos y con ella revoca sus sesiones. Un
// escaneo completo dura mas, asi que se mantiene conectado al dueno de la sala (como un
// usuario con la pestana abierta) para que la sesion del escaneo siga valida.
export async function joinRoomSocket({ origin, ca, token }) {
  const socket = new WebSocket(origin.replace('https://', 'wss://'), {
    ca,
    headers: { Cookie: sessionCookieHeader(token) },
    handshakeTimeout: OPEN_TIMEOUT_MS,
  });
  socket.on('message', () => undefined);
  await once(socket, 'open');
  return socket;
}

export function leaveRoomSocket(socket) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }
}
