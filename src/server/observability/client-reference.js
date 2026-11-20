import { createHmac, randomBytes } from 'node:crypto';

const KEY_BYTES = 32;
const REFERENCE_LENGTH = 12;

// Identificador seudonimo de una direccion IP para correlacionar eventos en los registros
// sin guardar la IP. La clave es aleatoria y vive solo en memoria: al reiniciar el proceso
// las referencias anteriores dejan de poder vincularse.
export function createClientReferencer(key = randomBytes(KEY_BYTES)) {
  return (address) =>
    createHmac('sha256', key).update(String(address)).digest('hex').slice(0, REFERENCE_LENGTH);
}
