import { judgeImage } from './image-verdict.js';
import { decodeJpeg, encodeJpeg, InvalidImageError, toClassifierInput } from './image-sanitizer.js';

export const ImageReviewStatus = Object.freeze({
  ALLOWED: 'allowed',
  BLOCKED: 'blocked',
  INVALID: 'invalid',
});

// Revision completa de una foto: decodificar con limites, clasificar y, si se permite,
// re-codificar sin metadatos. Corre dentro de un hilo de moderacion.
export async function reviewImage(bytes, classifier, thresholds) {
  let image;
  try {
    image = decodeJpeg(bytes);
  } catch (error) {
    if (error instanceof InvalidImageError) {
      return { status: ImageReviewStatus.INVALID };
    }
    throw error;
  }
  const verdict = judgeImage(await classifier.classify(toClassifierInput(image)), thresholds);
  if (!verdict.allowed) {
    return { status: ImageReviewStatus.BLOCKED, category: verdict.category };
  }
  return { status: ImageReviewStatus.ALLOWED, bytes: encodeJpeg(image) };
}
