# Informe de auditoría técnica independiente — MiniWasp

- **Objeto:** MiniWasp 2.0.0 (chat + videollamadas WebRTC 1:1, Node.js ESM, dependencia de producción única `ws@8.22.2`).
- **Ubicación auditada:** `D:\UTA\8vo_Semestre\Seguridad de Software\miniWasp` (no es repositorio git).
- **Ventana de auditoría:** 2026-11-11 19:40 a 2026-11-12 10:30 (hora local, UTC−5). La auditoría se pausó por el límite de uso entre ~20:32 y 10:14.
- **Instantánea auditada:** SHA-256 agregado de `src/`, `test/`, `package.json` y `package-lock.json` = `d1085fc9…38e7` (calculado con `find … | sha256sum | sha256sum`). **El código cambió durante la auditoría:** la otra sesión modificó 11 archivos de `src/` y varias pruebas entre 19:41 y 20:29. Las cifras de pruebas, cobertura y complejidad de este informe se midieron sobre la instantánea final (10:15). Las pruebas activas de seguridad se ejecutaron entre 19:45 y 20:30 (UTC 00:45–01:30) sobre el código de ese momento; los cambios posteriores (cabeceras, cookie, lectura de JSON, contrato de protocolo) no afectan a los controles que esas pruebas ejercitan, pero esto se declara como limitación.
- **Autorización:** el propietario concedió acceso total y autorización para pruebas activas **solo contra instancias locales**. Todas las instancias de prueba las arrancó el auditor en 127.0.0.1 (puertos 3102, 3103 con TLS propio y 3106) con un `ACCESS_CODE` aleatorio desechable. No se atacó la URL pública de trycloudflare ni ningún servicio externo. No se leyó `.env`, `lan.env` ni `certs/dev-key.pem` (de este último solo se comprobó que contiene una clave privada: `grep -c "PRIVATE KEY"` = 2).
- **Método:** revisión manual del código del servidor, de `shared` y de las partes de seguridad del cliente; cinco líneas de trabajo paralelas (arquitectura, OWASP con pruebas activas, WebRTC y privacidad, pruebas y mutación, DevSecOps y carga). Varias se cortaron por el límite de uso antes de redactar su informe; este informe se consolidó a partir de sus salidas crudas guardadas (scripts y resultados en el scratchpad del auditor) y de las re-ejecuciones del auditor jefe. Ninguna cifra se tomó de declaraciones del desarrollador sin verificarla. Cuando una cifra procede de evidencia previa de otra sesión, se indica.

---

## A. Resumen ejecutivo

| Concepto | Resultado |
|---|---|
| Estado general | Proyecto pequeño, bien estructurado y con controles de seguridad sólidos y verificados activamente; no se hallaron vulnerabilidades críticas ni altas confirmadas. Hay defectos de diseño de severidad media y faltan evidencias obligatorias vigentes. |
| **Puntuación** | **74 / 100** |
| **Calificación** | **C** |
| **Dictamen** | **RECHAZADO — NO ALCANZA CALIFICACIÓN A** |
| Requisitos bloqueantes incumplidos | (1) Puntuación < 95. (2) **No se puede verificar un control obligatorio**: mutation score crítico ≥ 95 % sobre el código actual (la última medición completa válida dio 88,42 %; la ejecución propia solo fue válida en 6 de 21 archivos críticos). La mutación global nunca se ejecutó. (3) Las evidencias DAST y de cadena de suministro vigentes del propio proyecto están en estado **NO APROBADO / RECHAZADO** (ZAP: los tres escaneos NO APROBADO y el último full scan abortó con código 125; compuerta de seguridad RECHAZADO por fallo del SBOM). |
| Principales riesgos | SEC-001 amplificación de difusión de presencia (≈14 MB/s de salida provocados por un solo cliente autenticado, factor ≈14 800×). SEC-002 suplantación de nombre en el chat tras la desconexión del titular. SEC-003 modelo de un único código compartido: no hay identidad individual, expulsión ni revocación selectiva. WRTC-001 código de seguridad (SAS) de 6 dígitos sin compromiso previo: se puede forzar por fuerza bruta en segundos y el aviso de privacidad promete más de lo que garantiza. SEC-004 limitación de intentos de acceso solo por IP, sin tope global. |
| Nivel de confianza | **Medio.** Alto para seguridad del servidor, señalización, pruebas y cobertura (ejecutado por el auditor). Medio-bajo para E2E con navegador, ZAP y SBOM (solo evidencia previa de otra sesión, parcialmente desactualizada) y para mutación (ejecución propia parcialmente inválida por fallo del entorno Windows). SonarQube no se pudo verificar de forma independiente. |

---

## B. Inventario técnico

### Stack
- **Runtime:** Node.js ≥ 22 (`engines`); el auditor ejecutó con v24.11.0. Imagen Docker `node:22-alpine` fijada por digest.
- **Backend:** `node:http`/`node:https` nativos + `ws@8.22.2` (única dependencia de producción; `npm ls --omit=dev`).
- **Frontend:** HTML, CSS y ES modules sin framework; 20 módulos cliente y 5 compartidos, servidos desde una lista cerrada (`src/server/http/public-assets.js`).
- **WebRTC:** API nativa del navegador (`RTCPeerConnection`), P2P 1:1, **sin SFU ni TURN**. STUN por defecto `stun:stun.cloudflare.com:3478` (configurable con `STUN_URLS`).
- **Autenticación:** un único código compartido (`ACCESS_CODE`, ≥ 12 caracteres) → sesión de servidor con token aleatorio de 32 bytes, almacenado como hash SHA-256, en una cookie `HttpOnly; Secure; SameSite=Strict; Max-Age=28800` (8 h, expiración absoluta).
- **Persistencia:** ninguna. Historial de 100 mensajes, sesiones, presencia y llamadas en memoria.
- **Logging/observabilidad:** JSON estructurado por stdout, `X-Request-Id`, `/healthz` (público) y `/metrics` (requiere sesión).
- **Pruebas:** `node:test` (407 pruebas en 91 suites), jsdom, Stryker 10 + tap-runner, scripts E2E (playwright-core + Chrome headless), carga, ZAP y escáneres (Semgrep, OSV, Trivy, Gitleaks, Checkov, CycloneDX).
- **Contenedores:** `Dockerfile` multietapa (usuario `node`, npm eliminado en ejecución, `HEALTHCHECK`); `docker-compose.yml` con SonarQube (127.0.0.1:9000), scanner, `app` (red interna sin puertos publicados, `read_only`, `cap_drop: ALL`, `no-new-privileges`, límites de pids y memoria) y `tunnel` (cloudflared).
- **CI:** `.github/workflows/ci.yml` (lint, cobertura, `npm audit`, escáneres, `docker build`). **Nunca se ejecutó:** el proyecto no es un repositorio git.

### Componentes y límites de confianza

