# Despliegue público (Railway)

MiniWasp está publicado en **https://miniwasp.up.railway.app**, con HTTPS gestionado
por Railway y redirección automática de `http://` a `https://` (301).

## Por qué Railway

La aplicación es un único proceso Node.js con todo el estado en memoria y WebSockets de larga
duración, así que necesita **una sola instancia persistente**. Las plataformas serverless con varias
instancias o con tiempo máximo por conexión (por ejemplo, Vercel Functions) no sirven. Railway
ejecuta el `Dockerfile` del repositorio tal cual (imagen multi-etapa fijada por digest, usuario no
root, sin npm en ejecución). Admite WebSockets, permite fijar una única réplica y ya estaba
conectado a la cuenta del proyecto. Render y Fly.io se evaluaron como alternativas: Render tarda
unos 60 s en despertar en el plan gratuito y Fly.io exige tarjeta.

## Configuración

| Elemento | Valor |
| --- | --- |
| Proyecto / servicio | `miniwasp` / `miniwasp` (entorno `production`) |
| Región y réplicas | `us-east4` (Virginia), **1 réplica** (no aumentar: el estado está en memoria) |
| Origen del código | `railway up` desde esta carpeta; `.railwayignore` sube solo `Dockerfile`, `.dockerignore`, `package*.json` y `src/` |
| Build | `Dockerfile` de la raíz (el `HEALTHCHECK` de Docker lo sustituye el de Railway) |
| Healthcheck | `GET /healthz` (tiempo máximo 120 s) |
| Reinicio | `ON_FAILURE`, máximo 5 reintentos |
| Variables | `HOST=0.0.0.0`, `PORT=3000` (el dominio apunta al puerto 3000), `TRUSTED_PROXY_HEADER=x-real-ip`, y las del bucket: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (y, si el proveedor lo pide, `S3_REGION` y `S3_FORCE_PATH_STYLE`) |
| Capacidad (opcional) | `MAX_CONNECTIONS`, `MAX_ROOMS`, `UPLOAD_CONCURRENCY`, `IMAGE_MODERATION_WORKERS`; ver [operations.md](operations.md) |
| Bucket | Railway Bucket (compatible con S3) en el mismo proyecto; guarda solo adjuntos cifrados |
| App sleeping | Activado (plan Free): la instancia se suspende tras unos 10 min sin tráfico y despierta con la siguiente petición |

`ACCESS_CODE` ya no se usa desde que existen las salas temporales. Los únicos secretos son las
credenciales del bucket (`S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY`): se configuran como variables
del servicio en Railway y nunca en el repositorio ni en `.env.example`.

## Bucket para los adjuntos

La imagen Docker define `NODE_ENV=production`, y en producción el servidor **se niega a arrancar sin
bucket** (`src/server/config.js`): los archivos nunca deben caer en silencio a la memoria del
proceso. Pasos:

1. En el proyecto de Railway, crear un **Bucket** (Railway Buckets, compatible con S3).
2. Copiar sus datos de conexión al servicio `miniwasp` como variables: endpoint → `S3_ENDPOINT`
   (debe empezar con `https://`), nombre → `S3_BUCKET`, access key → `S3_ACCESS_KEY_ID`, secret key →
   `S3_SECRET_ACCESS_KEY`. `S3_REGION` vale `auto` si no se define; `S3_FORCE_PATH_STYLE=true` solo si
   el proveedor exige URLs con el bucket en la ruta.
3. Configurar, si el proveedor lo permite, una **regla de expiración** para el prefijo `rooms/` (por
   ejemplo, de un día). Es la red de seguridad del código: si un borrado falla
   (`attachment.delete.failed`) o el proceso se reinicia con salas abiertas, los objetos que quedan
   están cifrados con una clave que ya no existe, y la regla los elimina. Hay que confirmar en el panel
   de Railway que sus Buckets admiten reglas de ciclo de vida; si no, conviene un borrado periódico
   del prefijo.
4. Dejar el bucket **privado** (sin acceso público): la aplicación lee y escribe con sus credenciales
   y entrega los archivos a través de `GET /rooms/attachments/{id}`, nunca con URLs directas.
5. Redesplegar y verificar: subir una foto en una sala, descargarla desde otra persona de la sala,
   cerrar la sala y comprobar que el prefijo `rooms/{sala}/` queda vacío.

Si faltan variables, el log del despliegue muestra el error de configuración y el healthcheck falla:
es el comportamiento esperado, no un fallo de la aplicación.

## Imagen y memoria

