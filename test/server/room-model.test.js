import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createClientReferencer } from '../../src/server/observability/client-reference.js';
import { NameBook } from '../../src/server/rooms/name-book.js';
import { DEFAULT_EMPTY_ROOM_TTL_MS, RoomRegistry } from '../../src/server/rooms/room-registry.js';
import { Room, createInviteToken } from '../../src/server/rooms/room.js';
import { createRoomCookie, createTestServer, startRoomServer } from '../support/test-server.js';
import { expectRejection, openClient, stopServer } from '../support/ws-client.js';
import { WebSocket } from 'ws';

function createManualScheduler() {
  const tasks = [];
  const schedule = (callback, delayMs) => {
    const task = { callback, delayMs, isCancelled: false };
    tasks.push(task);
    return () => {
      task.isCancelled = true;
    };
  };
  const runPending = () => tasks.filter((task) => !task.isCancelled).forEach((task) => task.callback());
  return { schedule, tasks, runPending };
}

describe('NameBook', () => {
  it('reserva un nombre para la primera sesion que lo usa, sin distinguir mayusculas', () => {
    const names = new NameBook();

    names.claim('ana', 'Ana');

    assert.equal(names.isAvailableFor('ana', 'ANA'), true);
    assert.equal(names.isAvailableFor('otra', 'ana'), false);
    assert.equal(names.isAvailableFor('otra', 'Luis'), true);
  });

  it('cada sesion tiene un solo nombre: al cambiarlo libera el anterior', () => {
    const names = new NameBook();
    names.claim('ana', 'Ana');

    names.claim('ana', 'Anita');

    assert.equal(names.isAvailableFor('otra', 'Ana'), true);
    assert.equal(names.isAvailableFor('otra', 'Anita'), false);
  });

  it('liberar una sesion devuelve su nombre y no afecta a las demas', () => {
    const names = new NameBook();
    names.claim('ana', 'Ana');
    names.claim('luis', 'Luis');

    names.release('ana');
    names.release('desconocida');

    assert.equal(names.isAvailableFor('otra', 'Ana'), true);
    assert.equal(names.isAvailableFor('otra', 'Luis'), false);
  });
});

describe('Room', () => {
  it('crea invitaciones aleatorias de 128 bits', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createInviteToken()));

    assert.equal(tokens.size, 50);
    for (const token of tokens) {
      assert.match(token, /^[\w-]{22}$/);
    }
  });

  it('renovar la invitacion la cambia', () => {
    const room = new Room();
    const previous = room.inviteToken;

    const renewed = room.rotateInvite();

    assert.notEqual(renewed, previous);
    assert.equal(room.inviteToken, renewed);
  });

  it('programa y cancela su limpieza', () => {
    const { schedule, tasks } = createManualScheduler();
    const room = new Room();

    room.scheduleCleanup(schedule, 50, () => {});
    room.scheduleCleanup(schedule, 50, () => {});
    room.cancelCleanup();

    assert.equal(tasks.length, 2);
    assert.ok(tasks.every((task) => task.isCancelled));
  });
});

describe('RoomRegistry', () => {
  it('encuentra una sala por id y por invitacion vigente', () => {
    const registry = new RoomRegistry({ schedule: () => () => {} });
    const room = registry.create();

    assert.equal(registry.find(room.id), room);
    assert.equal(registry.findByInvite(room.inviteToken), room);
    assert.equal(registry.find('no-existe'), null);
    assert.equal(registry.findByInvite('no-existe'), null);
  });

  it('una invitacion renovada deja de encontrar la sala', () => {
    const registry = new RoomRegistry({ schedule: () => () => {} });
    const room = registry.create();
    const previous = room.inviteToken;

    const renewed = registry.rotateInvite(room);

    assert.equal(registry.findByInvite(previous), null);
    assert.equal(registry.findByInvite(renewed), room);
  });

  it('cierra una sala vacia tras el tiempo de gracia y avisa', () => {
    const { schedule, tasks, runPending } = createManualScheduler();
    const closed = [];
    const registry = new RoomRegistry({ schedule, onRoomClosed: (room) => closed.push(room) });
    const room = registry.create();

    assert.equal(tasks[0].delayMs, DEFAULT_EMPTY_ROOM_TTL_MS);
    runPending();

    assert.deepEqual(closed, [room]);
    assert.equal(registry.find(room.id), null);
    assert.equal(registry.findByInvite(room.inviteToken), null);
  });

  it('una sala ocupada no se cierra', () => {
    const { schedule, runPending } = createManualScheduler();
    const closed = [];
    const registry = new RoomRegistry({ schedule, onRoomClosed: (room) => closed.push(room) });
    const room = registry.create();

    registry.markOccupied(room);
    runPending();

    assert.deepEqual(closed, []);
    assert.equal(registry.find(room.id), room);
  });

  it('rechaza crear salas por encima del maximo', () => {
    const registry = new RoomRegistry({ schedule: () => () => {}, maxRooms: 1 });

    assert.ok(registry.create());
    assert.equal(registry.create(), null);
  });
});

