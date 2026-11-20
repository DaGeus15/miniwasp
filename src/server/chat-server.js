import { once } from 'node:events';

const GOING_AWAY_CLOSE_CODE = 1001;

// Un servidor en ejecucion: expone solo lo necesario para arrancarlo y detenerlo.
export class ChatServer {
  #listener;
  #sockets;
  #heartbeat;
  #onClose;

  constructor({ listener, sockets, heartbeat, onClose = async () => {} }) {
    this.#listener = listener;
    this.#sockets = sockets;
    this.#heartbeat = heartbeat;
    this.#onClose = onClose;
  }

  get listener() {
    return this.#listener;
  }

  async listen(port, host) {
    this.#listener.listen(port, host);
    await once(this.#listener, 'listening');
    this.#heartbeat.start();
    return this.#listener.address().port;
  }

  // Avisa a los clientes para que reconecten y espera a que terminen las peticiones.
  async close() {
    this.#heartbeat.stop();
    for (const socket of this.#sockets.clients) {
      socket.close(GOING_AWAY_CLOSE_CODE);
    }
    this.#listener.close();
    await Promise.all([once(this.#listener, 'close'), this.#onClose()]);
  }
}
