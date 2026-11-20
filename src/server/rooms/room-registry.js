import { scheduleOnce } from '../scheduling.js';
import { Room } from './room.js';

export const DEFAULT_EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_ROOMS = 1000;

function createDefaultRoom(options) {
  return new Room(options);
}

// Directorio de salas. Una sala vacia se cierra tras un tiempo de gracia, que permite
// recargar la pagina o reconectar sin perder la conversacion.
export class RoomRegistry {
  #roomsById = new Map();
  #roomsByInvite = new Map();
  #schedule;
  #emptyRoomTtlMs;
  #maxRooms;
  #createRoom;
  #onRoomClosed;

  constructor({
    schedule = scheduleOnce,
    emptyRoomTtlMs = DEFAULT_EMPTY_ROOM_TTL_MS,
    maxRooms = DEFAULT_MAX_ROOMS,
    createRoom = createDefaultRoom,
    onRoomClosed = () => {},
  } = {}) {
    this.#schedule = schedule;
    this.#emptyRoomTtlMs = emptyRoomTtlMs;
    this.#maxRooms = maxRooms;
    this.#createRoom = createRoom;
    this.#onRoomClosed = onRoomClosed;
  }

  // Devuelve null si se alcanzo el maximo: la memoria del servidor esta acotada.
  // options: { visibility, title } (ver Room).
  create(options = {}) {
    if (this.#roomsById.size >= this.#maxRooms) {
      return null;
    }
    const room = this.#createRoom(options);
    this.#roomsById.set(room.id, room);
    this.#roomsByInvite.set(room.inviteToken, room);
    this.markEmpty(room);
    return room;
  }

  find(roomId) {
    return this.#roomsById.get(roomId) ?? null;
  }

  // Un susurro no admite invitaciones: aunque alguien conociera su token, no sirve para entrar.
  findByInvite(inviteToken) {
    const room = this.#roomsByInvite.get(inviteToken);
    return room?.isOpenByInvite ? room : null;
  }

  rotateInvite(room) {
    this.#roomsByInvite.delete(room.inviteToken);
    const inviteToken = room.rotateInvite();
    this.#roomsByInvite.set(inviteToken, room);
    return inviteToken;
  }

  markEmpty(room) {
    room.scheduleCleanup(this.#schedule, this.#emptyRoomTtlMs, () => this.close(room));
  }

  markOccupied(room) {
    room.cancelCleanup();
  }

  // Revisa periodicamente las salas que nadie usa (por ejemplo, cuando vencio la ultima
  // sesion sin que nadie se desconectara) para que ninguna quede abierta para siempre.
  sweep(isRoomInUse) {
    for (const room of this.#roomsById.values()) {
      if (!room.hasScheduledCleanup && !isRoomInUse(room.id)) {
        this.markEmpty(room);
      }
    }
  }

  close(room) {
    room.cancelCleanup();
    this.#roomsById.delete(room.id);
    this.#roomsByInvite.delete(room.inviteToken);
    this.#onRoomClosed(room);
  }
}
