import { request } from 'node:https';

const REQUEST_TIMEOUT_MS = 5000;

function collectResponse(response, resolve) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () =>
    resolve({
      status: response.statusCode,
      headers: response.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    }),
  );
}

// Cliente HTTPS minimo que confia solo en el certificado de desarrollo indicado:
// nunca se desactiva la validacion TLS.
export function createHttpsClient({ origin, ca }) {
  return (path, { method = 'GET', headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const outgoing = request(new URL(path, origin), { method, headers, ca, timeout: REQUEST_TIMEOUT_MS }, (response) =>
        collectResponse(response, resolve),
      );
      outgoing.on('timeout', () => outgoing.destroy(new Error(`Tiempo agotado: ${method} ${path}`)));
      outgoing.on('error', reject);
      outgoing.end(body);
    });
}

export async function requestJson(client, path, options, expectedStatus) {
  const response = await client(path, options);
  if (response.status !== expectedStatus) {
    throw new Error(`${options?.method ?? 'GET'} ${path}: HTTP ${response.status} (se esperaba ${expectedStatus})`);
  }
  return response.body ? JSON.parse(response.body) : null;
}
