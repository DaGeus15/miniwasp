# Plan de pruebas y trazabilidad

## Niveles

| Nivel | Herramienta | Qué verifica | Comando |
|---|---|---|---|
| Unitarias | `node:test` con fakes de socket, WebRTC, cámara y sesiones | Reglas de cada clase, incluidos errores y límites | `npm test` |
| Integración | `node:test` con servidor HTTP/WebSocket real | Autenticación, autorización, protocolo, límites, apagado | `npm test` |
| DOM | `jsdom` con la página real | Flujos de la interfaz, XSS, accesibilidad básica | `npm test` |
| E2E | Dos Chrome reales con cámara simulada | Llamada completa, medios, métricas WebRTC, recuperación | `npm run e2e` |
| Carga | Clientes WebSocket escalonados | Latencia de señalización, memoria, fugas | `npm run load` |
| Mutación | StrykerJS | Que las pruebas detecten cambios en la lógica | `npm run test:mutation` |
| Estático | ESLint (complejidad), SonarQube | Calidad, complejidad, bugs, hotspots | `npm run lint`, `npm run scan:sonar` |
| Seguridad | ZAP, Semgrep, OSV, Trivy, Gitleaks, Checkov | Vulnerabilidades y configuración | `npm run scan:zap`, `npm run scan:security` |

Cada prueba crea su propio servidor o sus propios fakes: no comparten estado ni dependen del orden.
Ninguna prueba depende de la hora real o de la red externa; los tiempos se inyectan. El bucket se
reemplaza por `MemoryBlobStorage` y el modelo de imágenes por un clasificador falso, salvo en una
prueba que carga el modelo nsfwjs real dentro de un hilo (`worker-pool.test.js` › moderación de
imágenes con el modelo real) para comprobar que el empaquetado y el backend WASM funcionan.

Última ejecución de `npm test`: 706 pruebas en 164 suites, todas aprobadas.

## Escenarios obligatorios

| Id | Tipo | Escenario | Prueba automatizada |
|---|---|---|---|
| CP-001 | Happy | Crear una sala válida | `rooms.test.js` › CP-001: crea una sala y entrega una cookie protegida |
| CP-002 | Happy | Ingresar con credenciales autorizadas | `rooms.test.js` › CP-002: se une con una invitacion valida |
| CP-003 | Security | Rechazar acceso sin autorización | `rooms.test.js` › CP-003: rechaza el WebSocket sin sesion o con un token inventado; rechaza invitaciones inexistentes |
| CP-004 | Security | Rechazar ingreso a una sala ajena | `rooms.test.js` › CP-004: el chat y la presencia no cruzan de una sala a otra; `videocall.test.js` › una tercera persona no puede intervenir |
| CP-005 | Security | Impedir reutilizar una invitación revocada | `rooms.test.js` › CP-005: una invitacion renovada deja de servir |
| CP-006 | Happy | Activar cámara con permiso | `local-media.test.js` › pide camara y microfono; E2E-03 |
| CP-007 | Sad | Cámara denegada por el navegador | `call-controller.test.js` › no invita si se niega el permiso; E2E-07 |
| CP-008 | Happy | Desactivar micrófono y verificar las pistas | `local-media.test.js` › alterna el microfono y la camara por separado; E2E-04 |
| CP-009 | Happy | Finalizar y liberar recursos | `call-controller.test.js` › colgar avisa al servidor y libera todo; E2E-06 |
| CP-010 | Recovery | Reconectar tras una interrupción | `connection.test.js` › reintenta con esperas crecientes; `session.test.js` › sigue reconectando si cae la red; `videocall.test.js` › retoma la llamada al volver con su misma sesion; E2E-10; E2E-15 |
| CP-011 | Recovery | Pérdida del servidor de señalización | `call-controller.test.js` › termina la llamada si se pierde el servidor; `videocall-app.test.js` |
| CP-012 | Security | Rechazar mensajes WebSocket inválidos | `create-chat-server.test.js` › informa el error solo a quien envio un mensaje invalido; `videocall.test.js` › rechaza senales mal formadas, tipos desconocidos |
| CP-013 | Boundary | Rechazar mensajes de tamaño excesivo | `create-chat-server.test.js` › cierra esa conexion (1009); `signal.test.js` › SDP sobre el maximo |
| CP-014 | Concurrency | Sin participantes duplicados al reconectar | `peer-registry.test.js` › muestra una sola vez a quien reconecta |
| CP-015 | Security | Sin acceso después de la expulsión | `rooms.test.js` › CP-015: quien crea la sala puede sacar a alguien y esa persona no puede volver |
| CP-016 | Security | Credenciales TURN no expuestas | `audit-scenarios.test.js` › CP-016; `ice-servers.test.js` › solo quien esta en una sala recibe los servidores ICE |
| CP-017 | Security | Sin tokens en los registros | `audit-scenarios.test.js` › CP-017 |
| CP-018 | Concurrency | Finalización simultánea desde dos clientes | `audit-scenarios.test.js` › CP-018; E2E-11 |
| CP-019 | Security | Sin eventos de salas ajenas | `audit-scenarios.test.js` › CP-019 |
| CP-020 | Security | Errores internos sin detalles sensibles | `message-router.test.js` › oculta el detalle de los errores inesperados; `http.test.js` › registra los errores inesperados; `create-chat-server.test.js` › errores internos |

