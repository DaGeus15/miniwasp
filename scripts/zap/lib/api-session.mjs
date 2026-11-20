import { requestJson } from './https-client.mjs';

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const SCANNER_NAME = 'zap-scanner';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

// Entra por la API REST a la misma sala del escaneo y deja una videollamada abierta, para que
// ZAP tenga un id real sobre el cual probar GET/join/leave. El token tampoco se imprime.
export async function prepareApiSession(client, inviteToken) {
  const login = await requestJson(
    client,
    '/api/v1/auth/login',
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name: SCANNER_NAME, inviteToken, acceptedRules: true }) },
    HTTP_CREATED,
  );
  const call = await requestJson(
    client,
    '/api/v1/videocalls',
    { method: 'POST', headers: { ...JSON_HEADERS, ...bearer(login.accessToken) } },
    HTTP_CREATED,
  );
  await requestJson(client, `/api/v1/videocalls/${call.id}`, { headers: bearer(login.accessToken) }, HTTP_OK);
  return { accessToken: login.accessToken, videoCallId: call.id };
}
