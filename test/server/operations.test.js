import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { installProcessHandlers } from '../../src/server/graceful-shutdown.js';
import { Logger } from '../../src/server/observability/logger.js';
import { Metric, Metrics } from '../../src/server/observability/metrics.js';
import { ValidationError, requireName } from '../../src/server/validation.js';
import { flushPromises } from '../support/async.js';

const FIXED_TIME = new Date('2026-11-11T10:00:00.000Z');

function createLogger(context) {
  const lines = [];
  const logger = new Logger({ write: (line) => lines.push(JSON.parse(line)), now: () => FIXED_TIME, context });
  return { logger, lines };
}

describe('Logger', () => {
  it('escribe una linea JSON por evento con hora y nivel', () => {
    const { logger, lines } = createLogger();

    logger.info('server.started', { port: 3000 });
    logger.warn('session.login.denied');

    assert.deepEqual(lines, [
      { time: FIXED_TIME.toISOString(), level: 'info', event: 'server.started', port: 3000 },
      { time: FIXED_TIME.toISOString(), level: 'warn', event: 'session.login.denied' },
    ]);
  });

  it('incluye el detalle del error para diagnosticarlo', () => {
    const { logger, lines } = createLogger();

    logger.error('message.failed', new TypeError('fallo'), { peerId: 'p1' });

    assert.equal(lines[0].level, 'error');
    assert.equal(lines[0].errorName, 'TypeError');
    assert.equal(lines[0].errorMessage, 'fallo');
    assert.match(lines[0].errorStack, /TypeError: fallo/);
    assert.equal(lines[0].peerId, 'p1');
  });

  it('hereda el contexto en los registros hijos', () => {
    const { logger, lines } = createLogger({ service: 'miniwasp' });

    logger.child({ peerId: 'p1' }).info('connection.opened');

    assert.equal(lines[0].service, 'miniwasp');
    assert.equal(lines[0].peerId, 'p1');
  });

  it('escribe en la salida estandar por defecto', (context) => {
    const written = [];
    context.mock.method(process.stdout, 'write', (line) => written.push(line));

    new Logger().info('prueba');

    assert.match(written[0], /"event":"prueba"/);
    assert.ok(written[0].endsWith('\n'));
  });
});

describe('Metrics', () => {
  it('suma y resta contadores', () => {
    const metrics = new Metrics();

    metrics.increment(Metric.CONNECTIONS_ACTIVE);
    metrics.increment(Metric.CONNECTIONS_ACTIVE);
    metrics.decrement(Metric.CONNECTIONS_ACTIVE);
    metrics.increment(Metric.CALLS_STARTED);

    assert.deepEqual(metrics.snapshot(), {
      [Metric.CONNECTIONS_ACTIVE]: 1,
      [Metric.CALLS_STARTED]: 1,
    });
  });

  it('entrega una copia que no altera los contadores', () => {
    const metrics = new Metrics();
    metrics.increment(Metric.CALLS_STARTED);

    metrics.snapshot()[Metric.CALLS_STARTED] = 99;

    assert.equal(metrics.snapshot()[Metric.CALLS_STARTED], 1);
  });
});

describe('requireName', () => {
  it('normaliza variantes visuales del mismo caracter', () => {
    assert.equal(requireName('Ａｎａ'), 'Ana');
  });

  it('rechaza caracteres de control y marcas invisibles de direccion', () => {
    for (const name of ['Ana\u0000', 'Ana\u202Enaul', 'An\u200Ba']) {
      assert.throws(() => requireName(name), ValidationError);
    }
  });
});

describe('installProcessHandlers', () => {
  function setup({ closeServer = async () => {} } = {}) {
    const runtime = Object.assign(new EventEmitter(), { exitCodes: [] });
    runtime.exit = (code) => runtime.exitCodes.push(code);
    const { logger, lines } = createLogger();
    const server = { closes: 0 };
    server.close = async () => {
      server.closes += 1;
      await closeServer();
    };
    installProcessHandlers({ server, logger, runtime });
    return { runtime, server, lines };
  }

  it('cierra el servidor y termina bien ante SIGTERM', async () => {
    const { runtime, server, lines } = setup();

    runtime.emit('SIGTERM');
    await flushPromises();

    assert.equal(server.closes, 1);
    assert.deepEqual(runtime.exitCodes, [0]);
    assert.equal(lines.at(-1).event, 'server.stopped');
  });

  it('no cierra dos veces si llegan varias senales', async () => {
    const { runtime, server } = setup();

    runtime.emit('SIGINT');
    runtime.emit('SIGTERM');
    await flushPromises();

    assert.equal(server.closes, 1);
  });

  it('registra un error no previsto y termina con fallo', async () => {
    const { runtime, lines } = setup();

    runtime.emit('uncaughtException', new Error('inesperado'));
    await flushPromises();

    assert.equal(lines[0].event, 'server.fatal');
    assert.equal(lines[0].errorMessage, 'inesperado');
    assert.deepEqual(runtime.exitCodes, [1]);
  });

  it('trata igual una promesa rechazada sin manejar', async () => {
    const { runtime } = setup();

    runtime.emit('unhandledRejection', new Error('promesa'));
    await flushPromises();

    assert.deepEqual(runtime.exitCodes, [1]);
  });
});
