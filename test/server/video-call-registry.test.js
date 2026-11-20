import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VIDEO_CALL_CAPACITY, VideoCallStatus } from '../../src/server/api/video-call.js';
import { VideoCallRefusal, VideoCallRegistry } from '../../src/server/api/video-call-registry.js';

const FIXED_TIME = Date.parse('2026-11-18T12:00:00.000Z');

function person(id, roomId = 'sala-1') {
  return { id, name: `Persona ${id}`, roomId };
}

function createRegistry() {
  return new VideoCallRegistry({ now: () => FIXED_TIME });
}

describe('VideoCallRegistry', () => {
  it('crea una llamada en espera con quien la inicia dentro', () => {
    const registry = createRegistry();

    const { call } = registry.start(person('ana'));

    assert.deepEqual(call.toPublic(), {
      id: call.id,
      status: VideoCallStatus.WAITING,
      capacity: VIDEO_CALL_CAPACITY,
      participants: [{ id: 'ana', name: 'Persona ana', joinedAt: '2026-11-18T12:00:00.000Z' }],
      createdAt: '2026-11-18T12:00:00.000Z',
    });
    assert.equal(registry.callOf('ana'), call);
  });

  it('activa la llamada cuando entra la segunda persona', () => {
    const registry = createRegistry();
    const { call } = registry.start(person('ana'));

    const result = registry.join(person('luis'), call.id);

    assert.equal(result.call, call);
    assert.equal(call.toPublic().status, VideoCallStatus.ACTIVE);
  });

  it('rechaza a una tercera persona porque la llamada esta llena', () => {
    const registry = createRegistry();
    const { call } = registry.start(person('ana'));
    registry.join(person('luis'), call.id);

    assert.deepEqual(registry.join(person('carla'), call.id), { refusal: VideoCallRefusal.FULL });
    assert.equal(registry.callOf('carla'), null);
  });

  it('acepta volver a entrar a la misma llamada sin duplicar a la persona', () => {
    const registry = createRegistry();
    const { call } = registry.start(person('ana'));

    assert.equal(registry.join(person('ana'), call.id).call, call);
    assert.equal(call.toPublic().participants.length, 1);
  });

  it('impide estar en dos llamadas a la vez', () => {
    const registry = createRegistry();
    registry.start(person('ana'));
    const { call: other } = registry.start(person('luis'));

    assert.deepEqual(registry.start(person('ana')), { refusal: VideoCallRefusal.BUSY });
    assert.deepEqual(registry.join(person('ana'), other.id), { refusal: VideoCallRefusal.BUSY });
  });

  it('oculta las llamadas de otras salas como si no existieran', () => {
    const registry = createRegistry();
    const { call } = registry.start(person('ana'));
    const outsider = person('eva', 'sala-2');

    assert.equal(registry.find(outsider, call.id), null);
    assert.deepEqual(registry.join(outsider, call.id), { refusal: VideoCallRefusal.NOT_FOUND });
    assert.deepEqual(registry.leave(outsider, call.id), { refusal: VideoCallRefusal.NOT_FOUND });
  });

  it('solo deja salir a quien participa y borra la llamada al quedar vacia', () => {
    const registry = createRegistry();
    const { call } = registry.start(person('ana'));

    assert.deepEqual(registry.leave(person('luis'), call.id), { refusal: VideoCallRefusal.NOT_PARTICIPANT });
    assert.equal(registry.leave(person('ana'), call.id).call, call);
    assert.equal(registry.find(person('ana'), call.id), null);
  });

  it('libera un lugar cuando alguien sale de una llamada llena', () => {
    const registry = createRegistry();
    const { call } = registry.start(person('ana'));
    registry.join(person('luis'), call.id);

    registry.leaveAll('luis');

    assert.equal(registry.join(person('carla'), call.id).call, call);
    assert.equal(registry.callOf('luis'), null);
  });

  it('ignora leaveAll de alguien que no esta en ninguna llamada', () => {
    const registry = createRegistry();

    assert.doesNotThrow(() => registry.leaveAll('nadie'));
  });

  it('cierra todas las llamadas de una sala y solo las de esa sala', () => {
    const registry = createRegistry();
    const { call } = registry.start(person('ana'));
    registry.join(person('luis'), call.id);
    const { call: other } = registry.start(person('eva', 'sala-2'));

    registry.closeRoom('sala-1');

    assert.equal(registry.callOf('ana'), null);
    assert.equal(registry.callOf('luis'), null);
    assert.equal(registry.find(person('ana'), call.id), null);
    assert.equal(registry.callOf('eva'), other);
  });
});
