export const DEFAULT_MAX_PUBLIC_ROOMS = 100;
export const MAX_LISTED_ROOMS = 50;

// Lista de salas publicas de la portada. Solo muestra lo necesario para elegir una sala
// (titulo y ocupacion): nunca nombres de personas, ids internos ni invitaciones. Una sala sin
// nadie conectado no aparece.
export class PublicRoomDirectory {
  #roomsByListing = new Map();
  #countMembers;
  #maxRoomMembers;
  #maxRooms;

  constructor({ countMembers, maxRoomMembers, maxRooms = DEFAULT_MAX_PUBLIC_ROOMS }) {
    this.#countMembers = countMembers;
    this.#maxRoomMembers = maxRoomMembers;
    this.#maxRooms = maxRooms;
  }

  get hasCapacity() {
    return this.#roomsByListing.size < this.#maxRooms;
  }

  add(room) {
    if (room.isListed) {
      this.#roomsByListing.set(room.listingId, room);
    }
  }

  remove(room) {
    this.#roomsByListing.delete(room.listingId);
  }

  find(listingId) {
    return this.#roomsByListing.get(listingId) ?? null;
  }

  capacityOf(room) {
    return room.capacityWithin(this.#maxRoomMembers);
  }

  isFull(room) {
    return this.#countMembers(room.id) >= this.capacityOf(room);
  }

  // Las mas concurridas primero; a igual ocupacion, las mas nuevas.
  list(limit = MAX_LISTED_ROOMS) {
    return [...this.#roomsByListing.values()]
      .map((room) => ({ room, members: this.#countMembers(room.id) }))
      .filter(({ members }) => members > 0)
      .sort((first, second) => second.members - first.members || second.room.createdAt - first.room.createdAt)
      .slice(0, limit)
      .map(({ room, members }) => ({
        listingId: room.listingId,
        title: room.title,
        members,
        capacity: this.capacityOf(room),
      }));
  }
}
