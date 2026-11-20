export const RoomResult = Object.freeze({
  ACTIVE: 'active',
  EXPIRED: 'expired',
  GRANTED: 'granted',
  NOT_FOUND: 'notFound',
  THROTTLED: 'throttled',
  FULL: 'full',
  INVALID: 'invalid',
  BANNED: 'banned',
  BLOCKED: 'blocked',
  UNREACHABLE: 'unreachable',
});

const HTTP_RESULTS = new Map([
  [204, RoomResult.GRANTED],
  [400, RoomResult.INVALID],
  [403, RoomResult.BANNED],
  [422, RoomResult.BLOCKED],
  [404, RoomResult.NOT_FOUND],
  [429, RoomResult.THROTTLED],
  [503, RoomResult.FULL],
]);

const PUBLIC_ROOMS_PATH = '/rooms/public';

// Habla con el servidor sobre salas. La cookie de sesion es HttpOnly: este codigo nunca
// puede leer el token, solo pedir que se cree, se use o se elimine.
export class RoomClient {
  #request;

  constructor(request) {
    this.#request = request;
  }

  async status() {
    try {
      const { status } = await this.#request('/session');
      return status === 200 ? RoomResult.ACTIVE : RoomResult.EXPIRED;
    } catch {
      return RoomResult.UNREACHABLE;
    }
  }

  createRoom() {
    return this.#post('/rooms');
  }

  joinRoom(inviteToken) {
    return this.#post('/rooms/join', { inviteToken });
  }

  createPublicRoom(title) {
    return this.#post('/rooms', { visibility: 'public', title });
  }

  joinPublicRoom(listingId) {
    return this.#post(`/rooms/public/${encodeURIComponent(listingId)}/join`);
  }

  // Usa el pase de un susurro para mudar la sesion a la sala privada de dos.
  transfer(transferToken) {
    return this.#post('/rooms/transfer', { transferToken });
  }

  // Devuelve la lista de salas publicas, o null si no se pudo obtener.
  async listPublicRooms() {
    try {
      const response = await this.#request(PUBLIC_ROOMS_PATH);
      return response.status === 200 ? (await response.json()).rooms : null;
    } catch {
      return null;
    }
  }

  async leave() {
    try {
      await this.#request('/session', { method: 'DELETE' });
    } catch {
      // Sin red la sesion caduca sola en el servidor; salir de la pantalla sigue siendo correcto.
    }
  }

  // Solo se llama despues de que la persona confirmo su edad y acepto las normas.
  async #post(path, payload = {}) {
    try {
      const { status } = await this.#request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, acceptedRules: true }),
      });
      return HTTP_RESULTS.get(status) ?? RoomResult.UNREACHABLE;
    } catch {
      return RoomResult.UNREACHABLE;
    }
  }
}
