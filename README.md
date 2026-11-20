# MiniWasp

Mensajería temporal con salas privadas y públicas de hasta 20 personas, chat en tiempo real, adjuntos y
videollamadas uno a uno. Sin cuentas ni número de teléfono: creas una sala, compartes su enlace de
invitación y quienes lo abren entran. Los medios de las llamadas viajan cifrados (DTLS-SRTP)
directamente entre los dos navegadores y el servidor nunca los recibe. Sin base de datos: salas,
mensajes y sesiones viven en memoria y desaparecen cuando la sala se cierra.

Publicada en <https://miniwasp.up.railway.app> (ver [docs/deployment.md](docs/deployment.md)).

## Funciones

- **Salas temporales** por invitación (128 bits), de hasta 20 personas. Quien crea la sala puede
  sacar a alguien y renovar la invitación. Para crear o entrar hay que aceptar las
  [normas de la comunidad](src/client/rules.html) (16 años o más).
- **Salas públicas** listadas en la portada con su título y ocupación (nunca nombres): cualquiera
  entra con un clic. Usan moderación estricta (sin groserías ni insultos, solo fotos y texto, modo
  lento de 2 s, 2 reportes borran un mensaje) y quien es expulsado no puede volver a esa sala. Como
  mucho 100 a la vez y 3 por IP cada 10 minutos.
- **Susurros:** desde una sala pública, dos personas pasan a una sala privada solo para ellas si la
  invitada acepta. Se puede elegir no recibir susurros; quien invita solo ve "no disponible".
- **Chat** con historial de los últimos 100 mensajes por sala. Cada persona puede **borrar sus
  mensajes para todos**; quien creó la sala puede borrar cualquiera.
- **Adjuntos:** fotos (el navegador las convierte a JPEG de 1 600 px como máximo, sin metadatos; hasta
  5 MB), notas de voz (WebM, Ogg o M4A, hasta 2 minutos y 2 MB), PDF (8 MB) y texto (1 MB). El tipo se
  identifica por el contenido y no por la extensión. Se guardan **cifrados con AES-256-GCM** con una
  clave por sala que se destruye al cerrarla.
- **Moderación local:** el servidor revisa mensajes, nombres, nombres de archivo, textos y fotos antes
  de publicarlos (diccionario con normalización contra evasiones y modelo nsfwjs en hilos aparte).
  Tres bloqueos silencian 10 minutos; el contenido sexual con menores expulsa de inmediato. Ningún
  contenido se envía a servicios de análisis externos. Ver [docs/moderation.md](docs/moderation.md).
- **Reportes:** quien creó la sala recibe el aviso; con tres reportes de personas distintas el mensaje
  se borra solo.
- **Videollamadas uno a uno** con código de seguridad para detectar una intercepción.
- **API REST** `/api/v1` con las mismas reglas que el navegador, incluidas las salas públicas (los
  susurros son solo por WebSocket). Ver [docs/api/README.md](docs/api/README.md).

Stack: Node.js 22+, módulo `http` nativo, `ws`, `@aws-sdk/client-s3` (bucket de adjuntos),
`jpeg-js`, `nsfwjs` con TensorFlow.js (backend WASM) para la moderación de imágenes, y WebRTC del
navegador. Frontend en HTML, CSS y JavaScript sin framework ni librerías de terceros.

## Ejecutar

```bash
npm install
```

Copia `.env.example` como `.env` (`npm start` lo lee; puede quedar con los valores vacíos). En local
no hace falta bucket: los adjuntos se guardan en memoria. Luego:

```bash
npm start
```

Abre <http://localhost:3000>, acepta las normas y crea una sala. Abre el enlace de invitación en otro
navegador, escribe un nombre distinto en cada uno y pulsa **Videollamar** junto a la otra persona. Al
conectar, ambos ven un **código de seguridad**: si coincide al decirlo en voz alta, nadie intercepta
la llamada. La primera foto que se envía puede tardar más que las siguientes, porque los hilos de
moderación cargan el modelo en ese momento.

Sin TLS la app solo escucha en `127.0.0.1`. Para usarla desde otras computadoras:

- **Red local con HTTPS:** `npm run cert` y después `npm run start:lan`. La consola muestra las URL.
  El certificado es autofirmado y el navegador pide aceptarlo una vez.
