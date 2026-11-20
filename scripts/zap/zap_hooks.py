# Hooks para zap-baseline.py y zap-full-scan.py (opcion --hook).
# 1. Carga un script httpsender que agrega la cookie de sesion (rutas del navegador) y el
#    token Bearer (rutas /api/v1) a cada peticion al objetivo.
# 2. Registra en el arbol del sitio las rutas que ningun enlace HTML anuncia: /session,
#    /metrics y todas las operaciones de la API REST, para que el analisis pasivo y el
#    escaneo activo las cubran.
# 3. Antes de cerrar ZAP guarda los codigos de respuesta de esas rutas como evidencia de
#    que el escaneo estuvo autenticado.
import json
import logging
import os
from urllib.parse import urljoin, urlsplit

SCRIPT_NAME = 'miniwasp-session-cookie'
SCRIPT_FILE = '/zap/hooks/session-cookie-sender.js'
PROTECTED_PATHS = ['session', 'metrics', 'api/v1/']
CREDENTIAL_MARKERS = ['miniwasp_session=', 'Authorization: Bearer']
MAX_MESSAGES = 5000

_state = {}


def _api_requests(call_id):
    call = 'api/v1/videocalls/' + call_id
    return [
        ('GET', 'api/v1/users?q=zap', None),
        ('GET', call, None),
        ('POST', call + '/join', ''),
        ('POST', 'api/v1/videocalls', ''),
        ('POST', 'api/v1/auth/login', json.dumps({'name': 'zap-probe', 'acceptedRules': True})),
        ('GET', 'api/v1/rooms/public', None),
        ('GET', 'api/v1/messages', None),
        ('GET', 'rooms/public', None),
        ('POST', call + '/leave', ''),
        ('POST', 'api/v1/auth/logout', ''),
    ]


def _graal_engine(zap):
    for engine in zap.script.list_engines:
        if 'Graal.js' in engine:
            return engine
    raise RuntimeError('ZAP no tiene el motor Graal.js para el script de sesion')


def _load_credentials_script(zap):
    result = zap.script.load(SCRIPT_NAME, 'httpsender', _graal_engine(zap), SCRIPT_FILE,
                             scriptdescription='Credenciales de MiniWasp')
    if result != 'OK':
        raise RuntimeError('No se pudo cargar el script de sesion: ' + str(result))
    zap.script.enable(SCRIPT_NAME)


def _raw_request(method, url, body):
    lines = [method + ' ' + url + ' HTTP/1.1', 'Host: ' + urlsplit(url).netloc]
    if body is not None:
        data = body.encode('utf-8')
        lines += ['Content-Type: application/json', 'Content-Length: ' + str(len(data))]
    return '\r\n'.join(lines) + '\r\n\r\n' + (body or '')


def _seed_hidden_routes(zap, target):
    for path in ['session', 'metrics']:
        zap.core.access_url(urljoin(target, path), followredirects=False)
    call_id = os.environ.get('MINIWASP_VIDEOCALL_ID', '')
    if not call_id:
        return
    for method, path, body in _api_requests(call_id):
        zap.core.send_request(_raw_request(method, urljoin(target, path), body), followredirects=False)


def zap_started(zap, target):
    _state['target'] = target if target.endswith('/') else target + '/'
    _load_credentials_script(zap)
    _seed_hidden_routes(zap, _state['target'])
    logging.info('MiniWasp: credenciales cargadas y rutas ocultas registradas')


def _status_line(message):
    request_line = message['requestHeader'].split('\r\n', 1)[0].split(' ')
    status = message['responseHeader'].split(' ', 2)[1] if message['responseHeader'] else 'sin-respuesta'
    return request_line[0] + ' ' + request_line[1] + ' -> ' + status


def _has_credentials(message):
    return any(marker in message['requestHeader'] for marker in CREDENTIAL_MARKERS)


def _collect_auth_evidence(zap):
    responses = {}
    with_credentials = 0
    for path in PROTECTED_PATHS:
        url = urljoin(_state['target'], path)
        for message in zap.core.messages(baseurl=url, start=0, count=MAX_MESSAGES):
            key = _status_line(message)
            responses[key] = responses.get(key, 0) + 1
            with_credentials += _has_credentials(message)
    return {'responses': responses, 'withSessionCookie': with_credentials}


def zap_pre_shutdown(zap):
    output = os.environ.get('MINIWASP_AUTH_CHECK_FILE', '')
    if not output or 'target' not in _state:
        return
    with open(output, 'w') as handle:
        json.dump(_collect_auth_evidence(zap), handle, indent=2)
