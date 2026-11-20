import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { HttpError } from '../../src/server/http/http-error.js';
import { HttpResponder } from '../../src/server/http/http-responder.js';
import { HttpRouter } from '../../src/server/http/http-router.js';
import { MAX_JSON_BODY_BYTES, readJsonBody } from '../../src/server/http/read-body.js';
import { createSecurityHeaders } from '../../src/server/http/security-headers.js';
import { Metric, Metrics } from '../../src/server/observability/metrics.js';

class FakeResponse {
  headers = {};
  statusCode = null;
  body = null;

  setHeader(name, value) {
    this.headers[name] = value;
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    Object.assign(this.headers, headers);
  }

  end(body) {
    this.body = body;
  }

  get json() {
    return JSON.parse(this.body);
  }
}

function createJsonRequest(body, contentType = 'application/json') {
  return Object.assign(Readable.from([Buffer.from(body)]), {
    headers: { 'content-type': contentType },
  });
}

function setupRouter({
  handler = () => {},
  fallback = async () => {},
  handlers = { GET: handler },
} = {}) {
  const loggedErrors = [];
  const metrics = new Metrics();
  const router = new HttpRouter({
    routes: new Map([['/recurso', handlers]]),
    fallback,
    responder: new HttpResponder({}),
    logger: { error: (event, error, fields) => loggedErrors.push({ event, error, fields }) },
    metrics,
  });
  const request = (url, method = 'GET') => {
    const response = new FakeResponse();
    return router.handle({ url, method }, response).then(() => response);
  };
  return { request, loggedErrors, metrics };
}

describe('HttpRouter', () => {
  it('ejecuta el manejador de la ruta y metodo pedidos', async () => {
    const calls = [];
    const { request } = setupRouter({ handler: () => calls.push('recurso') });

    await request('/recurso?x=1');

    assert.deepEqual(calls, ['recurso']);
  });

  it('delega en el respaldo las rutas no registradas', async () => {
    const pathnames = [];
    const { request } = setupRouter({ fallback: async (_req, _res, pathname) => pathnames.push(pathname) });

    await request('/client/app.js');

    assert.deepEqual(pathnames, ['/client/app.js']);
  });

  it('responde 405 con los metodos permitidos', async () => {
    const { request } = setupRouter();

    const response = await request('/recurso', 'PUT');

    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.Allow, 'GET');
  });

  it('lista todos los metodos permitidos separados por comas', async () => {
    const { request } = setupRouter({ handlers: { GET: () => {}, POST: () => {}, DELETE: () => {} } });

    const response = await request('/recurso', 'PUT');

    assert.equal(response.headers.Allow, 'GET, POST, DELETE');
  });

  it('responde 400 a una URL malformada', async () => {
    const { request } = setupRouter();

    const response = await request('//[');

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json, { error: 'Solicitud mal formada', code: 'BAD_REQUEST' });
  });

  it('traduce los errores esperados a su codigo HTTP', async () => {
    const { request, loggedErrors } = setupRouter({
      handler() {
        throw new HttpError(409, 'Conflicto');
      },
    });

    const response = await request('/recurso');

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json, { error: 'Conflicto', code: 'CONFLICT' });
    assert.deepEqual(loggedErrors, []);
  });

  it('registra los errores inesperados con su id y no revela el detalle', async () => {
    const failure = new Error('detalle interno secreto');
    const { request, loggedErrors, metrics } = setupRouter({
      handler() {
        throw failure;
      },
    });

    const response = await request('/recurso');

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json, { error: 'Error interno', code: 'INTERNAL_ERROR' });
    assert.equal(loggedErrors[0].event, 'http.request.failed');
    assert.equal(loggedErrors[0].error, failure);
    assert.equal(loggedErrors[0].fields.requestId, response.headers['X-Request-Id']);
    assert.equal(metrics.snapshot()[Metric.HTTP_ERRORS], 1);
  });
});

describe('HttpResponder', () => {
  const responder = new HttpResponder({ 'X-Seguridad': 'si' });

  it('incluye las cabeceras de seguridad en cada respuesta', () => {
    for (const send of [
      (response) => responder.json(response, 200, {}),
      (response) => responder.error(response, 400, 'mal'),
      (response) => responder.empty(response),
      (response) => responder.asset(response, 'text/plain', 'x'),
    ]) {
      const response = new FakeResponse();
      send(response);
      assert.equal(response.headers['X-Seguridad'], 'si');
    }
  });

  it('impide guardar en cache las respuestas de la API', () => {
    const response = new FakeResponse();

    responder.json(response, 200, { ok: true });

    assert.equal(response.headers['Cache-Control'], 'no-cache, no-store, must-revalidate');
    assert.match(response.headers['Content-Type'], /application\/json/);
  });

  it('responde vacio con 204 y cabeceras adicionales', () => {
    const response = new FakeResponse();

    responder.empty(response, { 'Set-Cookie': 'a=b' });

    assert.equal(response.statusCode, 204);
    assert.equal(response.headers['Set-Cookie'], 'a=b');
    assert.equal(response.body, undefined);
  });
});

