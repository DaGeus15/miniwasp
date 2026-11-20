// Script httpsender de ZAP (motor Graal.js, no Node). Autentica cada peticion dirigida al
// objetivo del escaneo, incluidas las del navegador del AJAX spider:
// - rutas del navegador: cookie de sesion de la sala del escaneo;
// - rutas /api/v1: encabezado Authorization con el token Bearer del escaneo.
// Las rutas que cambian de sesion (crear sala, unirse, salir, cerrar sesion de la API) se
// envian sin credencial: se registran y se analizan igual, pero ni el spider ni el escaner
// pueden reemplazar o revocar la sesion del escaneo a mitad de camino.
// ZAP busca sendingRequest y responseReceived como funciones globales del script.
const System = globalThis.Java.type('java.lang.System');

const COOKIE_NAME = 'miniwasp_session';
const API_PREFIX = '/api/v1/';
const SESSION_TOKEN = String(System.getenv('MINIWASP_SESSION_TOKEN') ?? '');
const API_TOKEN = String(System.getenv('MINIWASP_API_TOKEN') ?? '');
const TARGET_AUTHORITY = String(System.getenv('MINIWASP_TARGET_AUTHORITY') ?? '');
const SESSION_CHANGING_ROUTES = new Set([
  'POST /rooms',
  'POST /rooms/join',
  'DELETE /session',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/logout',
]);

function isTarget(header) {
  const uri = header.getURI();
  return `${uri.getHost()}:${uri.getPort()}` === TARGET_AUTHORITY;
}

function routeOf(header) {
  return `${header.getMethod()} ${header.getURI().getPath()}`;
}

// Si la peticion ya trae la cookie (por ejemplo un ataque del escaner sobre su valor) se respeta.
function withSessionCookie(current) {
  const pair = `${COOKIE_NAME}=${SESSION_TOKEN}`;
  if (!current) {
    return pair;
  }
  return String(current).includes(`${COOKIE_NAME}=`) ? current : `${current}; ${pair}`;
}

function stripCredentials(header) {
  header.setHeader('Cookie', null);
  header.setHeader('Authorization', null);
}

function authenticate(header, path) {
  if (!path.startsWith(API_PREFIX)) {
    header.setHeader('Cookie', withSessionCookie(header.getHeader('Cookie')));
  } else if (API_TOKEN !== '' && !header.getHeader('Authorization')) {
    header.setHeader('Authorization', `Bearer ${API_TOKEN}`);
  }
}

globalThis.sendingRequest = function sendingRequest(msg) {
  const header = msg.getRequestHeader();
  if (SESSION_TOKEN === '' || !isTarget(header)) {
    return;
  }
  if (SESSION_CHANGING_ROUTES.has(routeOf(header))) {
    stripCredentials(header);
    return;
  }
  authenticate(header, String(header.getURI().getPath()));
};

// Las respuestas no se modifican.
globalThis.responseReceived = function responseReceived() {
  return undefined;
};
