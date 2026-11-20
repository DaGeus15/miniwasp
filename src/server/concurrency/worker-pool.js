import { Worker } from 'node:worker_threads';

export const DEFAULT_MAX_QUEUE = 100;
export const DEFAULT_TASK_TIMEOUT_MS = 10000;

export class WorkerPoolBusyError extends Error {
  name = 'WorkerPoolBusyError';
}

export class WorkerTaskError extends Error {
  name = 'WorkerTaskError';
}

function createNodeWorker(workerUrl, workerData) {
  return new Worker(workerUrl, { workerData });
}

// Reparte trabajo pesado de CPU entre hilos para que el hilo principal (el chat de todas las
// salas) nunca se congele. Cada hilo atiende una tarea a la vez. La cola esta acotada: si se
// llena, la tarea se rechaza de inmediato en lugar de acumular memoria. Un hilo que tarda
// demasiado o falla se reemplaza por uno nuevo.
// Protocolo con el hilo: recibe { taskId, payload } y responde { taskId, result } o
// { taskId, error }.
export class WorkerPool {
  #workerUrl;
  #workerData;
  #createWorker;
  #maxQueue;
  #timeoutMs;
  #idle = [];
  #busy = new Map();
  #queue = [];
  #nextTaskId = 1;
  #isClosed = false;

  constructor({
    workerUrl,
    size,
    workerData,
    maxQueue = DEFAULT_MAX_QUEUE,
    timeoutMs = DEFAULT_TASK_TIMEOUT_MS,
    createWorker = createNodeWorker,
  }) {
    this.#workerUrl = workerUrl;
    this.#workerData = workerData;
    this.#createWorker = createWorker;
    this.#maxQueue = maxQueue;
    this.#timeoutMs = timeoutMs;
    for (let index = 0; index < size; index += 1) {
      this.#idle.push(this.#spawn());
    }
  }

  get pending() {
    return this.#queue.length;
  }

  run(payload, transferList = []) {
    if (this.#isClosed || this.#queue.length >= this.#maxQueue) {
      return Promise.reject(new WorkerPoolBusyError('No hay capacidad para procesar la tarea'));
    }
    return new Promise((resolve, reject) => {
      this.#queue.push({ taskId: this.#nextTaskId++, payload, transferList, resolve, reject });
      this.#drain();
    });
  }

  async close() {
    this.#isClosed = true;
    const workers = [...this.#idle, ...this.#busy.keys()];
    const closing = () => new WorkerPoolBusyError('El servidor se está cerrando');
    this.#idle = [];
    this.#queue.splice(0).forEach((task) => task.reject(closing()));
    for (const [worker, current] of this.#busy) {
      this.#finish(worker, current);
      current.task.reject(closing());
    }
    await Promise.all(workers.map((worker) => worker.terminate()));
  }

  #spawn() {
    const worker = this.#createWorker(this.#workerUrl, this.#workerData);
    worker.on('message', (message) => this.#settle(worker, message));
    worker.on('error', (error) => this.#replace(worker, new WorkerTaskError(error.message)));
    worker.on('exit', () => this.#replace(worker, new WorkerTaskError('El hilo de trabajo terminó')));
    worker.unref?.();
    return worker;
  }

  #drain() {
    while (this.#idle.length > 0 && this.#queue.length > 0) {
      const worker = this.#idle.pop();
      const task = this.#queue.shift();
      const timer = setTimeout(() => this.#replace(worker, new WorkerTaskError('La tarea tardó demasiado')), this.#timeoutMs);
      this.#busy.set(worker, { task, timer });
      worker.postMessage({ taskId: task.taskId, payload: task.payload }, task.transferList);
    }
  }

  #settle(worker, { taskId, result, error }) {
    const current = this.#busy.get(worker);
    if (current?.task.taskId !== taskId) {
      return;
    }
    this.#finish(worker, current);
    this.#idle.push(worker);
    if (error === undefined) {
      current.task.resolve(result);
    } else {
      current.task.reject(new WorkerTaskError(error));
    }
    this.#drain();
  }

  #replace(worker, failure) {
    const current = this.#busy.get(worker);
    const wasKnown = Boolean(current) || this.#idle.includes(worker);
    if (!wasKnown || this.#isClosed) {
      return;
    }
    if (current) {
      this.#finish(worker, current);
      current.task.reject(failure);
    }
    this.#idle = this.#idle.filter((idleWorker) => idleWorker !== worker);
    worker.removeAllListeners();
    worker.terminate();
    this.#idle.push(this.#spawn());
    this.#drain();
  }

  #finish(worker, { timer }) {
    clearTimeout(timer);
    this.#busy.delete(worker);
  }
}
