import { MAX_IMAGE_SIDE } from '../../shared/attachments.js';

const JPEG_TYPE = 'image/jpeg';
const JPEG_QUALITY = 0.85;

function jpegFileName(fileName) {
  const dotIndex = fileName.lastIndexOf('.');
  return `${dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName}.jpg`;
}

// Prepara una foto antes de que salga del dispositivo: la dibuja en un lienzo, la reduce a
// un tamaño razonable y la vuelve JPEG. Asi se pierden sus metadatos (incluida la ubicacion
// GPS de la camara) y pesa menos. El servidor la revisa y la vuelve a codificar de todos modos.
export class ImagePreparer {
  #createImageBitmap;
  #createCanvas;

  constructor({ createImageBitmap, createCanvas }) {
    this.#createImageBitmap = createImageBitmap;
    this.#createCanvas = createCanvas;
  }

  async prepare(file) {
    const bitmap = await this.#createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = this.#createCanvas();
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, JPEG_TYPE, JPEG_QUALITY);
    });
    if (!blob) {
      throw new Error('No se pudo preparar la imagen');
    }
    return { blob, fileName: jpegFileName(file.name) };
  }
}
