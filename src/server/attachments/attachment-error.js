import { ValidationError } from '../validation.js';

// Por que se rechazo un adjunto. Cada canal (HTTP del navegador, API REST) decide como
// comunicarlo; el dominio solo dice que paso.
export const AttachmentRefusal = Object.freeze({
  TYPE_NOT_ALLOWED: 'type-not-allowed',
  TOO_LARGE: 'too-large',
  STORAGE_FULL: 'storage-full',
  BUSY: 'busy',
  NOT_FOUND: 'not-found',
});

const MESSAGES = new Map([
  [AttachmentRefusal.TYPE_NOT_ALLOWED, 'Ese tipo de archivo no se puede enviar. Se aceptan fotos, notas de voz, PDF y texto.'],
  [AttachmentRefusal.TOO_LARGE, 'El archivo es demasiado grande'],
  [AttachmentRefusal.STORAGE_FULL, 'Esta sala alcanzó su límite de archivos. Borra algunos mensajes con adjuntos.'],
  [AttachmentRefusal.BUSY, 'El servidor está procesando muchos archivos. Inténtalo en unos segundos.'],
  [AttachmentRefusal.NOT_FOUND, 'El archivo no existe o ya no está disponible'],
]);

export class AttachmentError extends ValidationError {
  name = 'AttachmentError';

  constructor(refusal, message = MESSAGES.get(refusal)) {
    super(message);
    this.refusal = refusal;
  }
}