- La moderación de imágenes agrega dependencias pesadas a la imagen. Medidas en el `node_modules`
  local: `@tensorflow/tfjs` y sus paquetes suman unos 290 MB (`tfjs` 141 MB, `tfjs-core` 40 MB,
  `tfjs-layers` 31 MB, `tfjs-converter` 25 MB, `tfjs-backend-webgl` 23 MB, `tfjs-backend-wasm` 14 MB,
  entre otros) y `nsfwjs` 41 MB, de los que solo se usa el modelo MobileNetV2 (3,5 MB).
- **Pendiente: podar la imagen Docker.** El servidor solo usa el backend WASM y el modelo
  MobileNetV2; candidatos a eliminar en la etapa `dependencies` son los modelos `inception_v3`
  (29 MB) y `mobilenet_v2_mid` (5,7 MB) de nsfwjs, el backend WebGL y los paquetes de distribución
  para navegador que no se cargan en Node. Hay que verificarlo con la prueba del modelo real
  (`worker-pool.test.js`) dentro del contenedor antes de adoptarlo.
- Cada hilo de moderación carga su propia copia del modelo (unos 150 MB según
  `image-inspector.js`). En el plan Free conviene `IMAGE_MODERATION_WORKERS=1` y vigilar la memoria
  en las métricas de Railway.

`TRUSTED_PROXY_HEADER=x-real-ip` hace que la aplicación tome la IP del cliente de la cabecera
`X-Real-IP`, que escribe el edge de Railway, y que envíe HSTS (el TLS termina en el edge). Es seguro
porque el contenedor solo es accesible a través de ese edge: el proyecto no tiene TCP proxy ni otros
servicios. **No** uses `cf-connecting-ip` aquí: el tráfico no pasa por Cloudflare y esa cabecera
podría falsificarse.

## Redesplegar

Requisito único por máquina: la CLI (`npm install -g @railway/cli`) y `railway login`.

```bash
npm run deploy
```

El script [`deploy/railway-deploy.mjs`](../deploy/railway-deploy.mjs) sube el código, muestra el log
del build, espera a que termine el despliegue y comprueba que `https://…/healthz` responde 200. Antes
de desplegar conviene ejecutar `npm run verify` y `npm run scan:security`.

**Vuelta atrás:** en el panel de Railway → servicio `miniwasp` → *Deployments*, elegir un despliegue
anterior y pulsar *Redeploy*. O bien volver a la versión anterior del código y ejecutar
`npm run deploy`. No hay datos persistentes que migrar: lo que quede en el bucket es ilegible tras el
reinicio y lo elimina la regla de expiración.

## Verificación en producción (18/11/2026)

- `/healthz` → `200 {"status":"ok"}`.
- Cabeceras presentes: `Content-Security-Policy`, `Strict-Transport-Security: max-age=31536000`,
  `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Opener-Policy`,
  `Cross-Origin-Resource-Policy`, `Permissions-Policy`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`.
- WebSocket (`wss://`): se crea una sala desde el navegador, un segundo participante se une con la
  invitación (`POST /rooms/join` → 204) y los mensajes y la presencia llegan en ambos sentidos.
- IP real no falsificable: 11 `POST /rooms` seguidos, cada uno con un `X-Real-IP` inventado distinto,
  dan 10 × 204 y luego 429. El edge sobrescribe la cabecera con la IP real, así que el límite se
  aplica por cliente y no es global.

## Limitaciones

- **Cada despliegue cierra las salas activas:** el estado está en memoria. Los clientes vuelven a la
  pantalla inicial con un aviso y los adjuntos de esas salas quedan ilegibles. Conviene redesplegar
  cuando no haya conversaciones en curso.
- **Una sola réplica:** salas, sesiones y claves de cifrado viven en la memoria de la instancia. Varias
  réplicas exigirían un almacén compartido (Redis) y enrutar cada sala a la misma instancia.
- **La verificación en producción del 18/11/2026 es anterior a los adjuntos y a la moderación.**
  Falta repetirla con el bucket configurado (pasos de la sección *Bucket para los adjuntos*).
- **Plan Free (US$1 de crédito al mes):** si se agota el crédito, Railway detiene el servicio hasta
  el mes siguiente. El *app sleeping* reduce el consumo. Al suspenderse se pierden las salas sin
  conexiones abiertas, algo coherente con la mensajería temporal. Una conversación abierta mantiene
  la instancia despierta.
- **Videollamadas:** el servidor solo hace de señalización (STUN de Cloudflare). Sin TURN, en redes
  que bloquean la conexión directa la llamada falla con un aviso.
