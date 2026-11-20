import { ModerationCategory } from './moderation-terms.js';

// Umbrales sobre las probabilidades del modelo. Lo explicito (Porn + Hentai) se bloquea con
// una certeza moderada; lo sugerente (Sexy, contenido +16) solo con una certeza muy alta,
// para no bloquear fotos comunes como una playa.
export const EXPLICIT_THRESHOLD = 0.7;
export const SUGGESTIVE_THRESHOLD = 0.9;
const DEFAULT_THRESHOLDS = Object.freeze({ explicit: EXPLICIT_THRESHOLD, suggestive: SUGGESTIVE_THRESHOLD });

function probabilityOf(predictions, className) {
  return predictions.find((prediction) => prediction.className === className)?.probability ?? 0;
}

// predictions: [{ className, probability }] de las clases Drawing, Hentai, Neutral, Porn, Sexy.
// thresholds: los de la sala (las publicas son mas estrictas).
export function judgeImage(predictions, { explicit: explicitThreshold, suggestive: suggestiveThreshold } = DEFAULT_THRESHOLDS) {
  const explicit = probabilityOf(predictions, 'Porn') + probabilityOf(predictions, 'Hentai');
  const suggestive = probabilityOf(predictions, 'Sexy');
  if (explicit >= explicitThreshold || suggestive >= suggestiveThreshold) {
    return { allowed: false, category: ModerationCategory.SEXUAL_EXPLICIT };
  }
  return { allowed: true };
}
