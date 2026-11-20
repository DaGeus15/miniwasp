import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';

const require = createRequire(import.meta.url);
const TOP_CLASSES = 5;

// Carga el modelo de deteccion de desnudos (nsfwjs, MobileNetV2) con el backend WASM de
// TensorFlow.js. Todo es local: el modelo viene empaquetado y ninguna imagen sale del
// servidor. Se importa de forma diferida porque solo lo usan los hilos de moderacion.
export async function loadNsfwClassifier() {
  const tf = await import('@tensorflow/tfjs');
  const { setWasmPaths } = await import('@tensorflow/tfjs-backend-wasm');
  const { load } = await import('nsfwjs/core');
  const { MobileNetV2Model } = await import('nsfwjs/models/mobilenet_v2');

  const wasmDirectory = join(dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')), 'dist') + sep;
  setWasmPaths(wasmDirectory);
  tf.enableProdMode();
  await tf.setBackend('wasm');
  await tf.ready();
  const model = await load('MobileNetV2', { modelDefinitions: [MobileNetV2Model] });

  return {
    // input: { data: Uint8Array RGB, width, height }
    async classify({ data, width, height }) {
      const tensor = tf.tensor3d(data, [height, width, 3], 'int32');
      try {
        return await model.classify(tensor, TOP_CLASSES);
      } finally {
        tensor.dispose();
      }
    },
  };
}
