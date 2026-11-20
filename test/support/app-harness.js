import { startChat } from '../../src/client/chat/chat-app.js';
import { FakeSocket } from './fake-socket.js';
import { FakePeerConnection, FakeStream } from './fake-webrtc.js';
import { createPage } from './page.js';

const SESSION_ACTIVE = 200;
const GRANTED = 204;

// Arranca la app completa en un DOM simulado, con el navegador reemplazado por fakes.
// Por defecto ya hay una sala activa, como cuando se recarga la pagina estando dentro.
export async function startTestApp({ savedName, sessionStatus = SESSION_ACTIVE, hash = '', rulesAccepted = true } = {}) {
  const window = createPage();
  const { document } = window;
  const sockets = [];
  const connections = [];
  const requests = [];
  const copied = [];
  const server = {
    sessionStatus,
    createStatus: GRANTED,
    joinStatus: GRANTED,
    upload: { status: 201, body: null },
    publicRooms: [],
    transferStatus: GRANTED,
  };
  const address = { hash, clearedHash: false };
  const localStream = new FakeStream();
  const saved = new Map([
    ...(savedName ? [['miniwasp-name', savedName]] : []),
    ...(rulesAccepted ? [['miniwasp-rules-accepted', 'si']] : []),
  ]);
  const storage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  // Cada ruta responde { status, body }: el estado y lo que devuelve response.json().
  const responseByRoute = new Map([
    ['GET /session', () => ({ status: server.sessionStatus })],
    ['DELETE /session', () => ({ status: GRANTED })],
    ['POST /rooms', () => ({ status: server.createStatus })],
    ['POST /rooms/join', () => ({ status: server.joinStatus })],
    ['POST /rooms/transfer', () => ({ status: server.transferStatus })],
    ['POST /rooms/attachments', () => server.upload],
    ['GET /rooms/public', () => ({ status: 200, body: { rooms: server.publicRooms } })],
  ]);
  const respond = (method, path) =>
    responseByRoute.get(`${method} ${path}`)?.() ?? { status: path.startsWith('/rooms/public/') ? server.joinStatus : 404 };

  await startChat({
    document,
    location: {
      protocol: 'http:',
      host: 'chat.test',
      origin: 'http://chat.test',
      readHash: () => address.hash,
      clearHash() {
        address.hash = '';
        address.clearedHash = true;
      },
    },
    createSocket(url) {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    schedule() {},
    getStorage: () => storage,
    getUserMedia: async () => localStream,
    createPeerConnection(configuration) {
      const connection = new FakePeerConnection(configuration);
      connections.push(connection);
      return connection;
    },
    async request(path, options = {}) {
      const method = options.method ?? 'GET';
      requests.push({ path, method, body: options.body, headers: options.headers });
      const { status, body = null } = respond(method, path);
      return { status, json: async () => body };
    },
    async copyText(text) {
      copied.push(text);
    },
  });

  return {
    window,
    document,
    sockets,
    get socket() {
      return sockets.at(-1);
    },
    connections,
    requests,
    copied,
    server,
    address,
    localStream,
    saved,
    nameInput: document.querySelector('#name'),
    textInput: document.querySelector('#text'),
    errorLabel: document.querySelector('#error'),
  };
}
