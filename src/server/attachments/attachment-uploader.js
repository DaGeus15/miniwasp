import { AttachmentKind, MAX_ATTACHMENT_BYTES } from '../../shared/attachments.js';
import { AttachmentError, AttachmentRefusal } from './attachment-error.js';
import { sanitizeFileName } from './file-name.js';
import { detectFileType } from './file-signature.js';

const PLAIN_TEXT = 'text/plain';
const NOT_REVIEWABLE_ERROR = 'En esta sala solo se pueden enviar fotos y archivos de texto';

// Recorrido de una subida, igual para el navegador y para la API REST:
// lugar libre → lectura acotada → tipo por contenido → tamaño por tipo → nombre seguro →
// moderacion → cifrado y guardado. Si cualquier paso falla, no queda nada guardado.
export class AttachmentUploader {
  #store;
  #contentGate;
  #uploadGate;

  constructor({ store, contentGate, uploadGate }) {
    this.#store = store;
    this.#contentGate = contentGate;
    this.#uploadGate = uploadGate;
  }

  async upload({ room, session, rawFileName, readBytes }) {
    const release = this.#uploadGate.tryAcquire();
    if (!release) {
      throw new AttachmentError(AttachmentRefusal.BUSY);
    }
    try {
      const bytes = await readBytes(MAX_ATTACHMENT_BYTES);
      const { profile } = room;
      const type = requireAllowedType(bytes, profile);
      const fileName = sanitizeFileName(rawFileName, type.extension);
      this.#contentGate.reviewText(session, fileName, profile);
      const safeBytes = await this.#reviewContent({ session, profile, type, bytes });
      return await this.#store.add({ room, sessionId: session.id, type, fileName, bytes: safeBytes });
    } finally {
      release();
    }
  }

  // Las imagenes vuelven re-codificadas (sin metadatos); el texto plano se modera completo.
  async #reviewContent({ session, profile, type, bytes }) {
    if (type.kind === AttachmentKind.IMAGE) {
      return this.#contentGate.reviewImage(session, bytes, profile);
    }
    if (type.mimeType === PLAIN_TEXT) {
      this.#contentGate.reviewText(session, bytes.toString('utf8'), profile);
    }
    return bytes;
  }
}

// Las salas estrictas solo aceptan lo que la moderacion puede revisar por dentro.
function requireAllowedType(bytes, profile) {
  const type = detectFileType(bytes);
  if (!type) {
    throw new AttachmentError(AttachmentRefusal.TYPE_NOT_ALLOWED);
  }
  if (!profile.allowsType(type.mimeType)) {
    throw new AttachmentError(AttachmentRefusal.TYPE_NOT_ALLOWED, NOT_REVIEWABLE_ERROR);
  }
  if (bytes.length > type.maxBytes) {
    throw new AttachmentError(AttachmentRefusal.TOO_LARGE);
  }
  return type;
}
