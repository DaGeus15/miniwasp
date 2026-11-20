import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAddressReader } from '../../src/server/security/client-address.js';
import {
  ConnectionGuard,
  DEFAULT_MAX_CONNECTIONS_PER_ADDRESS,
} from '../../src/server/security/connection-guard.js';
import { isSameOrigin } from '../../src/server/security/origin-guard.js';
import { createRateLimiter } from '../../src/server/security/rate-limiter.js';

describe('isSameOrigin', () => {
  it('acepta el mismo host y puerto', () => {
    assert.equal(isSameOrigin('http://localhost:3000', 'localhost:3000'), true);
    assert.equal(isSameOrigin('https://chat.test', 'chat.test'), true);
  });

  it('rechaza otro host u otro puerto', () => {
    assert.equal(isSameOrigin('http://atacante.test', 'localhost:3000'), false);
    assert.equal(isSameOrigin('http://localhost:4000', 'localhost:3000'), false);
  });

  it('rechaza origenes que no son una URL valida', () => {
    assert.equal(isSameOrigin('null', 'localhost:3000'), false);
  });

  it('permite clientes que no son navegadores', () => {
    assert.equal(isSameOrigin(undefined, 'localhost:3000'), true);
  });
});

describe('createRateLimiter', () => {
  function setup(options) {
    const clock = { time: 0 };
    const limiter = createRateLimiter({ now: () => clock.time, ...options });
    return { clock, limiter };
  }

  it('permite hasta el limite y rechaza el resto', () => {
    const { limiter } = setup({ limit: 2, windowMs: 1000 });

    assert.deepEqual(
      [limiter.allow('ana'), limiter.allow('ana'), limiter.allow('ana')],
      [true, true, false],
    );
  });

  it('cuenta a cada cliente por separado', () => {
    const { limiter } = setup({ limit: 1, windowMs: 1000 });

    assert.equal(limiter.allow('ana'), true);
    assert.equal(limiter.allow('ana'), false);
    assert.equal(limiter.allow('luis'), true);
  });

  it('vuelve a permitir mensajes cuando termina la ventana', () => {
    const { clock, limiter } = setup({ limit: 1, windowMs: 1000 });
    limiter.allow('ana');
    assert.equal(limiter.allow('ana'), false);

    clock.time = 999;
    assert.equal(limiter.allow('ana'), false);

    clock.time = 1000;
    assert.equal(limiter.allow('ana'), true);
  });

  it('olvida a los clientes cuya ventana ya vencio', () => {
    const { clock, limiter } = setup({ limit: 1, windowMs: 1000 });
    limiter.allow('ana');
    limiter.allow('luis');
    assert.equal(limiter.trackedClients, 2);

    clock.time = 1000;
    limiter.allow('rosa');

    assert.equal(limiter.trackedClients, 1);
  });

  it('funciona con los valores por defecto', () => {
    assert.equal(createRateLimiter().allow('ana'), true);
  });
});

describe('ConnectionGuard', () => {
  function admitAndTrack(guard, address) {
    const isAdmitted = guard.admits(address);
    if (isAdmitted) {
      guard.track(address);
    }
    return isAdmitted;
  }

  it('limita las conexiones por direccion', () => {
    const guard = new ConnectionGuard({ maxConnectionsPerAddress: 1 });

    assert.equal(admitAndTrack(guard, 'ana'), true);
    assert.equal(admitAndTrack(guard, 'ana'), false);
    assert.equal(admitAndTrack(guard, 'luis'), true);
  });

  it('limita el total de conexiones', () => {
    const guard = new ConnectionGuard({ maxConnections: 1 });

    assert.equal(admitAndTrack(guard, 'ana'), true);
    assert.equal(admitAndTrack(guard, 'luis'), false);
  });

  it('libera el cupo al desconectarse', () => {
    const guard = new ConnectionGuard({ maxConnections: 2, maxConnectionsPerAddress: 2 });
    guard.track('ana');
    guard.track('ana');
    assert.equal(guard.admits('ana'), false);

    guard.release('ana');
    assert.equal(guard.admits('ana'), true);

    guard.release('ana');
    assert.equal(guard.admits('ana'), true);
  });

  it('al liberar una conexion conserva la cuenta de las que siguen abiertas', () => {
    const guard = new ConnectionGuard({ maxConnectionsPerAddress: 2 });
    guard.track('ana');
    guard.track('ana');

    guard.release('ana');
    guard.track('ana');

    assert.equal(guard.admits('ana'), false);
  });

  it('permite que varias computadoras compartan una IP', () => {
    const guard = new ConnectionGuard();

    assert.equal(guard.admits('ip-compartida'), true);
    assert.ok(DEFAULT_MAX_CONNECTIONS_PER_ADDRESS > 2);
  });
});

describe('createAddressReader', () => {
  const request = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'cf-connecting-ip': '203.0.113.1', 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '6.6.6.6' },
  };

  it('por defecto usa la direccion del socket y no confia en cabeceras', () => {
    assert.equal(createAddressReader()(request), '127.0.0.1');
  });

  it('detras de Cloudflare usa la direccion real', () => {
    assert.equal(createAddressReader({ trustedProxyHeader: 'cf-connecting-ip' })(request), '203.0.113.1');
  });

  it('detras de Railway usa X-Real-IP', () => {
    assert.equal(createAddressReader({ trustedProxyHeader: 'x-real-ip' })(request), '198.51.100.7');
  });

  it('nunca confia en X-Forwarded-For ni en cabeceras desconocidas', () => {
    assert.equal(createAddressReader({ trustedProxyHeader: 'x-forwarded-for' })(request), '127.0.0.1');
  });

  it('usa el socket si falta la cabecera o no es una IP valida', () => {
    const readAddress = createAddressReader({ trustedProxyHeader: 'x-real-ip' });

    assert.equal(readAddress({ ...request, headers: {} }), '127.0.0.1');
    assert.equal(readAddress({ ...request, headers: { 'x-real-ip': 'no-es-ip' } }), '127.0.0.1');
    assert.equal(readAddress({ ...request, headers: { 'x-real-ip': '1.2.3.4, 5.6.7.8' } }), '127.0.0.1');
  });
});