```
 Navegador A ──HTTPS/WSS──┐                         ┌── STUN Cloudflare (externo; ve la IP pública)
  (cliente JS, cámara)    │                         │
                          ▼                         │
 [Límite 1: Internet/LAN]──► cloudflared (túnel) ───┤  (perfil tunnel; red interna sin salida)
                          │                         │
                          ▼                         │
            ┌──────────────── Servidor Node (1 instancia) ─────────────────┐
            │ HttpRouter ─► SessionEndpoint (login/logout) ─► SessionStore │
            │      │         StaticAssetHandler (lista cerrada)            │
            │ WebSocketServer.verifyClient (Origin + cookie + tope por IP) │
            │      ▼                                                       │
            │ MessageRouter ─► rutas: chat / presence / call-*             │
            │      ├─► ChatRoom (100 mensajes)  ├─► PeerRegistry/Peer      │
            │      └─► CallCoordinator ─► CallSession (estado + secuencia) │
            │ RateLimiter ×4 · ConnectionGuard · Heartbeat · Logger · Metrics│
            └──────────────────────────────────────────────────────────────┘
                          ▲
 Navegador B ─────────────┘        A ◄══ DTLS-SRTP P2P (medios; no pasan por el servidor) ══► B
```

Límites de confianza: (1) navegador ↔ servidor (toda entrada se valida en el servidor); (2) servidor de señalización ↔ par remoto (el servidor ve SDP e ICE; los medios no); (3) red ↔ STUN externo; (4) túnel Cloudflare (termina TLS: Cloudflare ve la señalización en claro, incluido el código de acceso al iniciar sesión).

### Superficies de ataque
`POST/GET/DELETE /session`, `GET /metrics`, `GET /healthz`, 28 recursos estáticos, WebSocket (`chat`, `presence`, `call-invite|accept|reject|hangup|signal`), variables de entorno (`ACCESS_CODE`, `HOST`, `TLS_*`, `STUN_URLS`, `TRUST_CLOUDFLARE`), cabecera `CF-Connecting-IP` (solo con `TRUST_CLOUDFLARE=true`), candidatos ICE (exponen IP local y pública al otro participante), interfaz de red (con TLS el valor por defecto es `0.0.0.0`).

### Dependencias
- Producción: 1 (`ws`). `npm audit`: **0 vulnerabilidades** (ejecutado por el auditor; también 0 con `--omit=dev`).
- Desarrollo: 10 directas (`@eslint/js`, `eslint`, `eslint-plugin-security`, `eslint-plugin-sonarjs`, `globals`, `jsdom`, `playwright-core`, `selfsigned`, `@stryker-mutator/core`, `@stryker-mutator/tap-runner`); `overrides` para `minimatch`, `glob` y `qs` (fuerzan versiones parcheadas de transitivas).
- Licencias: 2 componentes LGPL-3.0-only, solo de desarrollo (`eslint-plugin-sonarjs`, `@sonarsource/analyzer-commons-configurations`), según `docs/evidence/security/licenses.json` (evidencia previa).

---

## C. Arquitectura

### Evaluación
| Principio | Valoración | Evidencia |
|---|---|---|
| SRP / cohesión | Cumple | Una clase por archivo; `CallSession` (estado), `CallCoordinator` (reglas), `Peer` (envío), `MessageRouter` (despacho), `SessionEndpoint` (ciclo de sesión). Archivo más largo de `src/`: 208 líneas (`call-controller.js`). |
| OCP | Cumple | Nuevos mensajes = nueva ruta en `messaging/routes.js`; los validadores de señal son un `Map` (`shared/signal.js:43-47`). |
| LSP / ISP | Cumple / n.a. | No hay jerarquías de herencia salvo `ValidationError`/`HttpError`. Los contratos implícitos (`{limiter, handle}`, `directory.find`) son pequeños. |
| DIP / DI | Cumple | Inyección por constructor en todo el servidor (`createChatServer` es la única raíz de composición, `create-chat-server.js:164-189`); reloj, `schedule`, `write` y `getUserMedia` inyectables (testables). |
| DRY | Cumple | Duplicación medida: **0 líneas** en ventanas de 6 líneas normalizadas sobre 2 517 líneas efectivas de `src/` (script propio). |
| KISS / YAGNI | Mayormente | 4 exportaciones sin consumidor externo (CAL-001). Protocolo con ruta implícita de chat (ARQ-002). |
| Dependencias circulares | **0** | Grafo de imports de 57 archivos de `src/`: 0 ciclos, 0 violaciones de capa (client↛server, shared↛client/server), 0 imports sin resolver. |
| Estado global mutable | No | Todo el estado vive en instancias creadas por la raíz de composición. |
| Acoplamiento temporal | Bajo | `PeerLink` serializa señales con una cola de promesas (`peer-link.js:84,179-181`); `LocalMedia.acquire` cubre la carrera «colgar mientras se pide permiso» (`local-media.js:44-52`). |

### Problemas identificados
- **ARQ-001 (Media):** el modelo de autorización tiene un único rol («quien conoce el código»). No existe identidad de usuario, por eso no hay expulsión, revocación selectiva, roles ni no repudio. Ver SEC-003.
- **ARQ-002 (Baja):** cualquier payload sin `type`, incluido JSON inválido, se enruta al chat (`message-router.js:56-61`). Un JSON roto devuelve «El nombre debe ser texto», lo que acopla el error de protocolo con la regla de negocio del chat.
- **ARQ-003 (Baja):** una sola instancia con estado en memoria; documentado como limitación en `docs/operations.md`.
- **Documentación desactualizada:** `README.md` dice «Sin login» y «la app no tiene login»; el código exige `ACCESS_CODE` y sesión.

### Arquitectura objetivo (recomendada)
Mantener la composición actual y añadir: (a) identidad por invitado: invitaciones individuales firmadas y revocables (`InviteStore`) en lugar de un único código; (b) `PresenceService` con difusión diferida o *debounce* y deltas en lugar de la lista completa; (c) un tipo explícito `chat-message` y un error de protocolo propio para JSON inválido; (d) un control de identidad de nombre ligado a la sesión durante la vida del historial.

**Criterio de rechazo de la Fase I:** no se encontró ninguna violación arquitectónica que permita eludir controles de seguridad. La autorización de llamadas y la validación viven solo en el servidor.

---

## D. Hallazgos (ordenados por severidad y prioridad)

> No hay hallazgos **Críticos** ni **Altos** confirmados.

### SEC-001 — Amplificación por difusión de presencia (agotamiento asimétrico de ancho de banda)
- **Categoría:** Seguridad / Rendimiento · **Severidad:** Media · **Estado:** Confirmado
- **Ubicación:** `src/server/peers/peer-registry.js` `rename()` L28-33 y `#announcePresence()` L74-76; `src/server/messaging/routes.js` ruta `PRESENCE` L26-29 (usa el limitador de señales: 300 msg/10 s por IP).
- **Evidencia:** prueba de carga propia (`scratchpad/ops/load/run.mjs`, instancia local 3106, 100 clientes autenticados). Un solo cliente alterna `{"type":"presence","name":"flood-a"|"flood-b"}` cada 33 ms durante 10 s: 237 mensajes, **0 rechazados por el limitador**. Un observador recibió 1 403 751 bytes en 237 mensajes. Salida estimada del servidor: 140 MB en 10 s (**≈14 MB/s ≈ 112 Mbit/s**). Factor de amplificación ≈ **14 808×**. Con el tope de 200 conexiones, la difusión es O(N²) por mensaje (≈4× más).
- **Descripción técnica:** cada cambio de nombre difunde a **todas** las conexiones la lista **completa** de perfiles. El limitador permite 30 cambios/s por IP, así que el coste de salida no está acotado respecto al coste del atacante.
- **Impacto:** un participante autenticado (cualquiera con el código compartido) puede saturar el enlace de subida del anfitrión (un PC doméstico o el túnel) y degradar la señalización y el chat de todos. En loopback no se observó degradación de latencia; el impacto real depende del ancho de banda de subida (no se probó contra la red real, por la prohibición de DoS).
- **Referencia:** CWE-405, CWE-400; OWASP ASVS v4 11.1.4 / 13.4 (anti-automatización); OWASP API4:2023.
- **Corrección propuesta:** limitador específico de presencia (p. ej. 1 cambio/5 s por sesión); difusión con *debounce* (≤ 1 anuncio/250 ms agregado) y envío de deltas (`peer-joined`, `peer-renamed`, `peer-left`); ignorar renombres sin cambio real antes de consumir cupo.
- **Prueba de regresión:** prueba de integración con 100 sockets falsos: 300 renombres en 10 s desde un cliente deben producir ≤ N × 40 entregas de presencia; prueba unitaria del *debounce* con reloj inyectado.
- **Condición de cierre:** factor de amplificación medido < 50× en la misma prueba de carga, más prueba automatizada en `test/server/peer-registry.test.js`.

