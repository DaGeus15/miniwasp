import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

// Cifra los archivos de una sala con una clave que solo existe en la memoria del servidor.
// Al cerrarse la sala la clave se borra: lo que quedara en el almacenamiento es ilegible.
// El contexto (sala y adjunto) va como datos asociados: un objeto no se puede mover de una
// sala a otra ni hacerse pasar por otro adjunto.
export class RoomCipher {
  #key;

  constructor(key = randomBytes(KEY_BYTES)) {
    this.#key = key;
  }

  seal(plaintext, context) {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
  }

  // Lanza un error si el objeto fue alterado, es de otra sala o la clave ya se destruyo.
  open(sealed, context) {
    const iv = sealed.subarray(0, IV_BYTES);
    const tag = sealed.subarray(sealed.length - TAG_BYTES);
    const ciphertext = sealed.subarray(IV_BYTES, sealed.length - TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.#key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  destroy() {
    this.#key.fill(0);
  }
}
