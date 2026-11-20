const DEFAULT_MESSAGE_LIMIT = 10;
const DEFAULT_WINDOW_MS = 5000;

export function createRateLimiter({
  limit = DEFAULT_MESSAGE_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
  now = Date.now,
} = {}) {
  const windows = new Map();

  function removeExpired(time) {
    for (const [key, window] of windows) {
      if (time >= window.resetAt) {
        windows.delete(key);
      }
    }
  }

  return {
    allow(key) {
      const time = now();
      const current = windows.get(key);

      if (current && time < current.resetAt) {
        current.count += 1;
        return current.count <= limit;
      }

      // Limpiar aqui evita que el mapa crezca sin fin con clientes que ya no estan.
      removeExpired(time);
      windows.set(key, { count: 1, resetAt: time + windowMs });
      return true;
    },

    get trackedClients() {
      return windows.size;
    },
  };
}