### SEC-002 — Suplantación de nombre en el chat tras la desconexión del titular
- **Categoría:** Seguridad · **Severidad:** Media · **Estado:** Confirmado
- **Ubicación:** `src/server/peers/peer-registry.js` `assertNameAvailable()` L16-23 (solo compara con conexiones **vivas**); `src/server/messaging/routes.js` `createChatRoute` L6-17; `src/server/chat/chat-room.js` (el historial guarda solo `name`).
- **Evidencia (WS local 3102):** A usa «Ana» → D intenta «Ana» con A conectada → `Ese nombre ya está en uso` (correcto). A se desconecta → D envía `presence: Ana` → aceptado → D publica «Soy Ana (suplantada)» → el historial (`HIST`) muestra el mensaje con autor «Ana», indistinguible de los mensajes reales de Ana. Además, `Аna` con «А» cirílica (U+0410) se acepta junto a «Ana» (NFKC no unifica homoglifos entre alfabetos).
- **Descripción técnica:** la identidad mostrada es un nombre autoasignado, reservado solo mientras dura la conexión. No hay identificador persistente ni de sesión en los mensajes del historial, ni detección de confusables.
- **Impacto:** ingeniería social dentro del grupo (falsos mensajes atribuidos a otra persona, incluso en el historial que ven quienes entran después) y llamadas a un impostor que el usuario cree legítimo.
- **Referencia:** CWE-290, CWE-1007 (confusables), OWASP ASVS V3/V2 (identidad).
- **Corrección propuesta:** reservar el nombre a la sesión durante su TTL (no solo mientras está conectada); incluir en cada mensaje un identificador opaco de sesión o color derivado, visible en la interfaz; aplicar *skeleton* de confusables (UTS #39) o restringir a un solo alfabeto por nombre.
- **Prueba de regresión:** test de integración «D no puede tomar el nombre de A durante la sesión de A aunque A esté desconectada»; test de homoglifos «Аna» vs «Ana» → rechazado.
- **Condición de cierre:** ambas pruebas en verde y el escenario `NAME D=Ana tras salir A` rechazado.

### SEC-003 — Código de acceso único compartido: sin identidad individual, expulsión ni revocación selectiva
- **Categoría:** Seguridad / Arquitectura · **Severidad:** Media · **Estado:** Confirmado (diseño)
- **Ubicación:** `src/server/config.js` `requireAccessCode()` L54-59; `src/server/security/access-code-verifier.js`; `src/server/http/session-endpoint.js`.
- **Evidencia:** solo existe un secreto global; no hay ruta, rol ni operación de expulsión (búsqueda en `src/` sin resultados para *kick/ban/expel/revoke* salvo el logout propio). Los escenarios CP-005 (invitación revocada) y CP-015 (acceso tras expulsión) **no son implementables** con este diseño. La única revocación posible es cambiar `ACCESS_CODE` y reiniciar, lo que expulsa a todos. La validación solo exige longitud ≥ 12 (se acepta `aaaaaaaaaaaa`).
- **Impacto:** no se puede retirar el acceso a una persona concreta ni atribuir acciones (repudio). Si el código se filtra, la única defensa es la rotación global. El código viaja en claro hasta Cloudflare en el modo túnel (Cloudflare termina TLS).
- **Referencia:** OWASP ASVS V2.1/V3.3 (revocación), V4.1 (control de acceso), CWE-1390 (autenticación débil), CWE-521.
- **Corrección propuesta:** invitaciones individuales de un solo uso o con caducidad (token aleatorio por invitado, almacenado como hash), una operación administrativa de revocación que cierre los sockets de esa invitación (reutilizar `peers.closeSession`) y un requisito de entropía mínima del código (p. ej. ≥ 80 bits o generado por `npm run`).
- **Prueba de regresión:** CP-005 y CP-015 automatizados: una invitación revocada → 401 en `/session` y en WS; los sockets vivos se cierran con 4401.
- **Condición de cierre:** CP-005 y CP-015 implementados y en verde.

### SEC-004 — Limitación de intentos de acceso solo por IP, sin tope global ni bloqueo progresivo
- **Categoría:** Seguridad · **Severidad:** Media · **Estado:** Potencial (depende de la entropía real del código, que no se inspeccionó)
- **Ubicación:** `src/server/create-chat-server.js` `LOGIN_RATE` L36 (6/min por IP); `session-endpoint.js` `#create` L75-98.
- **Evidencia:** L7 (local): el 7.º intento en la misma ventana → 429 con `Retry-After: 60`. **No hay contador global de fallos** ni retroceso exponencial. Un atacante con muchas direcciones (p. ej. un prefijo IPv6 /64 detrás del túnel, donde `CF-Connecting-IP` refleja la IP real) dispone de 6 intentos/min **por dirección**. Además, `session.login.denied` no registra ninguna referencia al origen (ni hash de IP), lo que impide detectar una campaña distribuida.
- **Impacto:** fuerza bruta distribuida factible si el código tiene poca entropía (la configuración admite 12 caracteres triviales).
- **Referencia:** OWASP ASVS 2.2.1, CWE-307.
- **Corrección propuesta:** limitador global de fallos (p. ej. 30 fallos/min en total → retroceso), agregación por /64 en IPv6, registrar un hash con sal y truncado de la IP en `session.login.denied`, y una métrica con alerta.
- **Prueba de regresión:** test unitario: 31 fallos desde 31 IPs distintas → el 32.º recibe 429.
- **Condición de cierre:** prueba en verde y evento de log con origen seudonimizado.

### WRTC-001 — Código de seguridad (SAS) de 6 dígitos sin compromiso previo: se puede forzar por fuerza bruta y su promesa está sobredimensionada
- **Categoría:** Seguridad / Privacidad · **Severidad:** Media · **Estado:** Potencial (análisis y medición; no se montó un MITM real)
- **Ubicación:** `src/client/calls/security-code.js` `deriveSecurityCode()` L27-36; `src/client/privacy.html` («Si al decirlo en voz alta coincide, nadie está interceptando la llamada»).
- **Evidencia:** el código es `SHA-256(huellas ordenadas)` → primeros 32 bits mod 10⁶ (≈19,9 bits). No hay compromiso de hash previo como en ZRTP: un servidor de señalización malicioso (o el operador del túnel) ve la huella de A en la oferta y la de B en la respuesta, y puede generar certificados DTLS propios hasta que ambos lados muestren el mismo código. Medición propia (`scratchpad/sas-bench.mjs`): 5 683 claves P-256 + huella por segundo en un núcleo → ~10⁶ intentos en **≈176 s con 1 núcleo / ≈22 s con 8 núcleos** del equipo del auditor (i5-10300H). Variar solo el número de serie del certificado (firmar sin regenerar la clave) es aún más barato.
- **Descripción técnica:** la verificación protege contra una sustitución ingenua de huellas, pero no contra un adversario activo con algo de cómputo. Positivo: los medios van cifrados con DTLS-SRTP P2P y la app **no** afirma tener E2EE frente al servidor (`docs/webrtc-security.md:39`).
- **Impacto:** falsa sensación de seguridad. Un MITM de la señalización podría interceptar audio y vídeo si el usuario confía en el código.
- **Referencia:** RFC 6189 §4.4 (ZRTP: compromiso de hash para SAS cortos), RFC 8827 (WebRTC security), CWE-345.
- **Corrección propuesta:** esquema de compromiso: el ofertante publica `H(fingerprint‖nonce)` antes de conocer la huella del otro y revela después; o un SAS más largo (≥ 32 bits, p. ej. 4 palabras de la lista PGP) y un texto honesto («reduce el riesgo de interceptación»).
- **Prueba de regresión:** pruebas unitarias del esquema de compromiso (una revelación que no coincide → aviso visible) y un test de longitud mínima del SAS.
- **Condición de cierre:** esquema implementado y probado, o texto corregido y SAS ≥ 32 bits.

### QA-001 — Mutation score crítico ≥ 95 % no verificable sobre el código actual; mutación global nunca ejecutada
- **Categoría:** Calidad · **Severidad:** Media (bloqueante para A por falta de evidencia) · **Estado:** Confirmado (ausencia de evidencia vigente)
- **Ubicación:** `stryker.critical.config.mjs` (21 archivos), `stryker.config.mjs` (global, umbral 85); `docs/evidence/mutation/critical.json`.
- **Evidencia:**
  - Evidencia previa (`critical.json`, 2026-11-11 19:37): 829 mutantes, 641 *killed*, 92 *timeout*, **96 *survived*** → **88,42 %** (< 95 %, umbral `break` 95). En 18 de 21 archivos el código coincide hoy con el embebido en ese informe (hash verificado); las pruebas cambiaron después.
  - Ejecución propia (2026-11-11 19:46–20:32, salida en el scratchpad, sin modo incremental): 827 mutantes, pero **534 terminaron en `RuntimeError`** (código de salida 3221225794 = 0xC0000142, fallo de inicialización de procesos en Windows por saturación del sistema durante la ejecución simultánea de Docker/ZAP/Sonar). Stryker informó «99,65 %» excluyendo esos errores: **la cifra no es válida en conjunto**. Solo es válida para 6 archivos: `call-coordinator.js` 88/88, `call-session.js` 56/56, `session-endpoint.js` 55/55, `message-router.js` 23/23 válidos, `read-json-body.js` 27/27 (+1 ignorado), `http-router.js` 37/38 (sobrevive solo el literal `'Método no permitido'`).
  - Sin dato válido actual para: `security/*` (7 archivos), `peers/*`, `validation.js`, `routes.js` y `shared/*`. En la evidencia de las 19:37 tenían supervivientes relevantes: `routes.js:11` (eliminar `peers.assertNameAvailable` sobrevivía; el mensaje se guarda en el historial antes de que `rename` lance), `routes.js:34` (eliminar la ruta `call-hangup` sobrevivía), `connection-guard.js:35` (2 mutantes), `session-store.js` (7), `validation.js` (7), `events.js` (17).
  - No existe ningún informe de mutación **global**.
- **Impacto:** no se puede demostrar que no queden mutantes que representen un bypass de autorización o la ruptura de invariantes (p. ej. la reserva de nombre, SEC-002).
- **Referencia:** requisito de la Fase VII.
- **Corrección propuesta:** ejecutar `npm run test:mutation:critical` y `npm run test:mutation` en un equipo sin carga, con `concurrency` reducida, y publicar los informes con el hash del código; añadir pruebas para `routes.js:11` y la ruta de colgado vía router.
- **Prueba de regresión / condición de cierre:** informe crítico ≥ 95 % sin `RuntimeError`, con fuente embebida igual al código, y global ≥ 85 %; ningún superviviente en `security/*`, `routes.js` o `call-*`.

### OPS-001 — Evidencias de seguridad del propio proyecto en estado no aprobado o abortado
- **Categoría:** DevSecOps · **Severidad:** Media · **Estado:** Confirmado
- **Evidencia:** `docs/evidence/zap/summary.md` (generado 2026-11-12T01:31Z): Baseline autenticado **NO APROBADO** (2 Low: HSTS ausente en `/` y COEP; 3 tipos informativos); Baseline público **NO APROBADO**; el último Full scan **abortó** (`zapExitCode: 125`, `sourceStable: false`; Docker cayó a las 01:31Z, a la misma hora en que falló el análisis Sonar del auditor), aunque `verdict.passed` aparece como `true` con 0 alertas, **un resultado no fiable**. El full scan anterior completado (00:15–00:29Z) dio 1 Low (COEP) + 6 informativos → NO APROBADO. `docs/evidence/security/summary.md` (00:43Z): **compuerta RECHAZADO** por error del SBOM CycloneDX; los demás escáneres sin hallazgos CRITICAL/HIGH (Semgrep: 3 MEDIUM en `scripts/load`, por desactivar la verificación TLS en el generador de carga).
- **Verificación propia:** HSTS está presente con TLS en el código actual (prueba `TLS-HEADERS` del auditor: `max-age=31536000`) y COEP `require-corp` se añadió a las 19:48, así que las dos alertas Low probablemente están resueltas, **pero no existe un escaneo aprobado posterior**.
- **Impacto:** no hay evidencia DAST ni SCA/SBOM vigente y aprobada para el código actual.
- **Corrección / cierre:** re-ejecutar `npm run scan:zap` y `npm run scan:security` sobre el código congelado, con resultado APROBADO, código de salida 0 y `sourceStable: true`.

### OPS-002 — Sin control de versiones: CI no ejecutable, sin trazabilidad ni historial auditable
- **Categoría:** DevSecOps · **Severidad:** Media · **Estado:** Confirmado
- **Evidencia:** el directorio no es un repositorio git (variable del entorno y advertencia del scanner Sonar «run the analysis inside a git repository»). `ci.yml` existe pero nunca corrió. Gitleaks solo puede escanear en modo directorio (sin historial). Las acciones de GitHub están fijadas por etiqueta (`actions/checkout@v5`, `setup-node@v5`, `upload-artifact@v4`), no por SHA. La mutación, ZAP y E2E no forman parte de CI.
- **Impacto:** imposible demostrar qué código produjo cada evidencia (aquí el código cambió durante la auditoría) y riesgo de cadena de suministro en CI.
- **Corrección / cierre:** inicializar git, versionar con `.gitignore` (añadir `lan.env`, `reports/` si procede), fijar acciones por SHA, ejecutar CI al menos una vez y adjuntar el enlace de la ejecución verde.

### SEC-005 — `TRUST_CLOUDFLARE=true` con el puerto accesible directamente permite falsificar la IP (evasión del limitador y bloqueo de terceros)
- **Categoría:** Seguridad · **Severidad:** Baja · **Estado:** Confirmado (solo bajo configuración errónea)
- **Ubicación:** `src/server/security/client-address.js` L5-7; `src/server/config.js` (no impide combinar `TRUST_CLOUDFLARE` con TLS o LAN).
- **Evidencia (instancia TLS local 3103 con `TRUST_CLOUDFLARE=true`):** 20 intentos con `CF-Connecting-IP` rotativa → 20×401, **0×429** (evasión); 6 intentos con la IP de una víctima → la víctima recibe 429 (bloqueo de terceros). En `docker-compose.yml` el servicio `app` no publica puertos y está en una red `internal`, así que el despliegue documentado **no** es vulnerable.
- **Referencia:** CWE-348, CWE-290.
- **Corrección:** al arrancar, rechazar `TRUST_CLOUDFLARE=true` si `TLS_*` está configurado o `HOST` no es una red interna; opcionalmente aceptar la cabecera solo desde los rangos de cloudflared.
- **Prueba / cierre:** test de `loadConfig` que lance error con esa combinación.

### SEC-006 — Con TLS el servidor escucha por defecto en todas las interfaces (0.0.0.0)
- **Categoría:** Seguridad · **Severidad:** Baja · **Estado:** Confirmado (por diseño, documentado)
- **Ubicación:** `src/server/config.js` `resolveHost()` L62-64.
- **Evidencia:** el log de la instancia TLS 3103 anuncia `https://localhost:3103`, `https://172.31.144.1:3103` y `https://192.168.1.7:3103`. Sin TLS el bind es 127.0.0.1 (verificado: `http://127.0.0.1:3102`).
- **Impacto:** exposición a toda la LAN (y a la interfaz virtual de WSL/Docker 172.31.x) sin que el operador lo elija explícitamente; mitigado por la autenticación.
- **Corrección:** exigir `HOST` explícito cuando se activa TLS, o enlazar por defecto solo a la interfaz LAN principal; registrar una advertencia.

### SEC-007 — Conexiones HTTP lentas no se cierran y no hay tope de conexiones HTTP por IP
- **Categoría:** Rendimiento / Seguridad · **Severidad:** Baja · **Estado:** Potencial (no se ejecutó DoS)
- **Evidencia:** 200 sockets con cabeceras incompletas (un byte cada 5 s) desde 200 IP loopback: **ninguno fue cerrado por el servidor en 75 s**; `/healthz` siguió respondiendo (p50 0,36 ms). `ConnectionGuard` solo limita los WebSocket.
- **Impacto:** agotamiento de descriptores ante un slowloris con muchas conexiones (no probado por la restricción de DoS).
- **Corrección:** fijar explícitamente `server.headersTimeout` (p. ej. 10 s), `requestTimeout` y `maxConnections` en el `http.Server`, y aplicar un tope por IP también al HTTP.

### PRIV-001 — Exposición de IP a la otra persona y a un STUN de terceros sin opción de relé
- **Categoría:** Privacidad · **Severidad:** Baja · **Estado:** Confirmado (documentado)
- **Ubicación:** `src/client/calls/peer-link.js` L104 (sin `iceTransportPolicy`); `config.js` (STUN Cloudflare por defecto); no hay TURN.
- **Evidencia:** el aviso `privacy.html` lo informa («la otra persona y el servidor STUN ven tu IP pública»). Los candidatos se intercambian solo tras aceptar (`call-session.js:48-50`, verificado: `CALL A offer antes de aceptar` → no se reenvía).
- **Impacto:** revelación de la IP pública (y de la ubicación aproximada) a cualquier persona a la que se acepta una llamada; transferencia de la IP a un tercero (Cloudflare). Sin TURN, las llamadas fallan en NAT simétricos.
- **Corrección:** TURN propio con credenciales temporales (REST API de coturn, TTL corto) y opción «ocultar mi IP» (`iceTransportPolicy: 'relay'`).
- **Revisión jurídica:** la transferencia de la IP a Cloudflare (encargado o tercero, transferencia internacional) requiere análisis según la LOPDP.

### OPS-003 — Los fallos de acceso no registran el origen y los abortos del cliente se registran como error 500 con stack
- **Categoría:** Observabilidad · **Severidad:** Baja · **Estado:** Confirmado
- **Evidencia:** log local 3102: `session.login.denied` sin ningún campo de origen; una petición abortada por el cliente produjo `level:error`, `http.request.failed`, con `errorStack` de `node:_http_server` (cualquiera puede inundar los logs de error sin autenticarse). CP-017 sí **pasa**: ni el código de acceso, ni tokens, ni nombres, IPs, SDP o candidatos aparecen en los logs (búsquedas exactas con 0 coincidencias).
- **Corrección:** tratar `ECONNRESET`/`aborted` como `warn` sin stack; seudonimizar el origen en los eventos de seguridad.

### SEC-008 — El tope de 1 000 sesiones permite que un usuario autenticado desaloje las sesiones de otros
- **Categoría:** Seguridad · **Severidad:** Baja · **Estado:** Potencial
- **Ubicación:** `session-store.js` `#evictOldestIfFull()` L86-91.
- **Descripción:** al llegar a 1 000 sesiones se elimina la más antigua; quien tenga el código (y varias IP, por el límite de 6/min) puede desalojar a los usuarios legítimos.
- **Corrección:** tope de sesiones por IP o seudónimo y desalojo de la más antigua **de esa misma fuente**.

### CAL-001 — Exportaciones sin consumidor externo
- **Categoría:** Calidad · **Severidad:** Baja · **Estado:** Confirmado
- **Evidencia:** `MAX_HISTORY` (`chat-room.js`), `DEFAULT_HEARTBEAT_INTERVAL_MS`, `DEFAULT_MAX_CONNECTIONS` y `DEFAULT_MAX_SESSIONS` se exportan, pero no los usa ningún otro módulo de `src/`, `test/` ni `scripts/` (script propio de exportaciones). Otras 7 exportaciones solo se usan en pruebas.
- **Corrección:** no exportarlas, o usarlas en las pruebas en lugar de números mágicos.

### ARQ-002 — JSON inválido enrutado al chat (ver sección C) · Baja · Confirmado
- **Evidencia:** CP-012: `{json roto` → `{"type":"error","error":"El nombre debe ser texto"}`. La conexión permanece abierta (correcto); el mensaje de error es engañoso.
- **Corrección:** `parseJson` devuelve un centinela y se responde «Mensaje mal formado»; el chat pasa a tener `type: "chat-message"` explícito.

### DOC-001 — README contradice el código («Sin login»)
- **Categoría:** Calidad · **Severidad:** Baja · **Estado:** Confirmado · **Ubicación:** `README.md` (párrafos 1 y «Opción B»). **Corrección:** documentar `ACCESS_CODE` y el flujo de sesión.

### Controles verificados que funcionan (sin hallazgo)
Control de acceso de llamadas (C no puede aceptar, rechazar, colgar, señalizar ni ver eventos de la llamada A–B; un `callId` adivinado se ignora), secuencia SDP/ICE (respuesta antes de oferta, candidato antes de la descripción, oferta repetida, doble aceptación y señal tras colgar → descartados), saneamiento de señales (los campos extra y un `from` falso se eliminan), CSWSH (Origin ajeno, `null` o de subdominio → 401), WS sin cookie o con cookie inválida o vacía → 401, logout que revoca la cookie y cierra los sockets vivos con 4401, `/metrics` protegido, *path traversal* (14 variantes → 404), métodos no permitidos → 405, `maxPayload` 32 KB → cierre 1009, límites de chat (10/5 s), señal (300/10 s), invitación (20/30 s) y conexiones (30 por IP → 503), XSS (render con `textContent`; 0 elementos inyectados en jsdom; no hay `innerHTML`, `eval` ni `document.write` en `src/`), CSP estricta sin `unsafe-inline`, cookie `HttpOnly; Secure; SameSite=Strict`, comparación del código en tiempo constante (`timingSafeEqual` sobre digests), tokens almacenados como hash, no hay CORS (no se emite `Access-Control-Allow-Origin`).

---

## E. Calidad del código

| Métrica | Umbral A | Medido (código actual) | Fuente |
|---|---|---|---|
| Complejidad ciclomática por función | ≤ 10 | **0 funciones > 10** | `npx eslint src --rule complexity:[warn,10]` (57 archivos, 0 avisos) |
| Complejidad cognitiva por función | ≤ 10 | **0 funciones > 10** | `sonarjs/cognitive-complexity:[warn,10]` |
| Longitud de función | ≤ 30 líneas efectivas | **0 funciones > 30** | `max-lines-per-function` (sin líneas en blanco ni comentarios) |
| Longitud de archivo | ≤ 250 líneas efectivas | **0 archivos > 250** (máx. 208 líneas brutas) | `max-lines` |
| Duplicación | ≤ 1 % | **0 %** (0/2 517 líneas efectivas, ventanas de 6 líneas) | script propio; Sonar no verificable |
| Dependencias circulares | 0 | **0** | grafo de imports propio |
| Código muerto | 0 | 0 funciones muertas; 4 exportaciones sin uso (CAL-001) | script propio |
| Errores estáticos bloqueantes | 0 | **0** (`npm run lint` limpio, incluye `eslint-plugin-security` y `sonarjs`) | ejecución propia |
| Vulnerabilidades críticas/altas | 0 | 0 confirmadas | este informe |
| Secretos expuestos | 0 | 0 en el árbol revisado (no se leyó `.env`/`lan.env`); hay una clave privada TLS de desarrollo en `certs/dev-key.pem`, excluida de git e imagen | revisión propia |

- **Acoplamiento y cohesión:** bajo acoplamiento (DI por constructor, sin singletons); alta cohesión por archivo.
- **Deuda técnica:** baja. Principales deudas: ARQ-002, CAL-001, DOC-001.
- **Asincronía, cancelación y recursos:** `PeerLink` serializa las señales; `LocalMedia` libera las pistas incluso si la llamada termina durante la petición de permiso; temporizadores con `unref()`; heartbeat que cierra conexiones muertas y sesiones vencidas. Positivo.
- **SonarQube:** **no verificado de forma independiente.** El análisis del auditor (`npm run scan:sonar`, 00:47–01:31Z) quedó colgado 41 min y terminó con `error waiting for container: unexpected EOF` (exit 125). La API (`/api/qualitygates/project_status`) responde 401 sin token, y el token solo está en `.env` (no se lee por regla). Las reglas de complejidad de `eslint-plugin-sonarjs` se verificaron localmente.

---

## F. Seguridad WebRTC

| Área | Valoración | Evidencia |
|---|---|---|
| **Señalización: autenticación** | Correcta | `verifyClient` exige Origin igual al host y una sesión válida (`create-chat-server.js:94-111`); probado: sin cookie → 401. |
| **Autorización por llamada** | Correcta | `CallSession.canSignal` exige participante, llamada aceptada y orden (`call-session.js:18-28,48-50`); pruebas activas con un tercer cliente: 0 eventos filtrados (CP-019). |
| **Validación SDP/ICE** | Correcta en forma; SDP opaco | `shared/signal.js`: tipo, tamaño (SDP ≤ 30 000, candidato ≤ 1 024) y reconstrucción campo a campo. El SDP no se analiza semánticamente (aceptable: el navegador lo valida). |
| **Repetición / orden** | Correcta | Oferta única, respuesta única, candidatos solo tras la propia descripción; probado. |
| **Reconexión** | Correcta con límites | Retroceso exponencial de 2 a 30 s en el cliente (`connection.js`); una caída de socket termina la llamada (`handleDeparture`); presencia deduplicada por sesión (`publicProfiles`). E2E-10 (evidencia previa) PASS. |
| **Revocación de sesión** | Correcta para el logout propio | Prueba activa: logout → cookie antigua 401 en HTTP y WS; sockets cerrados con 4401; E2E-12 (previa) PASS. **No hay revocación administrativa** (SEC-003). |
| **Transporte de medios** | DTLS-SRTP P2P | No hay manipulación de SDP que elimine huellas; los medios no pasan por el servidor. **No es E2EE frente al servidor de señalización** (la app no lo declara). |
| **Verificación de huellas** | Débil | SAS de 6 dígitos sin compromiso (WRTC-001). |
| **TURN** | Ausente | No hay credenciales que filtrar (CP-016 PASA por ausencia); disponibilidad reducida en NAT simétricos. |
| **TLS de señalización remota** | Correcto | HSTS con TLS (verificado), cookie `Secure`; LAN con certificado autofirmado (aceptación manual) y túnel con TLS de Cloudflare (Cloudflare ve el tráfico en claro). |
| **Privacidad de cámara y micrófono** | Correcta | `getUserMedia` solo tras «Videollamar» (quien llama) o «Contestar» (quien recibe) (`call-controller.js:37-60`); pistas detenidas al colgar, rechazar o fallar (`#close` → `media.release()`); no hay `MediaRecorder` ni `captureStream` en `src/`; `Permissions-Policy: camera=(self), microphone=(self)`. Los botones de silenciar y apagar usan `track.enabled=false` (en algunos navegadores el indicador de hardware sigue encendido mientras la cámara está «apagada»; Baja, sin ficha). |
| **Gestión de salas** | n.a. / 1:1 | No hay salas: «sala» = llamada 1:1 con `callId` UUID v4; un id manipulado se ignora en silencio (probado). No hay expulsión (SEC-003). |

---

## G. Pruebas

### Ejecución propia (código actual, 2026-11-12 10:15–10:16)
- `node --test` con cobertura: **407 pruebas, 407 aprobadas, 0 fallidas, 0 omitidas**, 91 suites, 11,7 s. Ejecuciones previas de la línea de pruebas (19:44, 20:29 ×2) también en verde → **sin inestabilidad observada en 4 ejecuciones**.
- **Cobertura global:** líneas **99,87 %** (3 125/3 129), ramas **99,65 %** (848/851), funciones 99,78 % (446/447). Ramas sin cubrir: `peer-link.js:89`, `security-code.js:9`, `config.js:19`.
- **Reglas críticas** (16 archivos: `calls/*`, `security/*`, `session-endpoint`, `messaging/*`, `validation`, `shared/{signal,server-event,draft}`): **100 % de ramas (289/289)** y 100 % de líneas (875/875), medido en la ejecución de las 19:45; los archivos críticos modificados después (`session-cookie.js`, `read-json-body.js`, `server-event.js`) siguen al 100 % en la ejecución de las 10:15.
- **Mutación:** ver QA-001 → **no verificada** para el umbral crítico (88,42 % es la última cifra completa válida) y la global no existe.
- **Advertencia sobre la cobertura:** la cobertura experimental de Node cuenta líneas no ejecutables, lo que tiende a inflar el porcentaje de líneas; las ramas son más fiables.

### Matriz CP-001 … CP-020

| CP | Tipo | Resultado | Evidencia |
|---|---|---|---|
| CP-001 Crear sala válida | Happy | **PASA** (como llamada 1:1) | Activa: `CALL invite A->B` → `ringing` + `incoming` con el mismo `callId`. |
| CP-002 Credenciales autorizadas | Happy | **PASA** | Activa L6: 204 + cookie `HttpOnly; Secure; SameSite=Strict; Max-Age=28800`. |
| CP-003 Sin autorización | Security | **PASA** | WS sin cookie / inválida / vacía → 401; login incorrecto → 401; `/metrics` sin sesión → 401. |
| CP-004 Sala ajena | Security | **PASA** | C: accept/reject/hangup/offer/candidate en la llamada A–B → 0 efectos; `callId` adivinado ignorado. |
| CP-005 Invitación revocada | Security | **PARCIAL**: no existen invitaciones (SEC-003). El logout sí revoca la sesión: cookie antigua → 401 (HTTP, WS y `/metrics`). | Activa `ws-logout`. |
| CP-006 Cámara con permiso | Happy | **PASA (evidencia previa)** | E2E-03/05 (Chrome 157 headless con medios simulados, 2026-11-12T00:37Z); no re-ejecutado (el script solo escribe en `docs/evidence`). |
| CP-007 Permiso denegado | Sad | **PASA (evidencia previa)** | E2E-07: aviso y ninguna invitación enviada. Pruebas unitarias en `local-media.test.js`. |
| CP-008 Micrófono apagado | Happy | **PASA (evidencia previa)** | E2E-04; unitarias en `call-controller.test.js`. |
| CP-009 Finalizar y liberar | Happy | **PASA (evidencia previa + código)** | E2E-06; `#close()` → `link.close()` + `media.release()`. |
| CP-010 Reconectar | Recovery | **PASA (evidencia previa)** | E2E-10 (reinicio del servidor sin llamada activa). La reconexión durante una llamada termina la llamada (por diseño). |
| CP-011 Pérdida de señalización | Recovery | **PASA (evidencia previa)** | E2E-10; retroceso de 2 a 30 s probado en `connection.test.js`. |
| CP-012 WS inválidos | Sad/Security | **PASA** con observación ARQ-002 | 23 variantes: error controlado y la conexión sigue abierta. |
| CP-013 Tamaño excesivo | Boundary | **PASA** | > 32 KB → cierre 1009; 32 726 B → error de validación; chat de 500 caracteres aceptado y de 501 rechazado; body de login > 1 KB → 413. |
| CP-014 Duplicación en reconexión | Concurrency | **PASA (código + pruebas)** | `publicProfiles()` deduplica por sesión; pruebas en `peer-registry.test.js`. No se ejecutó una reconexión real durante una llamada. |
| CP-015 Acceso tras expulsión | Security | **NO EJECUTABLE**: no existe expulsión (SEC-003). | — |
| CP-016 Credenciales TURN | Security | **PASA** | No hay TURN; `welcome.iceServers` solo contiene URLs STUN sin credenciales (`config.js:32-43`). |
| CP-017 Tokens en logs | Security | **PASA** | 0 coincidencias del código de acceso, la cookie, nombres, IPs, SDP o candidatos en los logs de las instancias 3102 y 3103. |
| CP-018 Fin simultáneo | Concurrency | **PASA (evidencia previa)** | E2E-11 (desfase de clics de 0 ms); el servidor elimina la sesión en el primer `#end` y el segundo `hangUp` no encuentra sesión. |
| CP-019 Eventos de salas ajenas | Security | **PASA** | C recibió solo sus propios `call-ended` (busy/unavailable); `leakedCallId: false`. |
| CP-020 Errores sin secretos | Security | **PASA** | Errores HTTP genéricos (`Error interno`, `Solicitud mal formada`); el stack solo va al log del servidor. |

**Resumen:** 14 PASAN verificados por el auditor, 6 PASAN solo con evidencia previa de otra sesión (E2E con navegador: no se pudo re-ejecutar sin escribir en `docs/evidence/`), 1 PARCIAL (CP-005), 1 NO EJECUTABLE (CP-015).

### Concurrencia, rendimiento y resiliencia (Fase VI)
- **Hardware:** Intel i5-10300H, 8 núcleos lógicos, 15,8 GiB, Windows 11; carga y servidor en la misma máquina (loopback: no se mide pérdida, jitter ni RTT de red real).
- **Prueba propia** (10 → 50 → 100 clientes autenticados, IP loopback distintas, 4 clientes por IP; 112 sesiones creadas en 180 ms):
  - Conexión WS p95: 59,8 ms (100 clientes); invitación → `ringing` p95 28 ms; relevo de señal en un sentido p95 13,9 ms; RTT de sondeo p95 45 ms; colgar → `ended` en el otro lado p95 29,5 ms.
  - Memoria: heap 7,5 → 8,9 MiB tras todas las etapas (sin crecimiento sostenido); 281–284 *handles* estables; **0 conexiones y 0 llamadas pendientes tras drenar** (`callsStarted = callsEnded = 262`); 0 líneas de error en el log del servidor.
  - Tope por IP: 40 conexiones desde una IP → 30 aceptadas y 10 rechazadas (503).
  - **Ciclos completos: 50 % fallidos por *timeout* en todas las etapas**, con 448 mensajes rechazados por el limitador de señales. Resultado **no concluyente**: el reparto fijo de 4 clientes por IP agota el cupo compartido de 300 señales/10 s por IP. Es coherente con la limitación documentada («personas detrás de la misma IP comparten cupo»), pero no se descarta un defecto del script. La evidencia previa del proyecto (`docs/evidence/load/report.md`, 2026-11-12T00:39Z, 2 parejas por IP) reporta 150/150 ciclos correctos con 100 clientes y 0 recursos pendientes.
  - Amplificación de presencia: SEC-001. Conexiones lentas: SEC-007.
- **E2E de concurrencia y recuperación (evidencia previa):** E2E-10 (reinicio, caída de 547 ms, reacceso a 1 477 ms), E2E-11 (colgado simultáneo) y E2E-12 (logout durante la llamada) PASS.

### No ejecutado (declarado)
- `npm run e2e`, `npm run load`, `npm run scan:zap` y `npm run scan:security` del proyecto: escriben obligatoriamente en `docs/evidence/` (el auditor tiene prohibido modificar el proyecto). Se revisó su evidencia previa.
- SonarQube (fallo de Docker + API con token).
- Mutación global.
- Pruebas contra la red real (pérdida, jitter, TURN), MITM real de DTLS y fuzzing exhaustivo del protocolo.

---

## H. Plan de remediación (priorizado por riesgo, impacto y esfuerzo)

| # | ID | Archivo(s) | Cambio propuesto | Justificación | Riesgo de regresión | Prueba requerida | Criterio de aceptación |
|---|---|---|---|---|---|---|---|
| 1 | QA-001 | `stryker*.config.mjs`, `test/server/routes.test.js` | Matar los supervivientes de `routes.js:11/34`; ejecutar la mutación crítica y global en un equipo sin carga y publicar el informe con el hash | Bloqueante para A | Nulo (solo pruebas) | Informes de Stryker | Crítico ≥ 95 %, global ≥ 85 %, 0 `RuntimeError`, fuente = código |
| 2 | OPS-001 | `docs/evidence/*` | Re-ejecutar ZAP y escáneres tras congelar el código | Bloqueante (evidencia vigente) | Nulo | `scan:zap`, `scan:security` | APROBADO y `sourceStable: true` |
| 3 | SEC-001 | `peer-registry.js`, `routes.js`, `create-chat-server.js` | Limitador propio de presencia + *debounce* + deltas | DoS de ancho de banda confirmado | Medio (cliente de presencia) | Integración con 100 sockets falsos; carga | Amplificación < 50× |
| 4 | SEC-002 | `peer-registry.js`, `chat-room.js`, `validation.js`, `chat-view.js` | Reserva de nombre por sesión durante el TTL, id de sesión visible, confusables | Suplantación confirmada | Medio | Test de nombre tras desconexión y de homoglifos | Escenarios rechazados |
| 5 | SEC-004 | `create-chat-server.js`, `session-endpoint.js`, `logger` | Tope global de fallos y origen seudonimizado | Fuerza bruta distribuida | Bajo | Unitaria del limitador global | 32.º fallo → 429 |
| 6 | WRTC-001 | `security-code.js`, `privacy.html`, `texts.js` | Compromiso de huella o SAS ≥ 32 bits, y texto honesto | Falsa garantía anti-MITM | Medio (protocolo de señal) | Unitarias del esquema | Revelación inválida → aviso |
| 7 | OPS-002 | raíz, `ci.yml` | `git init`, acciones fijadas por SHA, una ejecución de CI verde | Trazabilidad | Bajo | CI | Enlace a una ejecución verde |
| 8 | SEC-003 | `session-endpoint.js`, nuevo `invite-store.js` | Invitaciones individuales revocables + expulsión | CP-005/CP-015 | Alto (flujo de acceso) | CP-005/CP-015 automatizados | Sockets cerrados con 4401 al revocar |
| 9 | SEC-005/006/007 | `config.js`, `chat-server.js` | Validación cruzada de `TRUST_CLOUDFLARE`, `HOST` explícito con TLS, `headersTimeout`/`maxConnections` | Endurecimiento | Bajo | Tests de `loadConfig` y de timeouts | Errores de arranque y cierre de sockets lentos ≤ 15 s |
| 10 | OPS-003, SEC-008, CAL-001, ARQ-002, DOC-001, PRIV-001 | varios | Ajustes menores (ver fichas) | Higiene | Bajo | Unitarias | Fichas cerradas |

---

## Puntuación (Fase X)

| Dimensión | Máx. | Puntos | Justificación |
|---|---|---|---|
| Arquitectura y separación de responsabilidades | 15 | **12** | Composición limpia, DI, 0 ciclos, 0 violaciones de capa; −3 por el modelo de un solo secreto sin identidad (ARQ-001/SEC-003), la ruta de chat implícita y la instancia única. |
| Código limpio y mantenibilidad | 15 | **13** | 0 funciones fuera de umbral (CC, cognitiva, longitud), 0 % de duplicación, lint limpio; −2 por la imposibilidad de verificar Sonar, las exportaciones muertas y la documentación contradictoria. |
| Seguridad de aplicación y controles OWASP | 20 | **15** | Controles fuertes verificados activamente (sin Críticos ni Altos); −5 por SEC-001 a SEC-004 (Media) y SEC-005 a SEC-008 (Baja). |
| Seguridad WebRTC y privacidad audiovisual | 15 | **11** | Señalización autorizada y secuenciada, DTLS-SRTP, ciclo de vida de medios correcto, aviso de privacidad; −4 por WRTC-001, la ausencia de TURN y relé, la ausencia de expulsión y aspectos de la LOPDP pendientes de revisión jurídica. |
| Pruebas automatizadas y mutación | 15 | **9** | 407/407, cobertura 99,87/99,65 %, ramas críticas 100 %; −6 porque la mutación crítica no está verificada (88,42 % la última completa), la global no existe y el E2E solo tiene evidencia previa no reproducida. |
| Concurrencia, rendimiento y resiliencia | 10 | **8** | Sin fugas, drenaje completo, latencias bajas, apagado ordenado y reconexión; −2 por la amplificación de presencia (impacto en disponibilidad), el slowloris sin cierre y un resultado de ciclos no concluyente. |
| Dependencias, DevSecOps y observabilidad | 10 | **6** | 1 dependencia de producción, 0 vulnerabilidades, imágenes fijadas por digest, contenedores endurecidos, logs limpios; −4 por la falta de git y CI, la compuerta de seguridad RECHAZADO, ZAP no aprobado o abortado, acciones por etiqueta y Sonar no verificable. |
| **TOTAL** | **100** | **74** | **Calificación C** |

---

## Privacidad y LOPDP (Fase IX)

- **Datos tratados:** audio y vídeo (solo P2P; el servidor no los recibe; verificado en el código), nombre visible (memoria del servidor y `localStorage` del navegador), mensajes (los últimos 100 en memoria, visibles para todo autenticado, incluidos quienes entran después), IP (usada en memoria para los limitadores; no se registra, verificado en los logs; se expone al par y al STUN), identificadores opacos (`peerId`, `sessionId`, `callId` en los logs), cookie de sesión.
- **Cumple (confirmado):** minimización en logs, no hay grabación, liberación de la cámara, retención volátil, aviso de privacidad accesible (`/privacy.html`, enlazado desde el acceso y el chat), cifrado en tránsito con TLS/DTLS-SRTP en despliegues remotos.
- **Riesgos (potenciales):** historial visible para recién llegados sin consentimiento explícito de los autores; atribución falsa de mensajes (SEC-002); IP revelada al par y a Cloudflare (PRIV-001); `localStorage` sin caducidad.
- **Requiere revisión jurídica:** identificación del responsable del tratamiento y de la base de legitimación (art. 7 LOPDP) para el uso con terceros; transferencia de la IP a Cloudflare (STUN y túnel) como encargado o transferencia internacional; procedimiento para ejercer derechos sobre los mensajes en memoria. No se confirma ningún incumplimiento grave de privacidad.

---

## I. Veredicto

# RECHAZADO — NO ALCANZA CALIFICACIÓN A

**Puntuación 74/100 (C).** Motivos: puntuación inferior a 95 y requisito obligatorio no verificable (mutation score crítico ≥ 95 % sobre el código actual; mutación global inexistente), con evidencias DAST y de cadena de suministro vigentes en estado no aprobado. No se encontraron vulnerabilidades críticas o altas confirmadas, ni accesos no autorizados a llamadas o medios, ni secretos activos expuestos, ni fugas de audio o vídeo. La aplicación está por encima de un Quality Gate convencional en código y controles básicos, pero no demuestra con evidencia reproducible el nivel A exigido.

---

### Anexo — Trazabilidad de la evidencia del auditor
Directorio del scratchpad del auditor (fuera del proyecto): `C:\Users\garci\AppData\Local\Temp\claude\826bcc43238bf356\8136e29a-8f36-4900-a6cd-549065918a57\scratchpad\`
- `sec/http-tests.out`, `http-extra.out`, `ws-tests.out`, `ws-logout.out`, `tls-cf-tests.out`, `unit-checks.out`, `server-3102.log`, `server-3103.log` (pruebas activas de seguridad).
- `final/spec.txt`, `final/lcov.info`, `final/eslint-metrics.json`, `final/dup.mjs` (pruebas, cobertura, complejidad y duplicación del código final).
- `tests/mutation/critical-audit.json` y `stryker-run.log` (mutación propia), `tests/mutation-evidence-now.txt` (verificación de la evidencia previa contra el código).
- `ops/load/run.mjs`, `run.out`, `report.json`, `server-log.jsonl` (carga propia), `sas-bench.mjs` (medición de WRTC-001).
- `import-graph.json`, `unused-exports.mjs`, `sonar-out.txt` (fallo del análisis Sonar).
