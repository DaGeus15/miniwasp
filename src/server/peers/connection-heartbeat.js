// Debe ser menor a los 100 segundos que Cloudflare tolera una conexion inactiva.
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;

// Mantiene abiertas las conexiones inactivas y cierra las que dejaron de responder,
// para que quien se fue sin avisar no quede como disponible para recibir llamadas.
export class ConnectionHeartbeat {
  #sockets;
  #intervalMs;
  #onBeat;
  #responsiveSockets = new WeakSet();
  #timer = null;

  constructor(sockets, { intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS, onBeat = () => {} } = {}) {
    this.#sockets = sockets;
    this.#intervalMs = intervalMs;
    this.#onBeat = onBeat;
  }

  watch(socket) {
    this.#responsiveSockets.add(socket);
    socket.on('pong', () => this.#responsiveSockets.add(socket));
  }

  start() {
    this.#timer = setInterval(() => this.beat(), this.#intervalMs);
    this.#timer.unref();
  }

  stop() {
    clearInterval(this.#timer);
  }

  beat() {
    for (const socket of this.#sockets) {
      if (this.#responsiveSockets.delete(socket)) {
        socket.ping();
      } else {
        socket.terminate();
      }
    }
    this.#onBeat();
  }
}
