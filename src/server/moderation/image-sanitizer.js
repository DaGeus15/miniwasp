import jpeg from 'jpeg-js';

// El cliente reduce las fotos a 1600 px de lado; 4 megapixeles deja margen sin permitir que
// una imagen pequeña en bytes se expanda a cientos de MB al decodificarse.
const DECODE_LIMITS = Object.freeze({
  useTArray: true,
  formatAsRGBA: true,
  maxResolutionInMP: 4,
  maxMemoryUsageInMB: 64,
});
const ENCODE_QUALITY = 85;
// Tamaño de entrada del modelo de moderacion.
export const CLASSIFIER_INPUT_SIZE = 224;
const RGBA_CHANNELS = 4;
const RGB_CHANNELS = 3;

export class InvalidImageError extends Error {
  name = 'InvalidImageError';
}

// Decodifica un JPEG con limites de memoria. Si no es una imagen valida, o es demasiado
// grande al expandirse (una "bomba de descompresion"), lanza InvalidImageError.
export function decodeJpeg(bytes) {
  try {
    return jpeg.decode(bytes, DECODE_LIMITS);
  } catch (error) {
    throw new InvalidImageError(error.message);
  }
}

// Vuelve a codificar desde los pixeles: el resultado no conserva metadatos (EXIF, GPS) ni
// ningun contenido extra escondido en el archivo original (archivos "poliglotas").
// Solo se pasan los pixeles: jpeg-js copiaria el EXIF original si recibiera la imagen decodificada.
export function encodeJpeg({ data, width, height }) {
  return Buffer.from(jpeg.encode({ data, width, height }, ENCODE_QUALITY).data);
}

function averageBlock(image, channel, [fromX, toX], [fromY, toY]) {
  let sum = 0;
  for (let y = fromY; y < toY; y += 1) {
    for (let x = fromX; x < toX; x += 1) {
      sum += image.data[(y * image.width + x) * RGBA_CHANNELS + channel];
    }
  }
  return Math.round(sum / ((toX - fromX) * (toY - fromY)));
}

function blockBounds(index, sourceLength, targetLength) {
  const from = Math.floor((index * sourceLength) / targetLength);
  const to = Math.max(Math.floor(((index + 1) * sourceLength) / targetLength), from + 1);
  return [from, Math.min(to, sourceLength)];
}

// Reduce la imagen RGBA a un cuadrado RGB del tamaño que espera el modelo, promediando
// bloques. Asi el modelo trabaja con poca memoria aunque la foto sea grande.
export function toClassifierInput(image, size = CLASSIFIER_INPUT_SIZE) {
  const pixels = new Uint8Array(size * size * RGB_CHANNELS);
  for (let row = 0; row < size; row += 1) {
    const rows = blockBounds(row, image.height, size);
    for (let column = 0; column < size; column += 1) {
      const columns = blockBounds(column, image.width, size);
      for (let channel = 0; channel < RGB_CHANNELS; channel += 1) {
        pixels[(row * size + column) * RGB_CHANNELS + channel] = averageBlock(image, channel, columns, rows);
      }
    }
  }
  return { data: pixels, width: size, height: size };
}
