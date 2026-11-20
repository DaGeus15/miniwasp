// Lee el heap de V8 del servidor por el protocolo del inspector de Node (--inspect en
// 127.0.0.1 y puerto aleatorio, solo durante la prueba). Fuerza una recoleccion de basura
// antes de medir para distinguir una fuga real de memoria que el GC aun no recupero.
import WebSocket from 'ws';

const BYTES_PER_MIB = 1024 ** 2;
const COMMAND_TIMEOUT_MS = 15000;

function toMiB(bytes) {
  return Number((bytes / BYTES_PER_MIB).toFixed(2));
}

export class HeapInspector {
  #socket;
  #nextId = 1;
  #pending = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.on('message', (data) => this.#resolve(JSON.parse(data.toString())));
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return new HeapInspector(socket);
  }

  async measureAfterGc() {
    await this.#command('HeapProfiler.collectGarbage');
    const { usedSize, totalSize } = await this.#command('Runtime.getHeapUsage');
    return { heapUsedMiB: toMiB(usedSize), heapTotalMiB: toMiB(totalSize) };
  }

  close() {
    this.#socket.close();
  }

  #command(method) {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} sin respuesta`)), COMMAND_TIMEOUT_MS);
      this.#pending.set(id, (message) => {
        clearTimeout(timer);
        return message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      });
      this.#socket.send(JSON.stringify({ id, method }));
    });
  }

  #resolve(message) {
    const settle = this.#pending.get(message.id);
    if (settle) {
      this.#pending.delete(message.id);
      settle(message);
    }
  }
}
