# API REST y pruebas en Insomnia

La API REST (`/api/v1`) expone siete grupos de operaciones sobre las mismas salas y sesiones que
usa la aplicación del navegador. El token viaja en `Authorization: Bearer <token>`; la API no usa
cookies.

| # | API | Método y ruta | Éxito |
|---|---|---|---|
| 1 | Autenticación | `POST /api/v1/auth/login` | 201 |
| 2 | Búsqueda de usuario | `GET /api/v1/users?q=<texto>` | 200 |
| 3 | Videollamada: crear y entrar | `POST /api/v1/videocalls` | 201 |
| 3 | Videollamada: entrar | `POST /api/v1/videocalls/{id}/join` | 200 |
| 3 | Videollamada: consultar | `GET /api/v1/videocalls/{id}` | 200 |
| 3 | Videollamada: salir | `POST /api/v1/videocalls/{id}/leave` | 204 |
| 4 | Mensajes: listar | `GET /api/v1/messages` | 200 |
| 4 | Mensajes: enviar | `POST /api/v1/messages` | 201 |
| 4 | Mensajes: borrar | `DELETE /api/v1/messages/{id}` | 204 |
| 4 | Mensajes: reportar | `POST /api/v1/messages/{id}/report` | 202 |
| 5 | Adjuntos: subir | `POST /api/v1/attachments` | 201 |
| 5 | Adjuntos: descargar | `GET /api/v1/attachments/{id}` | 200 / 206 |
| 6 | Cerrar sesión | `POST /api/v1/auth/logout` | 204 |
| 7 | Salas públicas: listar (sin token) | `GET /api/v1/rooms/public` | 200 |
| 7 | Salas públicas: crear | `POST /api/v1/auth/login` con `visibility: "public"` y `title` | 201 |
| 7 | Salas públicas: entrar desde la lista | `POST /api/v1/auth/login` con `listingId` | 201 |

Iniciar sesión exige `acceptedRules: true` en el cuerpo (16 años o más y normas de la
comunidad) y el nombre pasa por la moderación. El cuerpo decide a qué sala se entra, en este
orden:

| Cuerpo (además de `name` y `acceptedRules`) | Sala | Dueño |
|---|---|---|
| `listingId` | Una sala pública existente, elegida de `GET /api/v1/rooms/public` | No |
| `inviteToken` | Una sala existente (privada o pública) por invitación | No |
| `visibility: "public"` y `title` | Una sala pública nueva (título obligatorio, hasta 40 caracteres) | Sí |
| Nada más | Una sala privada nueva | Sí |

En las salas públicas el título y el nombre se moderan con las **reglas estrictas** (sin groserías
ni insultos); en las privadas, con las estándar. Quien fue expulsado de una sala pública no puede
volver a entrar, ni desde la lista ni por invitación (403 `BANNED_FROM_ROOM`): la sesión de la API
guarda la misma huella seudónima de la IP que la del navegador.

**Decisión: la lista de salas públicas no exige token.** Es la misma lista que la portada del
navegador muestra a cualquiera antes de entrar, y solo trae `listingId`, `title`, `members` y
`capacity` (nunca nombres, ids internos ni invitaciones). Para acotar la enumeración tiene su
propio límite por IP (60 consultas por minuto). `members` cuenta conexiones WebSocket vivas: una
sala aparece cuando alguien la tiene abierta en el navegador, y el cupo (`capacity`) también se
mide en conexiones, porque es lo que acota el tráfico de cada difusión.

**Los susurros no tienen API REST.** Un susurro nace de una invitación entre dos personas
conectadas a la misma sala pública y se acepta o rechaza en vivo: necesita dos conexiones
WebSocket abiertas para avisar, esperar la respuesta (con tiempo límite) y entregar a cada una su
token de traslado. Un cliente REST no tiene conexión en la que recibir la invitación, así que
exponerlos por HTTP solo agregaría superficie de acoso sin un caso de uso real.

La colección lista para importar está en [miniwasp-insomnia.json](miniwasp-insomnia.json).

## Cómo probar en Insomnia

1. Arranca el servidor: `npm start` (escucha en `http://localhost:3000`).
2. En Insomnia (versión 9 o superior, que ejecuta scripts después de la respuesta):
   **Import** → **From File** → `docs/api/miniwasp-insomnia.json`.
