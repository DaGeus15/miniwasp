import { HttpError } from './http-error.js';

export const MAX_JSON_BODY_BYTES = 1024;
const JSON_CONTENT_TYPE = /^application\/json(?:;|$)/i;

function assertJsonRequest(request) {
  const contentType = request.headers['content-type'];
  // Sin cabecera, cualquier texto por defecto que no sea un tipo JSON produce el mismo 415.
  // Stryker disable next-line StringLiteral: mutante equivalente, ver comentario anterior.
  if (!JSON_CONTENT_TYPE.test(contentType ?? '')) {
    throw new HttpError(415, 'Se esperaba JSON');
  }
}

function payloadTooLarge() {
  return new HttpError(413, 'La solicitud es demasiado grande');
}

async function collectBody(request, maxBytes) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw payloadTooLarge();
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Un cliente que corta la conexion a mitad del cuerpo es un error suyo (400), no un fallo
// interno: no debe registrarse como error 500 con traza.
async function readBody(request, maxBytes) {
  try {
    return await collectBody(request, maxBytes);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, 'La solicitud llegó incompleta');
  }
}

// Cuerpo binario (por ejemplo, un archivo). Si el cliente anuncia un tamaño mayor al permitido,
// se rechaza sin leer nada; si miente, el tope se aplica igual mientras se lee.
export async function readRawBody(request, maxBytes) {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw payloadTooLarge();
  }
  return readBody(request, maxBytes);
}

export async function readJsonBody(request, maxBytes = MAX_JSON_BODY_BYTES) {
  assertJsonRequest(request);
  const body = await readBody(request, maxBytes);

  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'El contenido no es JSON válido');
  }
}
