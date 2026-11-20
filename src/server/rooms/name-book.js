function toNameKey(name) {
  return name.toLowerCase();
}

// Nombres reservados dentro de una sala. Un nombre pertenece a la sesion que lo uso
// primero mientras la sala exista, aunque esa persona se desconecte: nadie puede
// tomarlo despues para escribir en su nombre.
export class NameBook {
  #sessionByName = new Map();
  #nameBySession = new Map();

  isAvailableFor(sessionId, name) {
    const holder = this.#sessionByName.get(toNameKey(name));
    return holder === undefined || holder === sessionId;
  }

  // Una sesion tiene un solo nombre: al cambiarlo, libera el anterior.
  claim(sessionId, name) {
    this.release(sessionId);
    const nameKey = toNameKey(name);
    this.#sessionByName.set(nameKey, sessionId);
    this.#nameBySession.set(sessionId, nameKey);
  }

  release(sessionId) {
    const nameKey = this.#nameBySession.get(sessionId);
    if (nameKey !== undefined) {
      this.#sessionByName.delete(nameKey);
      this.#nameBySession.delete(sessionId);
    }
  }
}
