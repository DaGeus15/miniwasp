import { parentPort } from 'node:worker_threads';
import { reviewImage } from './image-review.js';
import { loadNsfwClassifier } from './nsfw-classifier.js';

// Hilo de moderacion de imagenes. Carga el modelo una sola vez y atiende una imagen a la vez.
// Si el modelo no carga, el hilo no se cae: responde error a cada tarea (falla cerrado) y el
// servidor rechaza las imagenes en lugar de publicarlas sin revisar.
const classifierLoading = loadNsfwClassifier().then(
  (classifier) => ({ classifier }),
  (error) => ({ loadError: error }),
);

parentPort.on('message', async ({ taskId, payload }) => {
  try {
    const { classifier, loadError } = await classifierLoading;
    if (loadError) {
      throw loadError;
    }
    parentPort.postMessage({ taskId, result: await reviewImage(payload.bytes, classifier, payload.thresholds) });
  } catch (error) {
    parentPort.postMessage({ taskId, error: String(error?.message ?? error) });
  }
});
