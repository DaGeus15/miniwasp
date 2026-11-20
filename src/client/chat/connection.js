const SOCKET_OPEN = 1;
const DEFAULT_BASE_DELAY_MS = 2000;
const DEFAULT_MAX_DELAY_MS = 30000;

export function reconnectDelay(attempt, baseDelayMs, maxDelayMs) {
  return Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
}

export function socketUrl({ protocol, host }) {
  const scheme = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${host}`;
}

// No deja de reintentar hasta que se detiene: asi el chat se recupera solo cuando el
// servidor vuelve. La espera crece hasta maxDelayMs para no saturar a nadie.
export class ServerConnection {
  #url;
  #createSocket;
  #schedule;
  #onData;
  #onStatus;
  #baseDelayMs;
  #maxDelayMs;
  #socket = null;
  #attempts = 0;
  #isStopped = false;

  constructor({
    url,
    createSocket,
    schedule,
    onData,
    onStatus,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
  }) {
    this.#url = url;
    this.#createSocket = createSocket;
    this.#schedule = schedule;
    this.#onData = onData;
    this.#onStatus = onStatus;
    this.#baseDelayMs = baseDelayMs;
    this.#maxDelayMs = maxDelayMs;
  }

  open() {
    this.#isStopped = false;
    this.#connect();
  }

  stop() {
    this.#isStopped = true;
    this.#socket?.close();
  }

  send(payload) {
    if (this.#socket?.readyState !== SOCKET_OPEN) {
      return false;
    }
    this.#socket.send(JSON.stringify(payload));
    return true;
  }

  #connect() {
    if (this.#isStopped) {
      return;
    }
    const socket = this.#createSocket(this.#url);
    this.#socket = socket;
    // Solo cuenta el socket actual. Al mudarse de sala (stop y open seguidos) el 'close' del
    // anterior llega despues, y atenderlo abriria una segunda conexion que duplica todo.
    const ifCurrent = (handler) => (event) => {
      if (socket === this.#socket) {
        handler(event);
      }
    };
    socket.addEventListener('open', ifCurrent(() => this.#handleOpen()));
    socket.addEventListener('message', ifCurrent((event) => this.#onData(event.data)));
    // El navegador emite 'close' tambien cuando falla la conexion inicial, despues de 'error'.
    socket.addEventListener('close', ifCurrent(() => this.#handleClose()));
  }

  #handleOpen() {
    this.#attempts = 0;
    this.#onStatus('online');
  }

  // Si se detuvo a proposito, no hay nada que avisar ni que reintentar.
  #handleClose() {
    if (this.#isStopped) {
      return;
    }
    this.#onStatus('reconnecting');
    const delayMs = reconnectDelay(this.#attempts, this.#baseDelayMs, this.#maxDelayMs);
    this.#schedule(() => this.#connect(), delayMs);
    this.#attempts += 1;
  }
}
