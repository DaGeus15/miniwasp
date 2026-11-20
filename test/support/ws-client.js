import { once } from 'node:events';
import { WebSocket } from 'ws';
import { ServerEvent } from '../../src/shared/events.js';

// Las colas se crean antes de abrir el socket: el historial llega apenas conecta.
// Por defecto se descartan los eventos de sesion y presencia, que no son el objeto de
// la mayoria de las pruebas; las que los verifican piden explicitamente recibirlos.
const DEFAULT_IGNORED_EVENTS = [ServerEvent.WELCOME, ServerEvent.PRESENCE];

export function openClient(url, { ignoredEvents = DEFAULT_IGNORED_EVENTS, ...options } = {}) {
  const socket = new WebSocket(url, options);
  const received = [];
  const waiting = [];

  socket.on('message', (data) => {
    const payload = JSON.parse(data.toString());
    if (ignoredEvents.includes(payload.type)) {
      return;
    }
    const resolve = waiting.shift();
    if (resolve) {
      resolve(payload);
    } else {
      received.push(payload);
    }
  });

  const next = () =>
    new Promise((resolve) => {
      if (received.length > 0) {
        resolve(received.shift());
      } else {
        waiting.push(resolve);
      }
    });

  const send = (payload) => socket.send(JSON.stringify(payload));

  return { socket, next, send, opened: once(socket, 'open') };
}

export async function startServer(server) {
  return server.listen(0, '127.0.0.1');
}

export async function stopServer(server) {
  await server.close();
}

export async function expectSilence(client, windowMs = 100) {
  const silence = Symbol('sin mensaje');
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(silence), windowMs);
  });
  return (await Promise.race([client.next(), timeout])) === silence;
}

export async function expectRejection(socket) {
  const [error] = await once(socket, 'error').catch((failure) => [failure]);
  return error.message;
}
