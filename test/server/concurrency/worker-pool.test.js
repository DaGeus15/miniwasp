import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import jpeg from 'jpeg-js';
import { WorkerPool, WorkerPoolBusyError, WorkerTaskError } from '../../../src/server/concurrency/worker-pool.js';
import { ImageInspector } from '../../../src/server/moderation/image-inspector.js';

class FakeWorker extends EventEmitter {
  posted = [];
  terminated = false;

  postMessage(message) {
    this.posted.push(message);
  }

  reply(result) {
    this.emit('message', { taskId: this.posted.at(-1).taskId, result });
  }

  fail(error) {
    this.emit('message', { taskId: this.posted.at(-1).taskId, error });
  }

  async terminate() {
    this.terminated = true;
  }
}

function createPool(options = {}) {
  const workers = [];
  const pool = new WorkerPool({
    workerUrl: 'fake',
    size: 1,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    ...options,
  });
  return { pool, workers };
}

describe('WorkerPool', () => {
  it('atiende una tarea por hilo y encola las demas en orden', async () => {
    const { pool, workers } = createPool();
    const first = pool.run('a');
    const second = pool.run('b');

    assert.equal(workers[0].posted.length, 1);
    assert.equal(pool.pending, 1);
    workers[0].reply('A');
    assert.equal(await first, 'A');
    assert.equal(workers[0].posted.at(-1).payload, 'b');
    workers[0].reply('B');
    assert.equal(await second, 'B');
  });

  it('rechaza de inmediato cuando la cola esta llena', async () => {
    const { pool } = createPool({ maxQueue: 1 });
    const running = pool.run('ocupa el hilo').catch((error) => error);
    const queued = pool.run('en cola').catch((error) => error);

    await assert.rejects(pool.run('sobra'), WorkerPoolBusyError);
    await pool.close();
    assert.ok((await queued) instanceof WorkerPoolBusyError);
    assert.ok(running);
  });

  it('propaga el error de una tarea y el hilo sigue disponible', async () => {
    const { pool, workers } = createPool();
    const failing = pool.run('a');
    workers[0].fail('imagen invalida');

    await assert.rejects(failing, (error) => error instanceof WorkerTaskError && error.message === 'imagen invalida');
    const next = pool.run('b');
    workers[0].reply('ok');
    assert.equal(await next, 'ok');
  });

  it('reemplaza un hilo que tarda demasiado o que falla, e ignora respuestas ajenas', async () => {
    const { pool, workers } = createPool({ timeoutMs: 20 });
    const slow = pool.run('a');
    workers[0].emit('message', { taskId: 999, result: 'ajena' });

    await assert.rejects(slow, /tardó demasiado/);
    assert.equal(workers[0].terminated, true);
    const crashed = pool.run('b');
    workers[1].emit('error', new Error('se cayo'));
    await assert.rejects(crashed, /se cayo/);
    workers[2].emit('exit');
    assert.equal(workers.length, 4);
  });

  it('al cerrarse termina sus hilos y rechaza lo pendiente y lo nuevo', async () => {
    const { pool, workers } = createPool();
    const running = pool.run('en curso');
    const queued = pool.run('en cola');

    await pool.close();

    await assert.rejects(running, WorkerPoolBusyError);
    await assert.rejects(queued, WorkerPoolBusyError);
    await assert.rejects(pool.run('nueva'), WorkerPoolBusyError);
    assert.equal(workers[0].terminated, true);
    workers[0].emit('exit');
    assert.equal(workers.length, 1);
  });
});

describe('moderacion de imagenes con el modelo real', () => {
  it('analiza una foto en un hilo y la devuelve re-codificada', { timeout: 60000 }, async () => {
    const width = 64;
    const height = 48;
    const data = Buffer.alloc(width * height * 4);
    data.forEach((_, index) => {
      data[index] = (index * 7) % 256;
    });
    const photo = Buffer.from(jpeg.encode({ data, width, height }, 90).data);
    const inspector = new ImageInspector({ workers: 1 });

    try {
      const verdict = await inspector.inspect(photo);
      assert.equal(verdict.allowed, true);
      assert.deepEqual([...verdict.bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    } finally {
      await inspector.close();
    }
  });
});
