# Despliegue público (Oracle Cloud + Cloudflare Tunnel)

MiniWasp está publicado en **https://miniwasp.dayle.dev**. Corre en un contenedor Docker en un
servidor de Oracle Cloud y llega a internet solo a través de un **túnel de Cloudflare**: el servidor
no publica ningún puerto, Cloudflare termina el TLS y entrega el tráfico al contenedor por el túnel.

Hasta el 21/11/2026 también estuvo en Railway (`miniwasp.up.railway.app`). Ese servicio se detuvo
para mantener un solo despliegue; de Railway solo queda el **bucket de adjuntos**, que la instancia de
Oracle sigue usando.

## Por qué así

La aplicación es un único proceso Node.js con todo el estado en memoria y WebSockets de larga
duración, así que necesita **una sola instancia persistente**. Las plataformas serverless con varias
instancias o con tiempo máximo por conexión (por ejemplo, Vercel Functions) no sirven. El servidor de
Oracle ya existía, no tiene límite de crédito mensual (el plan gratis de Railway da US$1 al mes y
detiene el servicio al agotarlo) y el túnel de Cloudflare da HTTPS y un dominio propio sin abrir
puertos.

## Configuración

| Elemento | Valor |
| --- | --- |
| Contenedores | `miniwasp-app` (la aplicación) y `miniwasp-tunnel` (`cloudflared`, fijado por digest) en la red Docker `miniwasp_backend`; ningún puerto publicado |
| Script del servidor | `~/miniwasp/deploy.sh`, versionado en [`deploy/oracle/deploy.sh`](../deploy/oracle/deploy.sh): recompila la imagen y recrea los dos contenedores sin tocar los demás del servidor |
| Endurecimiento | Disco de solo lectura (`--read-only`, `/tmp` en memoria), `--cap-drop ALL`, `no-new-privileges`, 128 procesos y 1 GB de memoria como máximo, reinicio `unless-stopped` |
| Healthcheck | El `HEALTHCHECK` del `Dockerfile` (`GET /healthz`); `deploy.sh` espera a que el contenedor esté sano antes de levantar el túnel |
| Variables fijas | `HOST=0.0.0.0`, `PORT=3000`, `TRUSTED_PROXY_HEADER=cf-connecting-ip` (en `deploy.sh`) |
| Variables secretas | En `~/miniwasp/.env` del servidor (permisos `600`, nunca en el repositorio): las del bucket (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`), las de TURN (`TURN_KEY_ID`, `TURN_KEY_API_TOKEN`) y las de capacidad opcionales; el token del túnel va en `~/miniwasp/.tunnel.env` |
| Bucket | Railway Bucket (compatible con S3); guarda solo adjuntos cifrados |
| Túnel | Cloudflare Tunnel con la ruta `miniwasp.dayle.dev → http://app:3000` |

`TRUSTED_PROXY_HEADER=cf-connecting-ip` hace que la aplicación tome la IP del cliente de la cabecera
que escribe Cloudflare y que envíe HSTS. Es seguro porque el contenedor solo comparte red con
`cloudflared`: nadie más puede llegar a él para falsificar esa cabecera.

## Bucket para los adjuntos

La imagen Docker define `NODE_ENV=production`, y en producción el servidor **se niega a arrancar sin
bucket** (`src/server/config.js`): los archivos nunca deben caer en silencio a la memoria del
proceso. Pasos:

1. Crear un bucket compatible con S3 (hoy, un **Bucket** de Railway).
2. Copiar sus datos de conexión al `.env` del servidor: endpoint → `S3_ENDPOINT` (debe empezar con
   `https://`), nombre → `S3_BUCKET`, access key → `S3_ACCESS_KEY_ID`, secret key →
   `S3_SECRET_ACCESS_KEY`. `S3_REGION` vale `auto` si no se define; `S3_FORCE_PATH_STYLE=true` solo si
   el proveedor exige URLs con el bucket en la ruta.
3. Configurar, si el proveedor lo permite, una **regla de expiración** para el prefijo `rooms/` (por
   ejemplo, de un día). Es la red de seguridad del código: si un borrado falla
   (`attachment.delete.failed`) o el proceso se reinicia con salas abiertas, los objetos que quedan
   están cifrados con una clave que ya no existe, y la regla los elimina.
4. Dejar el bucket **privado** (sin acceso público): la aplicación lee y escribe con sus credenciales
   y entrega los archivos a través de `GET /rooms/attachments/{id}`, nunca con URLs directas.
5. Redesplegar y verificar: subir una foto en una sala, descargarla desde otra persona de la sala,
   cerrar la sala y comprobar que el prefijo `rooms/{sala}/` queda vacío.

Si faltan variables, el contenedor no llega a estar sano y `deploy.sh` muestra sus últimos registros:
es el comportamiento esperado, no un fallo de la aplicación.

## TURN para las videollamadas

Con solo STUN, dos aparatos detrás de NAT distintos (un celular con datos móviles y una PC en wifi,
por ejemplo) a menudo no logran conectarse: la cámara no aparece y la llamada falla. TURN retransmite
el audio y el video, que siguen cifrados de punta a punta.

1. En el panel de Cloudflare, abre **Realtime → TURN Server** (enlace directo:
   `https://dash.cloudflare.com/?to=/:account/calls`) y crea una app TURN.
2. Copia el **Token ID** y el **API Token**. El token es un secreto: no lo pegues en el código ni en
   el repositorio.
3. Agrega al `.env` del servidor `TURN_KEY_ID=<Token ID>` y `TURN_KEY_API_TOKEN=<API Token>` y
   redespliega (`npm run deploy`).
4. Comprueba: durante una llamada, `GET /rooms/ice-servers` debe traer una entrada `turn:` con
   `username` y `credential` (fuera de una llamada responde 409). Si Cloudflare falla, el registro
   muestra `turn.credentials_failed` y la llamada sigue con STUN.
5. Gasto: Cloudflare no tiene un tope que bloquee el gasto. Configura una alerta de uso o de
   facturación en *Notifications* y, si llega, borra la app TURN en *Realtime → TURN Server*: el
   retransmisor deja de funcionar al instante y las llamadas siguen con STUN.

Costo: los primeros 1 000 GB de tráfico retransmitido al mes son gratis (compartidos con el SFU de
Cloudflare, que MiniWasp no usa); después, US$0,05 por GB. Solo se retransmite cuando no hay camino
directo.

## Imagen y memoria

- La moderación de imágenes agrega dependencias pesadas a la imagen. El `Dockerfile` poda lo que no
  se usa de `@tensorflow/tfjs` y `nsfwjs` (solo hacen falta el backend WASM y el modelo MobileNetV2).
- Cada hilo de moderación carga su propia copia del modelo (unos 150 MB según
  `image-inspector.js`). El contenedor tiene 1 GB como máximo; `IMAGE_MODERATION_WORKERS=2` cabe con
  holgura.

## Redesplegar

Requisitos en la máquina que despliega: `ssh` y `tar` (vienen con Windows 10 o superior, macOS y
Linux) y dos variables en el `.env` local, que `npm run deploy` carga si existe:

```bash
ORACLE_SSH_KEY=/ruta/a/la/clave-privada.key
ORACLE_SSH_TARGET=usuario@host
```

```bash
npm run deploy
```

El script [`scripts/deploy/oracle-deploy.mjs`](../scripts/deploy/oracle-deploy.mjs) empaqueta
`Dockerfile`, `.dockerignore`, `package*.json` y `src/`, los sube por SSH, reemplaza `src/` entero en
el servidor (un archivo borrado no queda vivo), ejecuta `deploy.sh` y comprueba que
`https://miniwasp.dayle.dev/healthz` responde 200. Antes de desplegar conviene ejecutar
`npm run verify` y `npm run scan:security`.

**Vuelta atrás:** volver a la versión anterior del código (`git checkout <commit> -- src`) y ejecutar
`npm run deploy`. No hay datos persistentes que migrar: lo que quede en el bucket es ilegible tras el
reinicio y lo elimina la regla de expiración.

## Limitaciones

- **Cada despliegue cierra las salas activas:** el estado está en memoria. Los clientes vuelven a la
  pantalla inicial con un aviso y los adjuntos de esas salas quedan ilegibles. Conviene redesplegar
  cuando no haya conversaciones en curso.
- **Una sola instancia:** salas, sesiones y claves de cifrado viven en la memoria del contenedor.
  Varias instancias exigirían un almacén compartido (Redis) y enrutar cada sala a la misma instancia.
- **El bucket sigue en Railway:** si se agota el crédito gratis de Railway, los adjuntos dejan de
  subirse y descargarse aunque la app siga en línea. Migrarlo a Cloudflare R2 dejaría todo en un
  solo proveedor.
- **Videollamadas:** el servidor solo hace de señalización. Con `TURN_KEY_ID` y
  `TURN_KEY_API_TOKEN` usa el TURN de Cloudflare (ver *TURN para las videollamadas*); sin ellos, solo
  STUN, y entre redes que impiden la conexión directa la llamada falla con un aviso.
