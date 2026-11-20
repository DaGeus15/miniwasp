import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../../src/server/config.js';
import { listLanAddresses } from '../../src/server/lan-addresses.js';

const baseEnv = {};

describe('loadConfig', () => {
  it('usa valores seguros por defecto', () => {
    assert.deepEqual(loadConfig(baseEnv), {
      port: 3000,
      host: '127.0.0.1',
      tls: null,
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      trustedProxyHeader: null,
      objectStorage: null,
    });
  });

  it('lee y valida el puerto', () => {
    assert.equal(loadConfig({ ...baseEnv, PORT: '8080' }).port, 8080);
    for (const port of ['abc', '-1', '70000', '3.5']) {
      assert.throws(() => loadConfig({ ...baseEnv, PORT: port }), /PORT/);
    }
  });

  it('solo escucha fuera de esta maquina si HOST lo pide, aun con TLS', () => {
    const tlsEnv = { ...baseEnv, TLS_CERT_FILE: 'cert.pem', TLS_KEY_FILE: 'key.pem' };
    const readFile = () => 'contenido';

    assert.equal(loadConfig(tlsEnv, readFile).host, '127.0.0.1');
    assert.equal(loadConfig({ ...baseEnv, HOST: '0.0.0.0' }).host, '0.0.0.0');
  });

  it('solo confia en un proxy si se declara su cabecera explicitamente', () => {
    assert.equal(loadConfig({ ...baseEnv, TRUSTED_PROXY_HEADER: 'X-Real-IP' }).trustedProxyHeader, 'x-real-ip');
    assert.equal(
      loadConfig({ ...baseEnv, TRUSTED_PROXY_HEADER: 'cf-connecting-ip' }).trustedProxyHeader,
      'cf-connecting-ip',
    );
    assert.equal(loadConfig({ ...baseEnv, TRUSTED_PROXY_HEADER: '' }).trustedProxyHeader, null);
  });

  it('rechaza al arrancar cabeceras de proxy que se pueden falsificar', () => {
    for (const header of ['x-forwarded-for', 'forwarded', 'true']) {
      assert.throws(() => loadConfig({ ...baseEnv, TRUSTED_PROXY_HEADER: header }), /TRUSTED_PROXY_HEADER/);
    }
  });

  it('admite varios servidores STUN', () => {
    const { iceServers } = loadConfig({ ...baseEnv, STUN_URLS: 'stun:a.test:3478, stuns:b.test' });

    assert.deepEqual(iceServers, [{ urls: 'stun:a.test:3478' }, { urls: 'stuns:b.test' }]);
  });

  it('permite desactivar STUN para una red aislada', () => {
    assert.deepEqual(loadConfig({ ...baseEnv, STUN_URLS: '' }).iceServers, []);
  });

  it('rechaza URLs STUN invalidas al arrancar', () => {
    for (const url of ['http://a.test', 'stun:', 'stun:a b', 'stun:a.test:abc']) {
      assert.throws(() => loadConfig({ ...baseEnv, STUN_URLS: url }), /STUN_URLS/);
    }
  });

  it('carga el certificado TLS', () => {
    const { tls } = loadConfig(
      { ...baseEnv, TLS_CERT_FILE: 'cert.pem', TLS_KEY_FILE: 'key.pem' },
      (path) => `contenido de ${path}`,
    );

    assert.deepEqual(tls, { cert: 'contenido de cert.pem', key: 'contenido de key.pem' });
  });

  it('exige el certificado y la clave juntos', () => {
    assert.throws(() => loadConfig({ ...baseEnv, TLS_CERT_FILE: 'cert.pem' }), /TLS_KEY_FILE/);
    assert.throws(() => loadConfig({ ...baseEnv, TLS_KEY_FILE: 'key.pem' }), /TLS_CERT_FILE/);
  });
});

describe('listLanAddresses', () => {
  it('devuelve solo las IPv4 externas', () => {
    const addresses = listLanAddresses({
      loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      wifi: [
        { family: 'IPv6', internal: false, address: 'fe80::1' },
        { family: 'IPv4', internal: false, address: '192.168.1.20' },
      ],
      ethernet: [{ family: 'IPv4', internal: false, address: '10.0.0.5' }],
    });

    assert.deepEqual(addresses, ['192.168.1.20', '10.0.0.5']);
  });

  it('lee las interfaces del sistema por defecto', () => {
    assert.ok(Array.isArray(listLanAddresses()));
  });
});

describe('loadConfig: bucket y capacidad', () => {
  const bucketEnv = {
    S3_ENDPOINT: 'https://storage.test',
    S3_BUCKET: 'adjuntos',
    S3_ACCESS_KEY_ID: 'id',
    S3_SECRET_ACCESS_KEY: 'secreto',
  };

  it('lee el bucket completo con region y estilo de URL por defecto', () => {
    assert.deepEqual(loadConfig(bucketEnv).objectStorage, {
      endpoint: 'https://storage.test',
      bucket: 'adjuntos',
      region: 'auto',
      accessKeyId: 'id',
      secretAccessKey: 'secreto',
      forcePathStyle: false,
    });
    assert.equal(loadConfig({ ...bucketEnv, S3_REGION: 'sjc', S3_FORCE_PATH_STYLE: 'true' }).objectStorage.forcePathStyle, true);
  });

  it('en produccion no arranca sin bucket, y nunca con un bucket a medias o sin HTTPS', () => {
    assert.equal(loadConfig({}).objectStorage, null);
    assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /bucket/);
    assert.throws(() => loadConfig({ S3_BUCKET: 'adjuntos' }), /juntas/);
    assert.throws(() => loadConfig({ ...bucketEnv, S3_ENDPOINT: 'http://storage.test' }), /https/);
    assert.throws(() => loadConfig({ ...bucketEnv, S3_ENDPOINT: 'no es url' }), /https/);
  });

  it('lee los topes de capacidad como enteros positivos y omite los vacios', () => {
    const config = loadConfig({ MAX_CONNECTIONS: '500', MAX_SESSIONS: '900', MAX_ROOMS: '50', UPLOAD_CONCURRENCY: '8', IMAGE_MODERATION_WORKERS: '2' });

    assert.deepEqual(
      [config.maxConnections, config.maxSessions, config.maxRooms, config.uploadConcurrency, config.imageModerationWorkers],
      [500, 900, 50, 8, 2],
    );
    assert.equal('maxRooms' in loadConfig({ MAX_ROOMS: '' }), false);
    for (const value of ['0', '-3', '2.5', 'muchas']) {
      assert.throws(() => loadConfig({ MAX_ROOMS: value }), /MAX_ROOMS/);
    }
  });
});
