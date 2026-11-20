// Cliente WebSocket que habla el protocolo de MiniWasp como lo haria un navegador.
// Cada cliente tiene su propia cookie de sesion y su propia direccion de origen.
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';

const CONNECT_TIMEOUT_MS = 15000;
const DEFAULT_WAIT_MS = 10000;

export class SignalingClient extends EventEmitter {
  #url;
  #cookie;
  #origin;
  #localAddress;
  #socket = null;
  peerId = null;
  connectMs = null;
  rejectedStatus = null;
  serverErrors = [];
  unexpectedCloses = 0;
  #isClosing = false;

  constructor({ url, cookie, origin, localAddress }) {
    super();
    this.setMaxListeners(0);
    this.#url = url;
    this.#cookie = cookie;
    this.#origin = origin;
    this.#localAddress = localAddress;
  }

  get localAddress() {
    return this.#localAddress;
  }

  // Resuelve cuando llega welcome; rechaza si el servidor niega el handshake.
  connect() {
    const startedAt = performance.now();
    const welcome = this.waitFor((event) => event.type === 'welcome', CONNECT_TIMEOUT_MS);
    this.#socket = new WebSocket(this.#url, {
      headers: { Cookie: this.#cookie },
      origin: this.#origin,
      localAddress: this.#localAddress,
      rejectUnauthorized: false,
    });
    const failure = this.#watchHandshake();
    // La promesa que pierde la carrera no debe quedar como rechazo sin manejar.
    welcome.catch(() => {});
    failure.catch(() => {});
    return Promise.race([welcome, failure]).then(({ event }) => {
      this.peerId = event.peerId;
      this.connectMs = performance.now() - startedAt;
      return this;
    });
  }

  send(payload) {
    const sentAt = performance.now();
    this.#socket.send(JSON.stringify(payload));
    return sentAt;
  }

  // Registra la espera antes de enviar lo que la provoca para no perder el evento.
  waitFor(predicate, timeoutMs = DEFAULT_WAIT_MS) {
    return new Promise((resolve, reject) => {
      const onEvent = (event, receivedAt) => {
        if (predicate(event)) {
          clearTimeout(timer);
          this.off('event', onEvent);
          resolve({ event, receivedAt });
        }
      };
      const timer = setTimeout(() => {
        this.off('event', onEvent);
        reject(new Error(`Tiempo agotado esperando un evento en ${this.#localAddress}`));
      }, timeoutMs);
      this.on('event', onEvent);
    });
  }

  close() {
    this.#isClosing = true;
    const socket = this.#socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      socket.once('close', resolve);
      socket.close();
    });
  }

  #watchHandshake() {
    return new Promise((_resolve, reject) => {
      this.#socket.on('message', (data) => this.#dispatch(data));
      this.#socket.on('unexpected-response', (_request, response) => {
        this.rejectedStatus = response.statusCode;
        reject(new Error(`Handshake rechazado con ${response.statusCode}`));
      });
      this.#socket.on('error', (error) => reject(error));
      this.#socket.on('close', () => {
        if (!this.#isClosing && this.peerId) {
          this.unexpectedCloses += 1;
        }
      });
    });
  }

  #dispatch(data) {
    const receivedAt = performance.now();
    const event = JSON.parse(data.toString());
    if (event.type === 'error') {
      this.serverErrors.push(event.error);
    }
    this.emit('event', event, receivedAt);
  }
}