describe('referencia seudonima del cliente', () => {
  it('es estable para la misma direccion y distinta entre direcciones', () => {
    const reference = createClientReferencer(Buffer.alloc(32, 1));

    assert.equal(reference('203.0.113.1'), reference('203.0.113.1'));
    assert.notEqual(reference('203.0.113.1'), reference('203.0.113.2'));
    assert.match(reference('203.0.113.1'), /^[0-9a-f]{12}$/);
  });

  it('no contiene la direccion y cambia con otra clave', () => {
    const first = createClientReferencer(Buffer.alloc(32, 1));
    const second = createClientReferencer(Buffer.alloc(32, 2));

    assert.doesNotMatch(first('203.0.113.1'), /203/);
    assert.notEqual(first('203.0.113.1'), second('203.0.113.1'));
  });
});

describe('limites de capacidad del servidor', () => {
  it('SEC-001: rechaza con 503 a quien supera el tope de personas por sala', async () => {
    const room = await startRoomServer({ maxRoomMembers: 2 });
    const first = openClient(room.wsUrl, { headers: { Cookie: room.ownerCookie } });
    await first.opened;
    const second = openClient(room.wsUrl, { headers: { Cookie: await room.memberCookie() } });
    await second.opened;

    const third = new WebSocket(room.wsUrl, { headers: { Cookie: await room.memberCookie() } });
    assert.match(await expectRejection(third), /503/);

    const sameSessionTab = openClient(room.wsUrl, { headers: { Cookie: room.ownerCookie } });
    await sameSessionTab.opened;

    for (const client of [first, second, sameSessionTab]) {
      client.socket.terminate();
    }
    await stopServer(room.server);
  });

  it('SEC-007: cierra conexiones HTTP lentas y limita su numero', async () => {
    const room = await startRoomServer();
    const { listener } = room.server;

    assert.equal(listener.headersTimeout, 10000);
    assert.equal(listener.requestTimeout, 15000);
    assert.equal(listener.keepAliveTimeout, 5000);
    assert.equal(listener.maxConnections, 1000);
    assert.ok(await createRoomCookie(room.httpUrl));

    await stopServer(room.server);
  });
});

describe('RoomRegistry: barrido de salas sin uso', () => {
  it('pone en cuenta regresiva las salas que nadie usa y no toca las demas', () => {
    const { schedule, tasks } = createManualScheduler();
    const registry = new RoomRegistry({ schedule });
    const idle = registry.create();
    const busy = registry.create();
    registry.markOccupied(idle);
    registry.markOccupied(busy);

    registry.sweep((roomId) => roomId === busy.id);

    assert.equal(idle.hasScheduledCleanup, true);
    assert.equal(busy.hasScheduledCleanup, false);
    assert.equal(tasks.filter((task) => !task.isCancelled).length, 1);
  });

  it('no reprograma una sala que ya esta en cuenta regresiva', () => {
    const { schedule, tasks } = createManualScheduler();
    const registry = new RoomRegistry({ schedule });
    registry.create();

    registry.sweep(() => false);

    assert.equal(tasks.length, 1);
  });

  it('cierra una sala de la API cuando vence su ultima sesion', async () => {
    const clock = { time: 0 };
    const { SessionStore } = await import('../../src/server/security/session-store.js');
    // Sin sala previa: una sala vacia con tiempo de gracia tan corto se cerraria antes de usarse.
    const server = createTestServer({
      sessions: new SessionStore({ ttlMs: 50, now: () => clock.time }),
      heartbeatIntervalMs: 10,
      emptyRoomTtlMs: 10,
    });
    const room = { server, httpUrl: `http://127.0.0.1:${await server.listen(0, '127.0.0.1')}` };
    const login = await fetch(`${room.httpUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Api', acceptedRules: true }),
    });
    const { room: apiRoom } = await login.json();
    clock.time = 100;
    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });

    const join = await fetch(`${room.httpUrl}/rooms/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: room.httpUrl },
      body: JSON.stringify({ inviteToken: apiRoom.inviteToken, acceptedRules: true }),
    });

    assert.equal(login.status, 201);
    assert.equal(join.status, 404);
    await stopServer(room.server);
  });
});
