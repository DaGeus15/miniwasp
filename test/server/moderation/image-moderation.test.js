import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import jpeg from 'jpeg-js';
import { AttachmentRefusal } from '../../../src/server/attachments/attachment-error.js';
import { ImageInspector } from '../../../src/server/moderation/image-inspector.js';
import { ImageReviewStatus, reviewImage } from '../../../src/server/moderation/image-review.js';
import {
  CLASSIFIER_INPUT_SIZE,
  decodeJpeg,
  encodeJpeg,
  InvalidImageError,
  toClassifierInput,
} from '../../../src/server/moderation/image-sanitizer.js';
import { EXPLICIT_THRESHOLD, judgeImage, SUGGESTIVE_THRESHOLD } from '../../../src/server/moderation/image-verdict.js';
import { ModerationCategory } from '../../../src/server/moderation/text-moderator.js';

function createJpeg(width, height, withExif = false) {
  const data = Buffer.alloc(width * height * 4, 200);
  const encoded = Buffer.from(jpeg.encode({ data, width, height }, 90).data);
  if (!withExif) {
    return encoded;
  }
  // Inserta un segmento APP1 (EXIF) con una "ubicacion" despues del marcador SOI.
  const payload = Buffer.from('Exif\u0000\u0000GPS:-0.18,-78.46');
  const segment = Buffer.concat([Buffer.from([0xff, 0xe1, 0, payload.length + 2]), payload]);
  return Buffer.concat([encoded.subarray(0, 2), segment, encoded.subarray(2)]);
}

function predictions({ porn = 0, hentai = 0, sexy = 0 }) {
  const neutral = Math.max(1 - porn - hentai - sexy, 0);
  return [
    { className: 'Porn', probability: porn },
    { className: 'Hentai', probability: hentai },
    { className: 'Sexy', probability: sexy },
    { className: 'Neutral', probability: neutral },
    { className: 'Drawing', probability: 0 },
  ];
}

describe('judgeImage', () => {
  it('bloquea lo explicito y lo muy sugerente, y permite lo demas', () => {
    assert.deepEqual(judgeImage(predictions({ porn: EXPLICIT_THRESHOLD })), {
      allowed: false,
      category: ModerationCategory.SEXUAL_EXPLICIT,
    });
    assert.equal(judgeImage(predictions({ porn: 0.4, hentai: 0.35 })).allowed, false);
    assert.equal(judgeImage(predictions({ sexy: SUGGESTIVE_THRESHOLD })).allowed, false);
    assert.equal(judgeImage(predictions({ sexy: 0.85 })).allowed, true);
    assert.equal(judgeImage(predictions({ porn: 0.3, hentai: 0.3 })).allowed, true);
    assert.equal(judgeImage([]).allowed, true);
  });
});

describe('sanitizador de imagenes', () => {
  it('re-codifica la foto sin sus metadatos', () => {
    const original = createJpeg(16, 16, true);
    const clean = encodeJpeg(decodeJpeg(original));

    assert.ok(original.includes(Buffer.from('GPS:')));
    assert.equal(clean.includes(Buffer.from('GPS:')), false);
    assert.deepEqual([...clean.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  });

  it('rechaza imagenes dañadas o que se expanden demasiado al decodificarse', () => {
    assert.throws(() => decodeJpeg(Buffer.from([0xff, 0xd8, 0xff, 0x00])), InvalidImageError);
    assert.throws(() => decodeJpeg(createJpeg(2600, 1600)), InvalidImageError);
  });

  it('reduce cualquier tamaño a la entrada RGB del modelo promediando colores', () => {
    const image = { width: 2, height: 1, data: Uint8Array.from([0, 0, 0, 255, 200, 100, 50, 255]) };
    const input = toClassifierInput(image, 1);
    const large = toClassifierInput(decodeJpeg(createJpeg(500, 300)));

    assert.deepEqual([...input.data], [100, 50, 25]);
    assert.equal(large.data.length, CLASSIFIER_INPUT_SIZE * CLASSIFIER_INPUT_SIZE * 3);
    assert.equal(toClassifierInput({ width: 1, height: 1, data: Uint8Array.from([9, 8, 7, 255]) }, 2).data[11], 7);
  });
});

describe('reviewImage', () => {
  const classifierReturning = (result) => ({ classify: async () => result });

  it('permite una foto y la devuelve limpia, o informa su categoria si se bloquea', async () => {
    const photo = createJpeg(32, 32, true);

    const allowed = await reviewImage(photo, classifierReturning(predictions({})));
    const blocked = await reviewImage(photo, classifierReturning(predictions({ porn: 0.95 })));

    assert.equal(allowed.status, ImageReviewStatus.ALLOWED);
    assert.equal(allowed.bytes.includes(Buffer.from('GPS:')), false);
    assert.deepEqual(blocked, { status: ImageReviewStatus.BLOCKED, category: ModerationCategory.SEXUAL_EXPLICIT });
  });

  it('una imagen invalida no llega al modelo y un fallo del modelo se propaga', async () => {
    let calls = 0;
    const counting = {
      classify: async () => {
        calls += 1;
        return predictions({});
      },
    };
    const broken = { classify: async () => Promise.reject(new Error('modelo caido')) };

    assert.deepEqual(await reviewImage(Buffer.from([1, 2, 3]), counting), { status: ImageReviewStatus.INVALID });
    assert.equal(calls, 0);
    await assert.rejects(reviewImage(createJpeg(8, 8), broken), /modelo caido/);
  });
});

describe('ImageInspector', () => {
  const inspectorWith = (run) => {
    const created = [];
    const inspector = new ImageInspector({
      workers: 2,
      createPool: (size) => {
        const pool = { size, run, closed: false, close: async () => (pool.closed = true) };
        created.push(pool);
        return pool;
      },
    });
    return { inspector, created };
  };

  it('crea los hilos con la primera imagen y los reutiliza', async () => {
    const { inspector, created } = inspectorWith(async () => ({ status: ImageReviewStatus.ALLOWED, bytes: new Uint8Array([1]) }));

    assert.equal(created.length, 0);
    const first = await inspector.inspect(Buffer.from([7]));
    await inspector.inspect(Buffer.from([8]));
    await inspector.close();

    assert.deepEqual(first, { allowed: true, bytes: Buffer.from([1]) });
    assert.equal(created.length, 1);
    assert.equal(created[0].size, 2);
    assert.equal(created[0].closed, true);
  });

  it('traduce cada resultado y falla cerrado si los hilos no pueden atender', async () => {
    const blocked = inspectorWith(async () => ({ status: ImageReviewStatus.BLOCKED, category: 'sexual' }));
    const invalid = inspectorWith(async () => ({ status: ImageReviewStatus.INVALID }));
    const busy = inspectorWith(async () => Promise.reject(new Error('cola llena')));

    assert.deepEqual(await blocked.inspector.inspect(Buffer.from([1])), { allowed: false, category: 'sexual' });
    await assert.rejects(invalid.inspector.inspect(Buffer.from([1])), (error) => error.refusal === AttachmentRefusal.TYPE_NOT_ALLOWED);
    await assert.rejects(busy.inspector.inspect(Buffer.from([1])), (error) => error.refusal === AttachmentRefusal.BUSY);
    await new ImageInspector({ workers: 1 }).close();
  });
});
