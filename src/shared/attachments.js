// Tipos de adjunto que acepta MiniWasp. Cliente y servidor comparten esta lista: el cliente
// la usa para orientar a la persona y el servidor para decidir. El servidor nunca confia en la
// extension ni en el tipo declarado: identifica cada archivo por su contenido.
export const AttachmentKind = Object.freeze({
  IMAGE: 'image',
  AUDIO: 'audio',
  DOCUMENT: 'document',
});

const MEGABYTE = 1024 * 1024;

export const ATTACHMENT_TYPES = Object.freeze(
  [
    { mimeType: 'image/jpeg', kind: AttachmentKind.IMAGE, extension: 'jpg', maxBytes: 5 * MEGABYTE },
    { mimeType: 'audio/webm', kind: AttachmentKind.AUDIO, extension: 'webm', maxBytes: 2 * MEGABYTE },
    { mimeType: 'audio/ogg', kind: AttachmentKind.AUDIO, extension: 'ogg', maxBytes: 2 * MEGABYTE },
    { mimeType: 'audio/mp4', kind: AttachmentKind.AUDIO, extension: 'm4a', maxBytes: 2 * MEGABYTE },
    { mimeType: 'application/pdf', kind: AttachmentKind.DOCUMENT, extension: 'pdf', maxBytes: 8 * MEGABYTE },
    { mimeType: 'text/plain', kind: AttachmentKind.DOCUMENT, extension: 'txt', maxBytes: MEGABYTE },
  ].map((type) => Object.freeze(type)),
);

export const MAX_ATTACHMENT_BYTES = Math.max(...ATTACHMENT_TYPES.map((type) => type.maxBytes));
export const MAX_FILE_NAME_LENGTH = 80;
export const MAX_VOICE_NOTE_MS = 2 * 60 * 1000;
// Lado mayor de una imagen: el cliente la reduce antes de enviarla.
export const MAX_IMAGE_SIDE = 1600;
// El cuerpo de una subida es el archivo tal cual; su nombre viaja codificado en esta cabecera.
export const FILE_NAME_HEADER = 'X-File-Name';
export const ATTACHMENT_ID_PATTERN =/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;

export function findAttachmentType(mimeType) {
  return ATTACHMENT_TYPES.find((type) => type.mimeType === mimeType) ?? null;
}
