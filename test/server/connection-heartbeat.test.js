import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { ConnectionHeartbeat } from '../../src/server/peers/connection-heartbeat.js';

class FakeServerSocket extends EventEmitter {
  pings = 0;
  isTerminated = false;

  ping() {
    this.pings += 1;
  }

  terminate() {
    this.isTerminated = true;
  }
}

class ResponsiveSocket extends FakeServerSocket {
  ping() {
    super.ping();
    this.emit('pong');
  }
}

function setup({ socket = new FakeServerSocket(), ...options } = {}) {
  const heartbeat = new ConnectionHeartbeat(new Set([socket]), options);
  heartbeat.watch(socket);
  return { socket, heartbeat };
}

describe('ConnectionHeartbeat', () => {
  it('envia un ping a cada conexion', () => {
    const { socket, heartbeat } = setup();

    heartbeat.beat();

    assert.equal(socket.pings, 1);
    assert.equal(socket.isTerminated, false);
  });

  it('mantiene a quien responde', () => {
    const { socket, heartbeat } = setup();

    heartbeat.beat();
    socket.emit('pong');
    heartbeat.beat();

    assert.equal(socket.pings, 2);
    assert.equal(socket.isTerminated, false);
  });

  it('cierra a quien dejo de responder', () => {
    const { socket, heartbeat } = setup();

    heartbeat.beat();
    heartbeat.beat();

    assert.equal(socket.pings, 1);
    assert.equal(socket.isTerminated, true);
  });

  it('ejecuta la tarea periodica en cada latido', () => {
    let beats = 0;
    const { heartbeat } = setup({ onBeat: () => (beats += 1) });

    heartbeat.beat();
    heartbeat.beat();

    assert.equal(beats, 2);
  });

  it('late periodicamente hasta que se detiene', async () => {
    const { socket, heartbeat } = setup({ socket: new ResponsiveSocket(), intervalMs: 5 });

    heartbeat.start();
    await wait(30);
    heartbeat.stop();

    const pingsAfterStop = socket.pings;
    assert.ok(pingsAfterStop >= 1);
    await wait(20);
    assert.equal(socket.pings, pingsAfterStop);
  });
});
