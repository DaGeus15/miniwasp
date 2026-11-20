export const DEFAULT_MAX_CONNECTIONS = 2000;
export const DEFAULT_MAX_CONNECTIONS_PER_ADDRESS = 30;

// Cada conexion ocupa memoria en el servidor: sin este tope, una sola maquina podria agotarla.
// El limite por direccion es holgado porque varias computadoras pueden compartir la misma IP.
export class ConnectionGuard {
  #maxConnections;
  #maxConnectionsPerAddress;
  #connectionsByAddress = new Map();
  #totalConnections = 0;

  constructor({
    maxConnections = DEFAULT_MAX_CONNECTIONS,
    maxConnectionsPerAddress = DEFAULT_MAX_CONNECTIONS_PER_ADDRESS,
  } = {}) {
    this.#maxConnections = maxConnections;
    this.#maxConnectionsPerAddress = maxConnectionsPerAddress;
  }

  admits(address) {
    return (
      this.#totalConnections < this.#maxConnections &&
      this.#countFor(address) < this.#maxConnectionsPerAddress
    );
  }

  track(address) {
    this.#totalConnections += 1;
    this.#connectionsByAddress.set(address, this.#countFor(address) + 1);
  }

  release(address) {
    this.#totalConnections -= 1;
    const remaining = this.#countFor(address) - 1;
    if (remaining > 0) {
      this.#connectionsByAddress.set(address, remaining);
    } else {
      this.#connectionsByAddress.delete(address);
    }
  }

  #countFor(address) {
    return this.#connectionsByAddress.get(address) ?? 0;
  }
}
