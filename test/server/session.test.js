import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createExpiredSessionCookie,
  createSessionCookie,
  readSessionToken,
} from '../../src/server/security/session-cookie.js';
import { DEFAULT_SESSION_TTL_MS, SessionStore } from '../../src/server/security/session-store.js';

function setupStore(options = {}) {
  const clock = { time: 0 };
  const store = new SessionStore({ ttlMs: 1000, now: () => clock.time, ...options });
  return { clock, store };
}

describe('SessionStore', () => {
  it('crea tokens aleatorios de 256 bits', () => {
    const { store } = setupStore();
    const first = store.create();
    const second = store.create();

    assert.match(first.token, /^[\w-]{43}$/);
    assert.notEqual(first.token, second.token);
    assert.notEqual(first.session.id, second.session.id);
  });

  it('encuentra la sesion con su token', () => {
    const { store } = setupStore();
    const { token, session } = store.create();

    assert.equal(store.find(token), session);
    assert.equal(store.isActive(session.id), true);
  });

  it('no encuentra tokens inventados ni ausentes', () => {
    const { store } = setupStore();
    store.create();

    assert.equal(store.find('inventado'), null);
    assert.equal(store.find(null), null);
    assert.equal(store.find(undefined), null);
    assert.equal(store.isActive('sesion-inexistente'), false);
  });

  it('vence las sesiones al cumplirse su tiempo', () => {
    const { clock, store } = setupStore();
    const { token, session } = store.create();

    clock.time = 999;
    assert.equal(store.find(token), session);

    clock.time = 1000;
    assert.equal(store.isActive(session.id), false);
    assert.equal(store.find(token), null);
  });

  it('revocar invalida la sesion de inmediato', () => {
    const { store } = setupStore();
    const { token, session } = store.create();

    store.revoke(token);
    store.revoke(null);

    assert.equal(store.find(token), null);
    assert.equal(store.isActive(session.id), false);
  });

  it('SEC-008: rechaza sesiones nuevas al llegar al maximo sin desalojar a nadie', () => {
    const { store } = setupStore({ maxSessions: 2 });
    const first = store.create();
    const second = store.create();

    assert.equal(store.create(), null);
    assert.ok(store.find(first.token));
    assert.ok(store.find(second.token));
  });

  it('libera cupo cuando vencen las sesiones', () => {
    const { clock, store } = setupStore({ maxSessions: 1 });
    store.create();
    clock.time = 1000;

    assert.ok(store.create());
  });

  it('guarda los atributos de la sesion y no permite cambiarlos', () => {
    const { store } = setupStore();
    const { session } = store.create({ roomId: 'sala-1', isOwner: true });

    assert.equal(session.roomId, 'sala-1');
    assert.equal(session.isOwner, true);
    assert.equal(Object.isFrozen(session), true);
  });

  it('los atributos no pueden reemplazar el id ni el vencimiento', () => {
    const { store } = setupStore();
    const { session } = store.create({ id: 'elegido', expiresAt: Infinity });

    assert.notEqual(session.id, 'elegido');
    assert.equal(session.expiresAt, 1000);
  });

  it('revoca todas las sesiones que cumplan una condicion', () => {
    const { store } = setupStore();
    const inRoom = store.create({ roomId: 'sala-1' });
    const elsewhere = store.create({ roomId: 'sala-2' });

    store.revokeWhere((candidate) => candidate.roomId === 'sala-1');

    assert.equal(store.find(inRoom.token), null);
    assert.ok(store.find(elsewhere.token));
  });

  it('dura ocho horas por defecto', () => {
    assert.equal(new SessionStore().ttlMs, DEFAULT_SESSION_TTL_MS);
    assert.equal(DEFAULT_SESSION_TTL_MS, 8 * 60 * 60 * 1000);
  });
});

describe('cookie de sesion', () => {
  it('lee el token entre otras cookies', () => {
    const request = { headers: { cookie: 'tema=oscuro; miniwasp_session=abc123; otra=1' } };

    assert.equal(readSessionToken(request), 'abc123');
  });

  it('devuelve null si no hay cookie de sesion', () => {
    assert.equal(readSessionToken({ headers: {} }), null);
    assert.equal(readSessionToken({ headers: { cookie: 'tema=oscuro' } }), null);
  });

  it('protege la cookie contra robo y envio desde otros sitios', () => {
    const cookie = createSessionCookie('token', 60000);

    assert.equal(
      cookie,
      'miniwasp_session=token; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=60',
    );
  });

  it('borra la cookie al salir', () => {
    assert.match(createExpiredSessionCookie(), /^miniwasp_session=; .*Max-Age=0$/);
  });
});