## Adjuntos, moderación, mensajes y capacidad

| Id | Tipo | Escenario | Prueba automatizada |
|---|---|---|---|
| CP-021 | Security | Rechazar un archivo cuyo contenido no coincide con un tipo permitido (ejecutable renombrado, PNG, GIF) | `attachments/attachment-core.test.js` › rechaza un ejecutable aunque venga renombrado; un PNG o un GIF no se aceptan; `api-messages.test.js` › rechaza ejecutables (415) |
| CP-022 | Boundary | Rechazar archivos sobre el tope de su tipo | `api-messages.test.js` › rechaza archivos demasiado grandes con 413; `attachment-endpoint.test.js` › rechaza tipos no permitidos, archivos grandes, otro origen y a quien no está en una sala |
| CP-023 | Security | Sanear nombres de archivo (ruta, marcas bidi, controles, extensión falsa) | `attachment-core.test.js` › fuerza la extensión del tipo detectado y quita la ruta; elimina marcas bidi, controles y caracteres reservados |
| CP-024 | Security | Cifrado autenticado por sala: otra clave, otro contexto, objeto alterado o clave destruida fallan | `attachment-core.test.js` › RoomCipher › rechaza otra clave, otro contexto, un objeto alterado o una clave destruida |
| CP-025 | Security | Una sala no puede ver ni descargar adjuntos de otra | `attachment-endpoint.test.js` › otra sala no puede descargar el adjunto; `api-messages.test.js` › otra sala no ve, no descarga, no borra ni reporta mensajes ajenos |
| CP-026 | Security | Un adjunto solo lo envía quien lo subió, en su sala y una vez | `attachment-store.test.js` › solo quien lo subió puede enviarlo; `attachment-endpoint.test.js` › un adjunto solo se puede enviar una vez; `api-messages.test.js` › un adjunto se envía una sola vez |
| CP-027 | Privacy | Al cerrarse la sala se borran sus archivos | `attachment-endpoint.test.js` › al cerrarse la sala se borran sus archivos; `attachment-store.test.js` › al cerrar la sala borra todos sus archivos y no toca los de otras |
| CP-028 | Recovery | Un archivo subido y no enviado expira; un fallo del almacenamiento libera el cupo | `attachment-store.test.js` › borra un adjunto que nadie envió a tiempo; libera el cupo si el almacenamiento falla |
| CP-029 | Boundary | Cupo por sala de bytes y archivos sin afectar a otras salas | `attachment-store.test.js` › respeta el cupo de bytes y de archivos por sala sin afectar a otras salas |
| CP-030 | Concurrency | Tope de subidas simultáneas y límite por IP | `attachment-core.test.js` › UploadGate › admite hasta el tope; `api-messages.test.js` › limita las subidas por dirección con 429 |
| CP-031 | Security | Descargas endurecidas: CSP `sandbox`, `no-store`, documentos como descarga, rangos 206/416 | `attachment-endpoint.test.js` › sube un PDF … lo descarga como archivo; las fotos … admiten rangos; `api-messages.test.js` › admite rangos de bytes (206) y rechaza rangos imposibles (416) |
| CP-032 | Security | Fotos sin metadatos y rechazo de bombas de descompresión | `moderation/image-moderation.test.js` › re-codifica la foto sin sus metadatos; rechaza imágenes dañadas o que se expanden demasiado al decodificarse |
| CP-033 | Security | Una foto explícita se bloquea con 422 y no se guarda nada | `attachment-endpoint.test.js` › una foto bloqueada responde 422 y no se guarda nada; `image-moderation.test.js` › judgeImage |
| CP-034 | Recovery | La moderación de imágenes falla cerrado si los hilos están saturados, tardan o fallan | `image-moderation.test.js` › falla cerrado si los hilos no pueden atender; `concurrency/worker-pool.test.js` › rechaza de inmediato cuando la cola está llena; reemplaza un hilo que tarda demasiado o que falla |
| CP-035 | Security | Detectar evasiones de texto (leetspeak, separadores, invisibles, repeticiones) | `moderation/text-normalizer.test.js`; `text-moderator.test.js` › evasiones |
| CP-036 | Happy | No bloquear texto legítimo (Scunthorpe, groserías, modismos, objetos) | `text-moderator.test.js` › falsos positivos que deben pasar |
| CP-037 | Security | Nombres de archivo y textos `.txt` ofensivos se bloquean | `attachment-endpoint.test.js` › un nombre de archivo ofensivo se bloquea; `api-messages.test.js` › nombres ofensivos (422) y textos ofensivos (422) |
| CP-038 | Security | Tres bloqueos silencian, reincidir expulsa, contenido con menores expulsa a la primera | `moderation/strike-tracker.test.js`; `messaging/room-messenger.test.js` › tres bloqueos silencian la sesión y lo más grave la expulsa; `api-messages.test.js` › tras varias faltas, silencia con 429 |
| CP-039 | Security | Un mensaje bloqueado no consume el adjunto | `room-messenger.test.js` › un mensaje bloqueado o inválido no consume el adjunto; `api-messages.test.js` › un mensaje bloqueado no consume el adjunto |
| CP-040 | Security | Solo el autor o quien creó la sala borra un mensaje para todos; con adjunto, se borra el archivo | `room-messenger.test.js` › borra para todos si lo pide su autor o quien creó la sala; borrar un mensaje con adjunto borra también el archivo; `api-messages.test.js` › 403 NOT_MESSAGE_AUTHOR |
| CP-041 | Security | Un reporte avisa a quien creó la sala; tres reportes distintos borran el mensaje | `room-messenger.test.js` › avisa a quien creó la sala y borra solo al llegar a varios reportes distintos; `api-messages.test.js` › un reporte responde 202 y tres personas distintas borran el mensaje; limita los reportes |
| CP-042 | Security | Crear, entrar o iniciar sesión en la API exige `acceptedRules: true` | `api.test.js` (RULES_NOT_ACCEPTED con cuerpo vacío o `"true"` como texto); `rooms.test.js` (servidor); `client/rooms.test.js` (el navegador envía `acceptedRules`) |
| CP-043 | Boundary | Rechazar con 503 a quien supera el tope de personas por sala | `room-model.test.js` › SEC-001: rechaza con 503 a quien supera el tope de personas por sala (con tope 2; el valor por defecto es 20) |
| CP-044 | Happy | El navegador reduce la foto a 1 600 px y la convierte a JPEG antes de subirla | `client/attachments.test.js` › ImagePreparer › reduce la foto al lado máximo y la convierte a JPEG |
| CP-045 | Happy | Mensajes y adjuntos de la API llegan por WebSocket a la sala | `api-messages.test.js` › los mensajes de la API llegan por WebSocket a quien usa el navegador en la sala |