- **Internet con túnel de Cloudflare (Docker):**

  ```bash
  docker compose --profile tunnel up --build -d app tunnel
  ```

  La URL `https://….trycloudflare.com` aparece en `docker compose --profile tunnel logs tunnel`.
  El contenedor no publica puertos, corre sin privilegios y solo `cloudflared` llega a él.

## Verificación automatizada

| Comando | Qué hace |
|---|---|
| `npm test` | Pruebas unitarias, de integración y de DOM (`node:test`, `jsdom`) |
| `npm run verify` | ESLint (complejidad ciclomática y cognitiva ≤ 10, funciones ≤ 30 líneas) y pruebas con cobertura |
| `npm run scan:sonar` | Análisis de SonarQube (`docker compose up -d sonarqube`, token en `.env`) |
| `npm run scan:zap` | OWASP ZAP pasivo y activo contra una instancia local |
| `npm run scan:security` | Semgrep, OSV-Scanner, Trivy, Gitleaks, Checkov, SBOM CycloneDX y `npm audit` |
| `npm run e2e` | Dos Chrome reales: llamada completa, medios, métricas WebRTC y recuperación |
| `npm run load` | Carga escalonada de la señalización, latencias, memoria y fugas |
| `npm run test:mutation` | Pruebas de mutación con StrykerJS |

Los resultados de cada herramienta quedan en `docs/evidence/`. El pipeline `.github/workflows/ci.yml`
ejecuta los mismos comandos (no se ha ejecutado en un servidor de CI: el proyecto aún no está en un
repositorio remoto).

## Documentación

| Documento | Contenido |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Componentes, límites de confianza, capas y principios de diseño |
| [docs/webrtc-security.md](docs/webrtc-security.md) | Señalización, transporte, huellas DTLS, privacidad y ciclo de vida |
| [docs/threat-model.md](docs/threat-model.md) | Modelo de amenazas STRIDE con controles y pruebas, incluidos adjuntos, bucket y moderación |
| [docs/moderation.md](docs/moderation.md) | Política de contenido, categorías, normalización, umbrales, faltas, reportes, riesgos residuales y cómo denunciar |
| [docs/test-plan.md](docs/test-plan.md) | Niveles de prueba y trazabilidad de los escenarios CP-001 a CP-058 |
| [docs/privacy.md](docs/privacy.md) | Inventario de datos y principios de la LOPDP |
| [docs/operations.md](docs/operations.md) | Configuración, capacidad, memoria, salud, métricas, registros, apagado y despliegue |
| [docs/deployment.md](docs/deployment.md) | Despliegue en Railway, bucket para adjuntos y verificación |
| [docs/api/README.md](docs/api/README.md) | API REST `/api/v1`, catálogo de errores y cómo probarla con la colección de Insomnia |

## Estructura

```text
src/
├── shared/   Protocolo, límites, tipos de adjunto y validación comunes al navegador y al servidor
├── server/   api · attachments · calls · chat · concurrency · http · messaging · moderation ·
│             observability · peers · rooms · security · whispers
└── client/   attachments · calls · chat · presence · rooms · whispers · common · styles
test/         Misma organización que src (más support/ con fakes y utilidades)
scripts/      Certificado local, E2E, carga, ZAP y escáneres de seguridad
docs/         Documentación técnica y evidencia
```

## Limitaciones conocidas

- **Sin cuentas individuales.** Quien tiene la invitación entra y elige un nombre libre; un nombre en
  uso no puede tomarlo otra sesión de la sala.
- **Videollamadas de dos personas.** Las salas admiten 20, pero una llamada grupal P2P de 20 no es
  viable; haría falta un SFU.
- **Moderación automática imperfecta.** Las notas de voz y los PDF no se analizan por dentro, los
  filtros de palabras se pueden evadir y no hay coincidencia de hashes de material de abuso
  (PhotoDNA). Ver [docs/moderation.md](docs/moderation.md).
- **Sin servidor TURN.** En redes que bloquean la conexión directa la llamada falla con un aviso.
- **Una sola instancia.** El estado está en memoria; no sirve en plataformas serverless. Varias
  instancias exigirían un almacén compartido como Redis.
- **Imagen Docker grande.** TensorFlow.js y nsfwjs agregan cientos de MB; la poda de lo que no se usa
  está pendiente (ver [docs/deployment.md](docs/deployment.md)).
- **El servidor de señalización es de confianza.** El código de seguridad permite detectar una
  sustitución de huellas DTLS, pero solo si las personas lo comparan.
