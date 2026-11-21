# Operación

## Configuración

| Variable | Obligatoria | Valor por defecto | Descripción |
|---|---|---|---|
| `PORT` | No | 3000 | Puerto; se valida al arrancar |
| `HOST` | No | `127.0.0.1` sin TLS, `0.0.0.0` con TLS | Interfaz de escucha |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | No | — | Certificado para HTTPS; deben ir juntos |
| `STUN_URLS` | No | `stun:stun.cloudflare.com:3478` | Lista separada por comas; vacío desactiva STUN |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` | No | — | Clave TURN de Cloudflare Realtime; deben ir juntas. El token es un **secreto** y nunca sale del servidor. Con ellas, cada llamada recibe credenciales TURN de 1 hora que el navegador renueva cada 45 minutos (`GET /rooms/ice-servers`, solo con una llamada sonando o en curso; 60 pedidos cada 10 minutos por IP y 10 por sesión); si Cloudflare no responde, la llamada sigue con STUN. Sin ellas, solo STUN |
| `TRUSTED_PROXY_HEADER` | No | — | Solo detrás de un proxy que la sobrescribe: `x-real-ip` (Railway) o `cf-connecting-ip` (Cloudflare). Lee la IP real, validada con `net.isIP()`, y activa HSTS. Otro valor detiene el arranque |
| `NODE_ENV` | No | — (`production` en la imagen Docker) | Con `production` el servidor se niega a arrancar sin bucket |
| `S3_ENDPOINT` | En producción | — | URL del bucket compatible con S3; debe ser `https` |
| `S3_BUCKET` | En producción | — | Nombre del bucket |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | En producción | — | Credenciales del bucket. Son **secretos** |
| `S3_REGION` | No | `auto` | Región del bucket |
| `S3_FORCE_PATH_STYLE` | No | desactivado | Solo el texto `true` lo activa (URLs `endpoint/bucket/clave`) |
| `MAX_CONNECTIONS` | No | 2000 | Conexiones WebSocket simultáneas en todo el servidor (además, 30 por IP) |
| `MAX_SESSIONS` | No | 3000 | Sesiones abiertas a la vez; cada persona conectada (o con la API) usa una |
| `MAX_ROOMS` | No | 1000 | Salas abiertas a la vez; al llegar, crear una sala responde 503 |
| `UPLOAD_CONCURRENCY` | No | 40 | Subidas procesándose a la vez; al llegar, 503 `SERVER_BUSY` |
| `IMAGE_MODERATION_WORKERS` | No | `min(max(núcleos − 1, 1), 4)` | Hilos de moderación de imágenes. Cada uno carga su propia copia del modelo |

Las cuatro variables `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY` van
juntas: configurar solo algunas detiene el arranque. Sin ninguna (y fuera de producción) los adjuntos
se guardan en la memoria del proceso, con un tope de 64 MB; solo sirve para desarrollo. Las variables
de capacidad deben ser enteros positivos.

Topes fijos en el código: 20 personas por sala (`server-settings.js`), 100 mensajes por sala, 200 MB y 300 archivos por sala, 5 minutos para enviar un
archivo subido, 30 subidas y 10 reportes por minuto por IP.

Salas públicas y susurros (`server-settings.js`, `public-room-directory.js`, `transfer-tokens.js`,
`whisper-coordinator.js`):

| Límite | Valor | Al superarlo |
|---|---|---|
| Salas públicas abiertas a la vez | 100 (opción `maxPublicRooms` de `createChatServer`; no tiene variable de entorno) | 503 (`PUBLIC_ROOMS_FULL` en la API) |
| Salas públicas creadas por IP | 3 cada 10 minutos, además de las 10 salas cada 10 minutos de cualquier tipo | 429 (`Retry-After: 600` en la API) |
| Consultas a la lista pública por IP | 60 por minuto (navegador y API) | 429 |
| Salas que muestra la lista | 50, las más concurridas primero; una sala sin nadie conectado no aparece | — |
| Invitaciones a susurrar por IP | 5 por minuto | Error en el WebSocket |
| Tiempo para responder un susurro | 30 s | Termina con `timeout` |
| Pases de traslado | Un solo uso, 60 s, como mucho 1 000 pendientes | El susurro termina como no disponible |
| Personas por susurro | 2 | 503 en el handshake |
| Vetos por sala pública | 500 huellas | Los siguientes no se guardan |
| Modo lento en salas públicas y susurros | 2 s entre mensajes por sesión | Error `INVALID_INPUT` |

`MAX_SESSIONS` vale 3 000 por defecto: cada susurro crea una sesión nueva por persona (la anterior se
revoca), así que no consume sesiones de más. Con los valores por defecto el límite
efectivo de personas simultáneas es `MAX_CONNECTIONS` (2 000): hay más sesiones (3 000) que conexiones,
para que recargar la página o usar la API no deje a nadie fuera.

Una configuración inválida detiene el arranque con un mensaje claro.

## Memoria

El proceso base es pequeño, pero la moderación de imágenes no: según `image-inspector.js`, cada
hilo carga unos 150 MB de modelo. Los hilos arrancan con la primera foto, no al iniciar. Para
dimensionar: memoria base + `IMAGE_MODERATION_WORKERS` × ~150 MB + hasta `UPLOAD_CONCURRENCY`
subidas en vuelo (hasta 8 MB cada una, más su copia cifrada). En un plan con poca memoria conviene
`IMAGE_MODERATION_WORKERS=1` y bajar `UPLOAD_CONCURRENCY`.

## Diagnóstico

- **Salud:** `GET /healthz` responde `{"status":"ok"}`. El contenedor lo usa como `HEALTHCHECK` y el
  túnel solo se publica cuando la app está sana.
- **Métricas:** `GET /metrics` (requiere sesión) devuelve contadores: conexiones activas y
  rechazadas, llamadas iniciadas, activas y terminadas, mensajes limitados o fallidos, accesos
  correctos y fallidos, errores HTTP, salas creadas y cerradas, y además `attachmentsUploaded`,
  `contentBlocked`, `messagesDeleted` y `messagesReported`.
- **Registros:** una línea JSON por evento en la salida estándar (`time`, `level`, `event` y ids).
  Eventos principales: `server.started`, `session.login.granted`, `session.login.denied`,
  `session.logout`, `call.started`, `call.accepted`, `call.ended` (con `reason`),
  `connection.error`, `message.failed`, `http.request.failed`, `server.fatal`, `server.stopped`.
  Adjuntos y moderación: `attachment.uploaded` (sala, tipo y tamaño; nunca el nombre del archivo),
  `attachment.delete.failed` (el borrado en el bucket falló; el objeto queda cifrado con una clave
  destruida), `moderation.blocked` y `moderation.expelled` (solo sala y categoría; nunca el
  contenido), `message.reported` (sala y número de reportes), `room.member.removed`, `room.closed`.
  Salas públicas y susurros: `room.created` y `room.joined` (con `visibility`), `api.login` (con
  `visibility`), `whisper.started`, `room.transferred`, `session.ended` y `http.rate_limited` (solo la
  huella seudónima de la IP).
- **Señales de alerta:** un aumento de `contentBlocked` o de `moderation.expelled` indica abuso; muchos
  503 `SERVER_BUSY` en subidas indican que faltan hilos de moderación o que `UPLOAD_CONCURRENCY` es
  bajo; `attachment.delete.failed` repetido indica un problema con el bucket o sus credenciales. Muchos 503
  al crear salas públicas indican que alguien llenó los 100 lugares (spam); muchos `http.rate_limited`
  de una misma huella, que alguien recorre la lista o invita a susurrar en ráfaga.
- **Correlación:** cada respuesta HTTP lleva `X-Request-Id`; un error 500 registra el mismo id. Los
  eventos de chat y llamadas llevan `peerId`, `sessionId` o `callId`.

## Apagado y fallos

- `SIGINT`/`SIGTERM`: deja de aceptar conexiones, cierra los WebSocket con 1001 para que los
  clientes reconecten, y termina. Si no lo logra en 10 s, sale con error.
- Excepción no capturada o promesa rechazada sin manejar: se registra (`server.fatal`) y el proceso
  termina con código 1; Docker lo reinicia (`restart: unless-stopped`).
- Los clientes reconectan solos con espera exponencial de 2 a 30 s. Si la sesión venció, vuelven a
  la pantalla de acceso.

## Despliegue y vuelta atrás

- Publicación en internet: Railway, con `npm run deploy`; ver [deployment.md](deployment.md).

- Imágenes fijadas por digest en `Dockerfile` y `docker-compose.yml`: el mismo commit produce la
  misma imagen.
- Vuelta atrás: reconstruir desde la versión anterior del código y `docker compose --profile tunnel
  up --build -d app`. No hay datos que migrar: los adjuntos que queden en el bucket tras un reinicio
  son ilegibles (su clave vivía en memoria) y los elimina la regla de expiración del bucket.
- Antes de desplegar: `npm run verify`, `npm run scan:security`, `npm run scan:zap`, `npm run e2e`.

## Limitaciones operativas

- Una sola instancia: el estado (sesiones, salas, claves de cifrado, faltas, presencia y llamadas)
  está en memoria. Escalar horizontalmente exigiría un almacén compartido como Redis y que todas las
  personas de una sala lleguen a la misma instancia; es el siguiente paso documentado.
- Un reinicio o un redespliegue cierra todas las salas y deja ilegibles sus adjuntos.
- Videollamadas de dos personas: las salas admiten 20, pero una llamada grupal P2P de 20 no es viable;
  necesitaría un SFU.
- Sin `TURN_KEY_ID` y `TURN_KEY_API_TOKEN` no hay TURN: entre redes que impiden la conexión directa
  (por ejemplo, un celular con datos móviles y una PC en wifi) la llamada falla con un aviso. TURN de
  Cloudflare es gratis hasta 1 000 GB de tráfico retransmitido al mes; después cobra US$0,05 por GB.
- Una llamada contestada aguanta 20 s sin conexión de chat de una de las dos personas (el video va
  directo entre los navegadores). Si el cambio de red rompe también el camino del video, la llamada
  falla: no se hace un reinicio de ICE.
- Límites por IP: personas detrás de la misma IP comparten cupo. Lo mismo pasa con los vetos de las
  salas públicas: quien comparte IP con alguien expulsado tampoco puede entrar, y quien cambia de IP
  evade el veto.
- La moderación no analiza notas de voz ni PDF; ver [moderation.md](moderation.md).