describe('readJsonBody', () => {
  it('devuelve el JSON recibido', async () => {
    assert.deepEqual(await readJsonBody(createJsonRequest('{"a":1}')), { a: 1 });
  });

  it('acepta el tipo de contenido con su codificacion', async () => {
    const request = createJsonRequest('{}', 'application/json; charset=utf-8');

    assert.deepEqual(await readJsonBody(request), {});
  });

  it('rechaza otro tipo de contenido con 415', async () => {
    await assert.rejects(readJsonBody(createJsonRequest('{}', 'text/plain')), {
      statusCode: 415,
      message: 'Se esperaba JSON',
    });
    await assert.rejects(
      readJsonBody(Object.assign(Readable.from([]), { headers: {} })),
      { statusCode: 415 },
    );
  });

  it('rechaza JSON invalido con 400', async () => {
    await assert.rejects(readJsonBody(createJsonRequest('{roto')), {
      statusCode: 400,
      message: 'El contenido no es JSON válido',
    });
  });

  it('corta la lectura de cuerpos demasiado grandes con 413', async () => {
    const oversized = createJsonRequest('a'.repeat(MAX_JSON_BODY_BYTES + 1));

    await assert.rejects(readJsonBody(oversized), {
      statusCode: 413,
      message: 'La solicitud es demasiado grande',
    });
  });

  it('acepta un cuerpo que ocupa exactamente el limite', async () => {
    const body = JSON.stringify('a'.repeat(MAX_JSON_BODY_BYTES - 2));

    assert.equal((await readJsonBody(createJsonRequest(body))).length, MAX_JSON_BODY_BYTES - 2);
  });

  it('rechaza tipos simples que solo mencionan JSON en sus parametros', async () => {
    // text/plain no exige preflight CORS: aceptarlo permitiria envios desde otros sitios.
    for (const contentType of ['text/plain; charset=application/json', 'text/application/json']) {
      await assert.rejects(readJsonBody(createJsonRequest('{}', contentType)), { statusCode: 415 });
    }
  });
});

describe('createSecurityHeaders', () => {
  it('define una politica estricta sin fuentes externas', () => {
    const headers = createSecurityHeaders({ isHttps: false });

    for (const directive of [
      "default-src 'none'",
      "script-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ]) {
      assert.ok(headers['Content-Security-Policy'].includes(directive), directive);
    }
    assert.match(headers['Permissions-Policy'], /camera=\(self\)/);
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(headers['Cross-Origin-Embedder-Policy'], 'require-corp');
    assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
    assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
  });

  it('solo agrega HSTS cuando la app se publica con HTTPS', () => {
    assert.equal(createSecurityHeaders({ isHttps: false })['Strict-Transport-Security'], undefined);
    assert.match(createSecurityHeaders({ isHttps: true })['Strict-Transport-Security'], /max-age/);
  });
});

describe('HttpRouter con rutas parametrizadas y codigos de error', () => {
  function setupPatternRouter(handlers) {
    const router = new HttpRouter({
      routes: new Map(),
      patterns: [{ pattern: /^\/items\/(?<itemId>\d+)$/, handlers }],
      fallback: async () => {
        throw new HttpError(404, 'No encontrado');
      },
      responder: new HttpResponder({}),
      logger: { error() {} },
      metrics: new Metrics(),
    });
    return (url, method = 'GET') => {
      const response = new FakeResponse();
      return router.handle({ url, method }, response).then(() => response);
    };
  }

  it('entrega al handler los grupos con nombre de la ruta', async () => {
    const received = [];
    const request = setupPatternRouter({ GET: (_req, _res, params) => received.push(params) });

    await request('/items/42?x=1');

    assert.deepEqual(received, [{ itemId: '42' }]);
  });

  it('responde 405 en una ruta parametrizada con un metodo no registrado', async () => {
    const request = setupPatternRouter({ GET: () => {} });

    const response = await request('/items/1', 'DELETE');

    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.Allow, 'GET');
    assert.equal(response.json.code, 'METHOD_NOT_ALLOWED');
  });

  it('pasa al respaldo lo que no coincide con ningun patron', async () => {
    const request = setupPatternRouter({ GET: () => {} });

    const response = await request('/items/abc');

    assert.deepEqual(response.json, { error: 'No encontrado', code: 'NOT_FOUND' });
  });

  it('respeta el codigo propio de un HttpError', async () => {
    const request = setupPatternRouter({
      GET() {
        throw new HttpError(409, 'Llena', {}, 'CALL_FULL');
      },
    });

    const response = await request('/items/7');

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json, { error: 'Llena', code: 'CALL_FULL' });
  });

  it('usa un codigo generico para estados sin codigo conocido', () => {
    const response = new FakeResponse();

    new HttpResponder({}).error(response, 418, 'Tetera');

    assert.deepEqual(response.json, { error: 'Tetera', code: 'ERROR' });
  });
});
