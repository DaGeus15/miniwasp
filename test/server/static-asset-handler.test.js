import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../../src/server/http/http-error.js';
import { HttpResponder } from '../../src/server/http/http-responder.js';
import { PUBLIC_ASSETS } from '../../src/server/http/public-assets.js';
import { createSecurityHeaders } from '../../src/server/http/security-headers.js';
import { StaticAssetHandler } from '../../src/server/http/static-asset-handler.js';

const SOURCE_DIRECTORY = fileURLToPath(new URL('../../src/', import.meta.url));

class FakeResponse {
  statusCode = null;
  headers = null;
  body = null;

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
  }

  end(body) {
    this.body = body;
  }
}

function createHandler(rootDirectory = SOURCE_DIRECTORY) {
  return new StaticAssetHandler({
    rootDirectory,
    assets: PUBLIC_ASSETS,
    responder: new HttpResponder(createSecurityHeaders({ isHttps: false })),
  });
}

async function request(handler, pathname, method = 'GET') {
  const response = new FakeResponse();
  await handler.handle({ method }, response, pathname);
  return response;
}

describe('StaticAssetHandler', () => {
  const handler = createHandler();

  it('sirve los archivos de la lista con su tipo y cabeceras de seguridad', async () => {
    const response = await request(handler, '/');

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['Content-Type'], /text\/html/);
    assert.match(response.headers['Content-Security-Policy'], /default-src 'none'/);
    assert.match(response.body.toString(), /<title>MiniWasp/);
  });

  it('obliga a revalidar los archivos para no servir versiones viejas', async () => {
    const response = await request(handler, '/client/app.js');

    assert.match(response.headers['Cache-Control'], /no-cache/);
  });

  it('responde HEAD como GET', async () => {
    assert.equal((await request(handler, '/', 'HEAD')).statusCode, 200);
  });

  it('no sale de la lista cerrada', async () => {
    const attempts = ['/../package.json', '/%2e%2e/package.json', '/.env', '/server/index.js'];

    for (const pathname of attempts) {
      await assert.rejects(request(handler, pathname), (error) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 404);
        return true;
      });
    }
  });

  it('rechaza metodos de escritura indicando los permitidos', async () => {
    const response = await request(handler, '/', 'POST');

    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.Allow, 'GET, HEAD');
  });

  it('propaga el error si no puede leer un archivo para que se registre', async () => {
    await assert.rejects(request(createHandler('/no/existe'), '/'), { code: 'ENOENT' });
  });
});
