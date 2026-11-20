import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServerConnection, reconnectDelay, socketUrl } from '../../src/client/chat/connection.js';
import { FakeSocket } from '../support/fake-socket.js';

function setup(options = {}) {
  const sockets = [];
  const delays = [];
  const statuses = [];
  const received = [];
  const errors = [];

  const connection = new ServerConnection({
    url: 'ws://chat.test',
    createSocket(url) {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    schedule(callback, delayMs) {
      delays.push(delayMs);
      callback();
    },
    onData: (data) => received.push(data),
    onStatus: (status) => statuses.push(status),
    ...options,
  });

  return { connection, sockets, delays, statuses, received, errors };
}

describe('socketUrl', () => {
  it('usa wss en paginas https y ws en http', () => {
    assert.equal(socketUrl({ protocol: 'https:', host: 'chat.test' }), 'wss://chat.test');
    assert.equal(socketUrl({ protocol: 'http:', host: 'chat.test' }), 'ws://chat.test');
  });
});

describe('reconnectDelay', () => {
  it('duplica la espera hasta llegar al maximo', () => {
    const delays = [0, 1, 2, 3, 4].map((attempt) => reconnectDelay(attempt, 1000, 5000));

    assert.deepEqual(delays, [1000, 2000, 4000, 5000, 5000]);
  });
});

describe('ServerConnection', () => {
  it('informa cuando la conexion se abre y entrega los datos recibidos', () => {
    const { connection, sockets, statuses, received } = setup();

    connection.open();
    sockets[0].simulateOpen();
    sockets[0].simulateData('dato');

    assert.deepEqual(statuses, ['online']);
    assert.deepEqual(received, ['dato']);
  });

  it('envia JSON solo con la conexion abierta', () => {
    const { connection, sockets } = setup();

    assert.equal(connection.send({ text: 'antes de conectar' }), false);

    connection.open();
    assert.equal(connection.send({ text: 'conectando' }), false);

    sockets[0].simulateOpen();
    assert.equal(connection.send({ text: 'hola' }), true);
    assert.deepEqual(sockets[0].sent, ['{"text":"hola"}']);
  });

  it('reintenta con esperas crecientes si falla la conexion', () => {
    const { connection, sockets, delays, statuses } = setup({ baseDelayMs: 100, maxDelayMs: 250 });

    connection.open();
    sockets[0].simulateClose();
    sockets[1].simulateClose();
    sockets[2].simulateClose();

    assert.equal(sockets.length, 4);
    assert.deepEqual(delays, [100, 200, 250]);
    assert.equal(statuses.at(-1), 'reconnecting');
  });

  it('reinicia la espera despues de reconectar', () => {
    const { connection, sockets, delays } = setup({ baseDelayMs: 100 });

    connection.open();
    sockets[0].simulateClose();
    sockets[1].simulateOpen();
    sockets[1].simulateClose();

    assert.deepEqual(delays, [100, 100]);
  });

});

describe('ServerConnection: detener', () => {
  function setupStoppable() {
    const sockets = [];
    const scheduled = [];
    const connection = new ServerConnection({
      url: 'ws://chat.test',
      createSocket(url) {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      schedule: (callback) => scheduled.push(callback),
      onData() {},
      onStatus() {},
    });
    return { connection, sockets, scheduled };
  }

  it('cierra el socket sin avisar ni programar otro intento', () => {
    const { connection, sockets, scheduled } = setupStoppable();
    connection.open();

    connection.stop();

    assert.equal(sockets.length, 1);
    assert.equal(sockets[0].readyState, 3);
    assert.equal(scheduled.length, 0);
  });

  it('ignora un reintento que ya estaba programado al detenerse', () => {
    const { connection, sockets, scheduled } = setupStoppable();
    connection.open();
    sockets[0].simulateClose();

    connection.stop();
    scheduled.forEach((reconnect) => reconnect());

    assert.equal(sockets.length, 1);
  });

  it('detener antes de abrir no falla', () => {
    assert.doesNotThrow(() => setupStoppable().connection.stop());
  });

  it('puede volver a abrirse despues de detenerse', () => {
    const { connection, sockets } = setupStoppable();
    connection.open();
    connection.stop();

    connection.open();

    assert.equal(sockets.length, 2);
  });
});

// En el navegador, close() no emite 'close' en el acto: el evento llega despues. Al mudarse
// de sala (stop y open seguidos) ese evento tardio del socket anterior no debe abrir otro.
describe('ServerConnection: reabrir con el cierre anterior pendiente', () => {
  class DeferredCloseSocket extends FakeSocket {
    close() {
      this.readyState = 2;
    }
  }

  function setupDeferred() {
    const sockets = [];
    const scheduled = [];
    const statuses = [];
    const received = [];
    const connection = new ServerConnection({
      url: 'ws://chat.test',
      createSocket(url) {
        const socket = new DeferredCloseSocket(url);
        sockets.push(socket);
        return socket;
      },
      schedule: (callback) => scheduled.push(callback),
      onData: (data) => received.push(data),
      onStatus: (status) => statuses.push(status),
    });
    return { connection, sockets, scheduled, statuses, received };
  }

  function reopenWithPendingClose(state) {
    state.connection.open();
    state.sockets[0].simulateOpen();
    state.connection.stop();
    state.connection.open();
    state.sockets[1].simulateOpen();
    state.sockets[0].simulateClose();
  }

  it('el cierre tardio del socket anterior no programa una reconexion', () => {
    const state = setupDeferred();

    reopenWithPendingClose(state);
    state.scheduled.forEach((reconnect) => reconnect());

    assert.equal(state.sockets.length, 2);
    assert.deepEqual(state.statuses, ['online', 'online']);
  });

  it('solo entrega los datos del socket actual', () => {
    const state = setupDeferred();

    reopenWithPendingClose(state);
    state.sockets[0].simulateData('de la sala anterior');
    state.sockets[1].simulateData('de la sala nueva');

    assert.deepEqual(state.received, ['de la sala nueva']);
  });

  it('sigue reconectando si se cae el socket actual', () => {
    const state = setupDeferred();

    reopenWithPendingClose(state);
    state.sockets[1].simulateClose();
    state.scheduled.forEach((reconnect) => reconnect());

    assert.equal(state.sockets.length, 3);
    assert.deepEqual(state.statuses, ['online', 'online', 'reconnecting']);
  });
});