## Salas públicas y susurros

| Id | Tipo | Escenario | Prueba automatizada |
|---|---|---|---|
| CP-046 | Happy | Crear una sala pública con título y verla en la lista solo cuando hay alguien conectado; entrar desde la lista | `public-rooms.test.js` › una sala publica aparece en la portada cuando hay alguien y se puede entrar desde ahi; `client/public-whispers.test.js` › crea, lista, entra y se muda con las rutas correctas; muestra la lista sin interpretar HTML y entra a la sala elegida |
| CP-047 | Privacy | La lista pública no expone nombres, ids internos ni invitaciones | `public-rooms.test.js` › PublicRoomDirectory › lista solo salas publicas con gente … sin datos internos; `api-public-rooms.test.js` › crea una sala publica al iniciar sesion y la lista sin token, sin nombres ni ids internos |
| CP-048 | Security | El título es obligatorio, sin caracteres invisibles y moderado con las reglas estrictas | `public-rooms.test.js` › el titulo es obligatorio, se modera con las reglas estrictas y no acepta caracteres invisibles; `api-public-rooms.test.js` › modera titulo y nombre con las reglas estrictas en salas publicas; `client/public-whispers.test.js` › crea una sala publica con su titulo y avisa si el titulo no se permite |
| CP-049 | Boundary | Límite de salas públicas por IP (3 cada 10 min), tope global (`maxPublicRooms`) y límite de consultas a la lista | `public-rooms.test.js` › limita la creacion de salas publicas por IP y su numero total; `api-public-rooms.test.js` › limita la creacion de salas publicas por IP y su numero total; limita la consulta de la lista por IP con 429 y Retry-After |
| CP-050 | Sad | Entrar desde la lista sin normas, a una sala que ya no existe, a una sala llena o desde otro origen | `public-rooms.test.js` › unirse exige normas, una sala existente y lugar libre; `api-public-rooms.test.js` › rechaza listingId invalido, salas que ya no existen y salas llenas |
| CP-051 | Security | Quien es expulsado de una sala pública no vuelve, ni por la lista, ni por invitación, ni por la API | `public-rooms.test.js` › quien es expulsado de una sala publica no puede volver, ni por la lista ni por invitacion; `public-rooms.test.js` › RoomBanList; `api-public-rooms.test.js` › quien es expulsado no vuelve por la API, ni por la lista ni por invitacion |
| CP-052 | Security | Perfil estricto: groserías bloqueadas en públicas (no en privadas) y modo lento | `public-rooms.test.js` › en una sala publica se bloquean las groserias y el modo lento frena rafagas; las groserias se bloquean en una sala publica pero no en una privada; `api-public-rooms.test.js` › al enviar mensajes por la API bloquea groserias y aplica el modo lento |
| CP-053 | Security | En salas públicas no se aceptan notas de voz ni PDF | `public-rooms.test.js` › en una sala publica no se pueden subir notas de voz ni PDF; Room: tipos de sala › el perfil estricto solo acepta lo que se puede revisar por dentro; `api-public-rooms.test.js` › en una sala publica la API rechaza PDF y acepta texto plano |
| CP-054 | Happy | Dos personas de una sala pública pasan a un susurro solo para ellas; una tercera no entra | `whispers.test.js` › WhisperCoordinator › al aceptar crea una sala de dos y entrega un pase distinto a cada persona; susurro de punta a punta › dos personas de una sala publica pasan a una sala privada solo para ellas; `client/public-whispers.test.js` › recibe una invitacion, la acepta y se muda a la sala privada |
| CP-055 | Security | El pase de traslado es de un solo uso, ligado a la sesión y vence; un intento de robo lo invalida | `whispers.test.js` › TransferTokens › un pase sirve una sola vez y solo para la sesion que lo recibio; vence, se poda y tiene un tope de pases pendientes; susurro de punta a punta (pase robado → 404) |
| CP-056 | Privacy | Quien invita a susurrar ve "no disponible" sin conocer el motivo; la preferencia de no recibir susurros se respeta y se recuerda | `whispers.test.js` › responde "no disponible" sin revelar el motivo; `client/public-whispers.test.js` › si el pase falla avisa, y la preferencia de no recibir susurros se recuerda; en una sala publica ofrece susurrar, oculta la voz y envia la preferencia |
| CP-057 | Sad | Rechazar, dejar vencer o irse termina la invitación; los susurros solo existen en salas públicas | `whispers.test.js` › rechazar o dejar pasar el tiempo avisa a ambas personas; solo existe en salas publicas, exige nombre y solo quien recibe puede responder; si alguien se va, la invitacion termina como no disponible; `client/public-whispers.test.js` › en una sala privada no hay susurros; rechazar responde al servidor y un final de invitacion se explica |
| CP-058 | Happy | La API REST crea salas públicas, entra con `listingId` y mantiene las salas privadas por defecto | `api-public-rooms.test.js` › se entra a una sala de la lista con su listingId y sin ser dueno; una sesion sin visibility sigue creando una sala privada que no aparece en la lista |

### Vacíos conocidos

- `config.test.js` no cubre las variables del bucket (`S3_*`), el rechazo a arrancar en producción sin
  bucket ni las variables de capacidad (`MAX_CONNECTIONS`, `MAX_ROOMS`, `UPLOAD_CONCURRENCY`,
  `IMAGE_MODERATION_WORKERS`).
- `S3BlobStorage` no tiene pruebas contra un bucket real ni contra un doble del cliente S3; las
  pruebas usan `MemoryBlobStorage`.
- No hay pruebas E2E ni de carga de subidas o de la moderación de imágenes con varios hilos.
- Las notas de voz y los PDF no tienen análisis de contenido, así que no hay pruebas de moderación
  para ellos (en las salas públicas directamente no se aceptan).
- No hay pruebas E2E con navegadores reales de las salas públicas ni de los susurros; se cubren con
  pruebas de integración (servidor real) y de DOM.

## Evidencia

Los resultados de cada herramienta se guardan en `docs/evidence/` con fecha, versión y comando.
