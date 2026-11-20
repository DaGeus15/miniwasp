// Una sala publica no tiene invitacion que renovar: sin este veto, alguien expulsado volveria a
// entrar desde la lista. Guarda solo huellas seudonimas (HMAC de la IP), nunca direcciones, y
// vive lo mismo que la sala. El tope acota la memoria.
export const MAX_BANS_PER_ROOM = 500;

export class RoomBanList {
  #clientRefs = new Set();

  ban(clientRef) {
    if (!clientRef || this.#clientRefs.size >= MAX_BANS_PER_ROOM) {
      return;
    }
    this.#clientRefs.add(clientRef);
  }

  isBanned(clientRef) {
    return Boolean(clientRef) && this.#clientRefs.has(clientRef);
  }
}