3. Abre la colección **MiniWasp API** y, arriba a la izquierda, elige el entorno
   **Local (http://localhost:3000)**. Es necesario: ahí se guardan los tokens.
4. Ejecuta las peticiones en orden, carpeta por carpeta, o todas con el **Collection Runner**
   (clic derecho sobre la colección → *Run*). Cada petición trae pruebas en la pestaña
   **Tests** y guarda en el entorno los tokens y los ids (llamada, adjunto, mensajes) que usan las siguientes.

Si usas `npm run start:lan` (HTTPS con certificado autofirmado), elige el entorno
**LAN con HTTPS** y desactiva *Validate certificates* en las preferencias de Insomnia.

### Qué muestra cada carpeta

| Carpeta | Pasos | Resultado esperado |
|---|---|---|
| 1 · Autenticación | Ana inicia sesión sin invitación (crea la sala); Luis y Carla entran con la invitación | 201 y un `accessToken` por persona |
| 2 · Búsqueda de usuario | Ana lista a todas; Ana busca `lu` | 3 personas; solo Luis |
| 3 · Videollamada | Ana inicia la llamada; Luis entra; **Carla intenta entrar**; Carla busca a Ana; se consulta el estado | 201 `waiting` → 200 `active` → **409 `CALL_FULL`** → `videocallId` de Ana → 2 participantes |
| 4 · Cerrar sesión | Ana cierra sesión; Ana reutiliza su token; Luis consulta la llamada; Luis y Carla cierran sesión | 204 → **401 `TOKEN_INVALID`** → solo queda Luis → 204 |
| 5 · Mensajes y adjuntos | Carpeta independiente (sala de Elena y Fabio). Elena sube una nota `.txt`; Fabio intenta descargarla; Elena la envía en un mensaje y luego intenta reutilizarla; Fabio envía un mensaje, lista, descarga el adjunto completo y con `Range`; Fabio intenta borrar el mensaje de Elena y lo reporta; cada uno borra; se intenta descargar el adjunto borrado | 201 → **404 `ATTACHMENT_NOT_FOUND`** (aún no enviado) → 201 → **404** (un solo uso) → 201 → 2 mensajes → 200 y **206** → **403 `NOT_MESSAGE_AUTHOR`** → 202 → 204 (y 204 otra vez: idempotente) → 404 |
| 6 · Moderación | Carpeta independiente (sala de Gabi). Mensaje prohibido; ejecutable `.exe` (cuerpo `MZ…`); login con nombre ofensivo; login sin `acceptedRules` | **422 `CONTENT_BLOCKED`** → **415 `FILE_TYPE_NOT_ALLOWED`** → **422 `CONTENT_BLOCKED`** → **400 `RULES_NOT_ACCEPTED`** |
| 7 · Manejo de errores | Carpeta independiente (crea su propia sala con Diego) | 400, 401, 404, 405, 409 y 415 con su `code` |
| 8 · Salas públicas | Carpeta independiente. Hugo crea una sala pública al iniciar sesión; se lista sin token; Iris entra con el `listingId`; Iris envía una grosería; Iris sube un PDF; alguien intenta entrar con un nombre grosero; se intenta entrar a una sala que no existe; ambos cierran sesión | 201 con `visibility: "public"` y `listingId` → 200 `{ rooms }` → 201 sin ser dueña → **422 `CONTENT_BLOCKED`** (en una privada se publicaría) → **415 `FILE_TYPE_NOT_ALLOWED`** → **422** → **404 `PUBLIC_ROOM_NOT_FOUND`** → 204 |

## Formato de las respuestas

Login (201):

```json
{
  "tokenType": "Bearer",
  "accessToken": "Xy3…43 caracteres",
  "expiresIn": 28800,
  "user": { "id": "1b7c…", "name": "Ana", "isOwner": true },
  "room": {
    "id": "9f2e…",
    "inviteToken": "Qm1…22 caracteres",
    "visibility": "private",
    "title": null,
    "listingId": null
  }
}
```

En una sala pública, `room` trae `"visibility": "public"`, su `title` y su `listingId`.

Lista de salas públicas (200, sin token):

```json
{
  "rooms": [
    { "listingId": "3c9a…", "title": "Charla de fútbol", "members": 4, "capacity": 20 }
  ]
}
```

Videollamada (201 / 200):

```json
{
  "id": "5d0c…",
  "status": "active",
  "capacity": 2,
  "participants": [
    { "id": "1b7c…", "name": "Ana", "joinedAt": "2026-11-18T12:00:00.000Z" },
    { "id": "77aa…", "name": "Luis", "joinedAt": "2026-11-18T12:00:05.000Z" }
  ],
  "createdAt": "2026-11-18T12:00:00.000Z"
}
```

Mensaje (201 en `POST /api/v1/messages`; `GET` devuelve `{ "messages": [ … ] }`):

```json
{
  "message": {
    "id": "c41d…",
    "name": "Elena",
    "text": "Les dejo la nota",
    "time": "2026-11-19T12:00:00.000Z",
    "attachment": { "id": "8a0f…", "kind": "document", "mimeType": "text/plain", "fileName": "nota de Elena.txt", "size": 32 }
  }
}
```

Todos los errores tienen la misma forma, además del encabezado `X-Request-Id`:

```json
{ "error": "La videollamada está llena: admite 2 personas", "code": "CALL_FULL" }
```

## Catálogo de errores

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `RULES_NOT_ACCEPTED` | Falta `acceptedRules: true` al iniciar sesión (un texto o un `1` no cuentan) |
| 400 | `INVALID_INPUT` | Mensaje sin texto ni adjunto, texto vacío, que no es texto o de más de 500 caracteres; mensaje enviado antes de 2 segundos en una sala pública (modo lento); título de sala pública ausente, vacío, de más de 40 caracteres o con caracteres invisibles |
| 400 | `INVALID_NAME` | Falta el nombre, está vacío, supera 30 caracteres o tiene caracteres de control |
| 400 | `INVALID_INVITE` | `inviteToken` no es texto |
| 400 | `INVALID_LISTING` | `listingId` no es texto |
| 400 | `BAD_REQUEST` | JSON malformado o URL inválida |
| 400 | `INVALID_QUERY` | `q` supera 30 caracteres o tiene caracteres de control |
| 401 | `TOKEN_MISSING` | Falta el encabezado `Authorization` (incluye `WWW-Authenticate: Bearer`) |
| 401 | `TOKEN_INVALID` | Token mal formado, inventado, vencido o revocado al cerrar sesión |
| 403 | `FORBIDDEN` | La petición trae un `Origin` de otro sitio |
| 403 | `NOT_A_PARTICIPANT` | Salir de una videollamada en la que no estás |
| 403 | `NOT_MESSAGE_AUTHOR` | Borrar un mensaje ajeno sin ser quien creó la sala |
| 403 | `BANNED_FROM_ROOM` | Entrar (por la lista o por invitación) a una sala pública de la que te expulsaron |
| 404 | `INVITE_NOT_FOUND` | La invitación no existe o la sala ya se cerró |
| 404 | `PUBLIC_ROOM_NOT_FOUND` | El `listingId` no corresponde a ninguna sala pública abierta |
| 404 | `CALL_NOT_FOUND` | La videollamada no existe, ya terminó o es de otra sala |
| 404 | `ATTACHMENT_NOT_FOUND` | Adjunto inexistente, aún no enviado, ya enviado (al reutilizarlo), subido por otra persona o de otra sala |
| 404 | `NOT_FOUND` | Ruta inexistente |
| 405 | `METHOD_NOT_ALLOWED` | Método no admitido en la ruta (incluye `Allow`) |
| 409 | `NAME_TAKEN` | El nombre ya lo usa otra persona de la sala (sin importar mayúsculas) |
| 409 | `CALL_FULL` | La videollamada ya tiene sus 2 personas |
| 409 | `ALREADY_IN_CALL` | Ya estás en otra videollamada |
| 413 | `PAYLOAD_TOO_LARGE` | El cuerpo JSON supera 1 KB (8 KB al enviar un mensaje) |
| 413 | `FILE_TOO_LARGE` | El archivo supera el máximo de su tipo (foto 5 MB, audio 2 MB, PDF 8 MB, texto 1 MB) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | El cuerpo no es `application/json` |
| 415 | `FILE_TYPE_NOT_ALLOWED` | El contenido no es JPEG, audio (WebM, Ogg, M4A), PDF ni texto plano; en una sala pública, no es JPEG ni texto plano. La extensión no cuenta |
| 422 | `CONTENT_BLOCKED` | La moderación bloqueó el mensaje, el nombre, el título de la sala pública, el nombre del archivo o su contenido (cuenta una falta). En las salas públicas también se bloquean groserías e insultos |
| 429 | `RATE_LIMITED` | Más de 10 salas creadas en 10 minutos (de ellas, 3 públicas; `Retry-After: 600`), 60 consultas por minuto a la lista pública, 30 ingresos por minuto, 10 mensajes o borrados en 5 segundos, 30 subidas por minuto o 10 reportes por minuto desde la misma IP (incluye `Retry-After`) |
| 429 | `SENDER_MUTED` | Tres contenidos bloqueados (dos en una sala pública) silencian la sesión 10 minutos (`Retry-After: 600`) |
| 503 | `SERVER_FULL` | Se alcanzó el máximo de salas o de sesiones |
| 503 | `PUBLIC_ROOMS_FULL` | Ya hay 100 salas públicas abiertas (opción `maxPublicRooms`) |
| 503 | `ROOM_FULL` | La sala pública elegida de la lista no tiene lugar |
| 503 | `SERVER_BUSY` | Demasiadas subidas simultáneas en el servidor (`Retry-After: 5`) |
| 507 | `STORAGE_FULL` | La sala alcanzó su cupo de archivos (200 MB o 300 archivos) |

## Reglas de seguridad

- **El token es un secreto de 256 bits.** El servidor guarda solo su hash SHA-256 y lo revoca al
  cerrar sesión. Vence a las 8 horas.
- **Cada sesión pertenece a una sala.** La búsqueda y las videollamadas nunca muestran personas ni
  llamadas de otra sala; una llamada ajena responde igual que una inexistente (404).
- **Mensajes y adjuntos siguen las mismas reglas que el navegador.** El autor de un mensaje es
  siempre el nombre de la sesión (un campo `name` en el cuerpo se ignora) y los mensajes enviados
  por la API llegan por WebSocket a quien usa la sala desde el navegador.
- **Un adjunto se identifica por su contenido**, nunca por la extensión ni el `Content-Type`, y su
  nombre se limpia y toma la extensión del tipo detectado. Se guarda cifrado con la clave de la
  sala. Solo quien lo subió puede enviarlo, una sola vez; si nadie lo envía en 5 minutos se borra.
  Se descarga con `Content-Security-Policy: default-src 'none'; sandbox` y `no-store`.
- **Borrar es idempotente**: un mensaje que no existe (o que es de otra sala) responde 204 sin
  efecto. Borrar un mensaje existente exige ser su autor o quien creó la sala.
- **Reportar siempre responde 202**: reportar dos veces, un mensaje propio o uno inexistente no tiene
  efecto, y la respuesta no revela cuál de los casos ocurrió. Con 3 reportes de personas distintas el
  mensaje se borra solo (con 2 en una sala pública).
- **Las salas públicas usan las reglas estrictas también por la API**: groserías e insultos
  bloqueados, solo fotos JPEG y texto plano, modo lento de 2 segundos por sesión, 2 faltas
  silencian y la expulsión es permanente para esa sala.
- **Los tokens del navegador no sirven como Bearer**, y los de la API no crean cookies.
- **Las respuestas de un token inválido no revelan el motivo** (inventado, vencido o revocado).
- **El estado vive en memoria**: reiniciar el servidor invalida todos los tokens. Si se repite
  muchas veces la colección en 10 minutos se alcanza el límite de creación de salas (429): es el
  control funcionando. Espera o reinicia el servidor.

La API gestiona quién está en cada videollamada. El audio y el video siguen viajando por WebRTC
entre los navegadores; la API no transmite medios.

## Pruebas automatizadas

`test/server/api.test.js` (flujo completo y cada error), `test/server/api-messages.test.js`
(mensajes, adjuntos, moderación, aislamiento entre salas y límites),
`test/server/api-public-rooms.test.js` (salas públicas: lista, crear, entrar con `listingId`,
moderación estricta, vetos, sala llena o cerrada, modo lento y PDF rechazado) y
`test/server/video-call-registry.test.js` (reglas de la videollamada) corren con `npm test`.
