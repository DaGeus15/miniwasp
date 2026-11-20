import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TEXTS } from '../../src/client/common/texts.js';
import { MAX_NAME_LENGTH, MAX_TEXT_LENGTH } from '../../src/shared/limits.js';
import { startTestApp } from '../support/app-harness.js';

const message = { id: '1', name: 'Luis', text: 'hola', time: '2026-11-04T10:00:00.000Z' };

async function setup(options) {
  const app = await startTestApp(options);
  const { window, document, nameInput, textInput } = app;

  return {
    ...app,
    items: () => [...document.querySelectorAll('.message')],
    submit(name, text) {
      nameInput.value = name;
      textInput.value = text;
      const event = new window.Event('submit', { cancelable: true, bubbles: true });
      document.querySelector('#composer').dispatchEvent(event);
      return event;
    },
  };
}

describe('startChat', () => {
  it('muestra el estado de la conexion y restaura el nombre guardado', async () => {
    const { document, socket, nameInput } = await setup({ savedName: 'Ana' });

    assert.equal(socket.url, 'ws://chat.test');
    assert.equal(nameInput.value, 'Ana');

    socket.simulateOpen();
    assert.equal(document.querySelector('#status').textContent, TEXTS.online);

    socket.simulateClose();
    assert.equal(document.querySelector('#status').textContent, TEXTS.reconnecting);
  });

  it('aplica a los campos los limites del protocolo', async () => {
    const { nameInput, textInput } = await setup();

    assert.equal(nameInput.maxLength, MAX_NAME_LENGTH);
    assert.equal(textInput.maxLength, MAX_TEXT_LENGTH);
  });

  it('muestra el historial reemplazando lo anterior', async () => {
    const { socket, items } = await setup();
    socket.simulateData(JSON.stringify({ type: 'message', message }));

    const history = [message, { ...message, id: '2', text: 'adios' }];
    socket.simulateData(JSON.stringify({ type: 'history', messages: history }));

    assert.deepEqual(
      items().map((item) => item.querySelector('.message-text').textContent),
      ['hola', 'adios'],
    );
  });

  it('distingue los mensajes propios de los ajenos', async () => {
    const { socket, nameInput, items } = await setup();
    nameInput.value = 'Ana';

    socket.simulateData(JSON.stringify({ type: 'message', message }));
    socket.simulateData(JSON.stringify({ type: 'message', message: { ...message, name: 'Ana' } }));

    const [foreign, own] = items();
    assert.equal(foreign.classList.contains('message-own'), false);
    assert.equal(own.classList.contains('message-own'), true);
  });

  it('muestra el HTML recibido como texto', async () => {
    const { document, socket } = await setup();
    const text = '<img src=x onerror=alert(1)>';

    socket.simulateData(JSON.stringify({ type: 'message', message: { ...message, text } }));

    assert.equal(document.querySelector('.message-text').textContent, text);
    assert.equal(document.querySelector('#messages img'), null);
  });

  it('envia el mensaje limpio, guarda el nombre y vacia el campo', async () => {
    const { socket, saved, textInput, errorLabel, submit } = await setup();
    socket.simulateOpen();

    const event = submit(' Ana ', ' hola ');

    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(socket.sent.map((data) => JSON.parse(data)), [{ type: 'chat-message', name: 'Ana', text: 'hola' }]);
    assert.equal(saved.get('miniwasp-name'), 'Ana');
    assert.equal(textInput.value, '');
    assert.equal(errorLabel.hidden, true);
  });

  it('no envia borradores invalidos', async () => {
    const { socket, errorLabel, submit } = await setup();
    socket.simulateOpen();

    submit('Ana', '   ');

    assert.equal(socket.sent.length, 0);
    assert.equal(errorLabel.hidden, false);
    assert.equal(errorLabel.textContent, TEXTS.textRequired);
  });

  it('conserva el mensaje si no hay conexion', async () => {
    const { socket, textInput, errorLabel, submit } = await setup();

    submit('Ana', 'hola');

    assert.equal(socket.sent.length, 0);
    assert.equal(textInput.value, 'hola');
    assert.equal(errorLabel.textContent, TEXTS.offline);
  });

  it('muestra los errores enviados por el servidor', async () => {
    const { socket, errorLabel } = await setup();

    socket.simulateData(JSON.stringify({ type: 'error', error: 'mensaje rechazado' }));

    assert.equal(errorLabel.hidden, false);
    assert.equal(errorLabel.textContent, 'mensaje rechazado');
  });

  it('sigue funcionando si llega una respuesta corrupta', async () => {
    const { socket, errorLabel, items } = await setup();

    socket.simulateData('{corrupto');
    assert.equal(errorLabel.textContent, TEXTS.invalidServerEvent);

    socket.simulateData(JSON.stringify({ type: 'message', message }));
    assert.equal(items().length, 1);
  });
});
