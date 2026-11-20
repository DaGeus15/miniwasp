import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MessageRouter } from '../../src/server/messaging/message-router.js';
import { Metric, Metrics } from '../../src/server/observability/metrics.js';
import { ValidationError } from '../../src/server/validation.js';

const allowAll = { allow: () => true };
const denyAll = { allow: () => false };

function setup({ limiter = allowAll, handle = () => {} } = {}) {
  const handled = [];
  const errors = [];
  const loggedErrors = [];
  const metrics = new Metrics();
  const logger = {
    error: (event, error, fields) => loggedErrors.push({ event, error, fields }),
  };
  const peer = {
    id: 'peer-1',
    address: '10.0.0.1',
    sendError: (error) => errors.push(error),
  };
  const createRoute = (name, routeLimiter = allowAll) => ({
    limiter: routeLimiter,
    handle(_peer, payload) {
      handled.push([name, payload]);
      handle();
    },
  });
  const router = new MessageRouter({
    routes: new Map([
      ['ping', createRoute('ping', limiter)],
      ['chat-message', createRoute('chat')],
    ]),
    fallbackLimiter: allowAll,
    logger,
    metrics,
  });

  return { router, peer, handled, errors, loggedErrors, metrics };
}

describe('MessageRouter', () => {
  it('envia cada tipo a su ruta', () => {
    const { router, peer, handled } = setup();

    router.dispatch(peer, '{"type":"ping"}');

    assert.deepEqual(handled, [['ping', { type: 'ping' }]]);
  });

  it('rechaza mensajes sin tipo sin ejecutar ninguna ruta', () => {
    const { router, peer, handled, errors } = setup();

    router.dispatch(peer, '{"text":"hola"}');

    assert.deepEqual(handled, []);
    assert.deepEqual(errors, ['Mensaje no reconocido']);
  });

  it('rechaza JSON corrupto sin ejecutar ninguna ruta', () => {
    const { router, peer, handled, errors } = setup();

    router.dispatch(peer, 'no es json');

    assert.deepEqual(handled, []);
    assert.deepEqual(errors, ['Mensaje no reconocido']);
  });

  it('rechaza tipos desconocidos sin ejecutar ninguna ruta', () => {
    const { router, peer, handled, errors, loggedErrors } = setup();

    router.dispatch(peer, '{"type":"constructor"}');

    assert.deepEqual(handled, []);
    assert.deepEqual(errors, ['Mensaje no reconocido']);
    assert.deepEqual(loggedErrors, [], 'un error de validacion no es un fallo interno');
  });

  it('aplica el limite de cada ruta antes de ejecutarla', () => {
    const { router, peer, handled, errors, metrics } = setup({ limiter: denyAll });

    router.dispatch(peer, '{"type":"ping"}');

    assert.deepEqual(handled, []);
    assert.match(errors[0], /muy rápido/);
    assert.equal(metrics.snapshot()[Metric.MESSAGES_RATE_LIMITED], 1);
  });

  it('cuenta el limite por la direccion de la persona', () => {
    const keys = [];
    const { router, peer } = setup({
      limiter: {
        allow(key) {
          keys.push(key);
          return true;
        },
      },
    });

    router.dispatch(peer, '{"type":"ping"}');

    assert.deepEqual(keys, ['10.0.0.1']);
  });

  it('muestra al usuario los errores de validacion', () => {
    const { router, peer, errors } = setup({
      handle() {
        throw new ValidationError('El nombre no puede estar vacio');
      },
    });

    router.dispatch(peer, '{"type":"ping"}');

    assert.deepEqual(errors, ['El nombre no puede estar vacio']);
  });

  it('oculta el detalle de los errores inesperados y los registra', () => {
    const { router, peer, errors, loggedErrors, metrics } = setup({
      handle() {
        throw new Error('detalle interno secreto');
      },
    });

    router.dispatch(peer, '{"type":"ping"}');

    assert.deepEqual(errors, ['No se pudo procesar el mensaje']);
    assert.equal(loggedErrors[0].event, 'message.failed');
    assert.equal(loggedErrors[0].error.message, 'detalle interno secreto');
    assert.deepEqual(loggedErrors[0].fields, { peerId: 'peer-1' });
    assert.equal(metrics.snapshot()[Metric.MESSAGES_FAILED], 1);
  });
});
