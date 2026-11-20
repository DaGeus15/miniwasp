import { randomUUID } from 'node:crypto';

// Datos de un adjunto. Los bytes no viven aqui: estan cifrados en el almacenamiento.
export class Attachment {
  constructor({ roomId, uploaderSessionId, type, fileName, size, id = randomUUID() }) {
    this.id = id;
    this.roomId = roomId;
    this.uploaderSessionId = uploaderSessionId;
    this.kind = type.kind;
    this.mimeType = type.mimeType;
    this.fileName = fileName;
    this.size = size;
    Object.freeze(this);
  }

  // Clave del objeto en el almacenamiento: agrupada por sala para borrarla completa.
  get storageKey() {
    return `rooms/${this.roomId}/${this.id}`;
  }

  // Contexto autenticado del cifrado: liga el objeto a esta sala y a este adjunto.
  get cipherContext() {
    return `${this.roomId}:${this.id}`;
  }

  // Lo unico que ven las demas personas: nunca quien lo subio ni donde se guarda.
  toPublic() {
    return { id: this.id, kind: this.kind, mimeType: this.mimeType, fileName: this.fileName, size: this.size };
  }
}
