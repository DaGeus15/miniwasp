import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createNameStore } from '../../src/client/chat/name-store.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function failingStorage() {
  throw new Error('almacenamiento bloqueado');
}

describe('createNameStore', () => {
  it('guarda y recupera el nombre', () => {
    const storage = memoryStorage();
    const store = createNameStore(() => storage);

    assert.equal(store.save('Ana'), true);
    assert.equal(store.load(), 'Ana');
  });

  it('devuelve vacio si no hay nombre guardado', () => {
    const storage = memoryStorage();

    assert.equal(createNameStore(() => storage).load(), '');
  });

  it('no falla si el almacenamiento no esta disponible', () => {
    const store = createNameStore(failingStorage);

    assert.equal(store.load(), '');
    assert.equal(store.save('Ana'), false);
  });
});
