# Escaneo OWASP ZAP

```bash
npm run scan:zap                         # baseline + full scan contra una instancia local
npm run scan:zap -- --runs=baseline      # solo una corrida (baseline | full)
npm run scan:zap -- --public-baseline    # baseline pasivo contra el tunel de Cloudflare, si esta corriendo
npm run scan:zap -- --app-root=<dir> --out=<dir>   # escanea una copia de la app (por ejemplo con cambios propuestos)
```

Requisitos: Docker con la imagen `ghcr.io/zaproxy/zaproxy:stable` y los certificados de `npm run cert`.

## Que hace

1. Arranca `src/server/index.js` por HTTPS en `0.0.0.0` y un puerto libre, con `certs/dev-*.pem`, y espera `/healthz`.
2. Crea una sala desde Node (`POST /rooms` con el mismo `Origin`, validando TLS contra el certificado de desarrollo),
   comprueba que la cookie abre `GET /session` y `GET /metrics` y deja un WebSocket conectado con esa cookie: una sala
   vacia se cierra a los 10 minutos y revoca sus sesiones, y el escaneo completo dura mas. No lee `.env`.
3. Ejecuta ZAP en Docker contra `https://host.docker.internal:<puerto>`:
   - `baseline`: `zap-baseline.py -j --ajax-spider -m 2` (spider tradicional + AJAX spider con Firefox headless, solo reglas pasivas).
   - `full`: `zap-full-scan.py -j --ajax-spider -m 2` (lo mismo mas el escaneo activo).
   - Cada corrida usa una instancia nueva de la app.
4. Cierra el WebSocket, detiene la app, evalua el informe JSON y regenera `docs/evidence/zap/summary.md`.

Contra la URL publica solo se ejecuta el baseline pasivo, sin autenticar; nunca el escaneo activo.

## Autenticacion

- `zap_hooks.py` (opcion `--hook`) carga `session-cookie-sender.js`, un script *httpsender* de Graal.js que agrega
  `Cookie: miniwasp_session=<token>` a toda peticion dirigida al objetivo: spider, AJAX spider (el navegador pasa por el
  proxy de ZAP) y escaneo activo. Si la peticion ya trae esa cookie (un ataque del escaner sobre su valor) se respeta.
- El token viaja solo por variable de entorno (`docker run -e NOMBRE`, sin valor en la linea de comandos) y no se imprime.
- `POST /rooms`, `POST /rooms/join` y `DELETE /session` se envian sin cookie: la peticion se registra y se analiza, pero
  el spider o el escaner no reemplazan ni revocan la sesion del escaneo (la app termina la sesion anterior al crear o
  unirse a una sala). Es la exclusion habitual del logout en escaneos autenticados.
- El hook registra `/session` y `/metrics` en el arbol del sitio, porque ningun enlace HTML los anuncia.
- Al terminar, el hook guarda `<corrida>-auth-check.json` con los codigos de respuesta de esas rutas como evidencia.

## Politica

El comando falla si queda alguna alerta Low o superior, o mas de un tipo informativo (cada `alertRef` cuenta como un tipo,
igual que en el informe de ZAP), salvo las entradas de `accepted-alerts.json`. Ese archivo solo debe contener falsos
positivos confirmados leyendo el codigo, cada uno con su justificacion tecnica.

## Evidencia (`docs/evidence/zap/`)

`<corrida>-report.{html,json,md}` (informes de ZAP), `<corrida>-meta.json` (comando, fechas, veredicto),
`<corrida>-auth-check.json`, `<corrida>-app.log` (registro de la app durante el escaneo) y `summary.md`.
