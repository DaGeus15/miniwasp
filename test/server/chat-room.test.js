import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChatRoom, createMessage } from '../../src/server/chat/chat-room.js';
import { ValidationError } from '../../src/server/validation.js';
import { MAX_NAME_LENGTH, MAX_TEXT_LENGTH } from '../../src/shared/limits.js';

describe('createMessage', () => {
  it('crea un mensaje sin espacios sobrantes', () => {
    const message = createMessage({ name: '  Ana ', text: ' hola ' });

    assert.equal(message.name, 'Ana');
    assert.equal(message.text, 'hola');
    assert.ok(message.id);
    assert.ok(!Number.isNaN(Date.parse(message.time)));
  });

  it('rechaza valores que no son texto', () => {
    assert.throws(() => createMessage({ name: 1, text: 'hola' }), ValidationError);
    assert.throws(() => createMessage(null), ValidationError);
  });

  it('rechaza textos vacios', () => {
    assert.throws(() => createMessage({ name: 'Ana', text: '   ' }), ValidationError);
  });

  it('rechaza textos demasiado largos', () => {
    assert.throws(
      () => createMessage({ name: 'a'.repeat(MAX_NAME_LENGTH + 1), text: 'hola' }),
      ValidationError,
    );
    assert.throws(
      () => createMessage({ name: 'Ana', text: 'a'.repeat(MAX_TEXT_LENGTH + 1) }),
      ValidationError,
    );
  });
});

describe('ChatRoom', () => {
  it('guarda los mensajes en orden', () => {
    const room = new ChatRoom();
    room.post({ name: 'Ana', text: 'uno' });
    room.post({ name: 'Luis', text: 'dos' });

    assert.deepEqual(room.history().map((message) => message.text), ['uno', 'dos']);
  });

  it('descarta los mensajes mas antiguos al llegar al limite', () => {
    const room = new ChatRoom({ maxHistory: 2 });
    room.post({ name: 'Ana', text: 'uno' });
    room.post({ name: 'Ana', text: 'dos' });
    room.post({ name: 'Ana', text: 'tres' });

    assert.deepEqual(room.history().map((message) => message.text), ['dos', 'tres']);
  });

  it('no expone su arreglo interno', () => {
    const room = new ChatRoom();
    room.history().push({ text: 'intruso' });

    assert.equal(room.history().length, 0);
  });
});
