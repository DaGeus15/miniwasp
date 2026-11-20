import { FILE_NAME_HEADER } from '../../shared/attachments.js';

const UPLOAD_PATH = '/rooms/attachments';
const CREATED = 201;

export function attachmentUrl(attachmentId) {
  return `${UPLOAD_PATH}/${encodeURIComponent(attachmentId)}`;
}

async function readErrorMessage(response) {
  try {
    const { error } = await response.json();
    return typeof error === 'string' ? error : null;
  } catch {
    return null;
  }
}

// Sube un archivo a la sala. El servidor decide si lo acepta (tipo, tamaño, moderacion) y
// responde con un mensaje pensado para mostrarse; si no hay red, se informa como tal.
// Devuelve { attachment } o { error } (texto para la persona, o null si no hubo respuesta).
export class AttachmentClient {
  #request;

  constructor(request) {
    this.#request = request;
  }

  async upload(blob, fileName) {
    try {
      const response = await this.#request(UPLOAD_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', [FILE_NAME_HEADER]: encodeURIComponent(fileName) },
        body: blob,
      });
      if (response.status === CREATED) {
        return { attachment: await response.json() };
      }
      return { error: await readErrorMessage(response) };
    } catch {
      return { error: null };
    }
  }
}
