# Seguridad WebRTC y privacidad audiovisual

## Modelo

Llamadas de dos personas, P2P. Una "sala" es una `CallSession` del servidor: tiene un id UUID
aleatorio, exactamente dos participantes (quien llama y quien recibe) y existe solo mientras dura
la llamada. La "invitación" es el evento `call-invite`; revocarla es colgar mientras suena.
"Expulsar" a alguien equivale a revocar su sesión (`DELETE /session`), que cierra todas sus
conexiones; también termina su llamada.

## Señalización

| Control | Implementación | Prueba |
|---|---|---|
| Autenticación antes de cualquier evento | El handshake WebSocket exige una sesión válida (`create-chat-server.js`, `rejectionStatus`) | `rooms.test.js` |
| Autorización por llamada | `CallSession.includes`, `awaitsAnswerFrom`, `canSignal`: solo los dos participantes actúan sobre su llamada | `call-coordinator.test.js`, `videocall.test.js`, CP-004/CP-019 |
| Validación de SDP e ICE | `sanitizeSignal` reconstruye cada señal campo por campo con tipos y longitudes máximas (SDP 30 000, candidato 1 024) | `signal.test.js` |
| Tamaño de mensaje | `maxPayload` 32 KB; el exceso cierra la conexión con 1009 | `create-chat-server.test.js` |
| Orden de la negociación | Una oferta de quien llama, una respuesta de quien recibe, candidatos solo después de la propia descripción; repetidos o fuera de orden se descartan | `call-coordinator.test.js` (orden de la negociación) |
| Sin fugas de IP antes de aceptar | Ninguna señal se reenvía mientras la llamada suena; la cámara de quien recibe no se enciende hasta aceptar | `videocall.test.js`, `call-controller.test.js` |
| Suplantación de participantes | El autor de mensajes y llamadas es la identidad de la conexión; un nombre pertenece a una sesión y no puede usarlo otra | `routes.test.js` (SEC-002), `rooms.test.js`, `peer-registry.test.js` |
| Reconexiones | Cada conexión recibe un id nuevo; la presencia muestra una sola vez a cada sesión | CP-014 en `peer-registry.test.js` |
| Revocación y expiración | Salir revoca la sesión y cierra sus sockets con 4401; las sesiones vencen a las 8 h y el heartbeat cierra sus sockets | `rooms.test.js` |
| Ids de llamada ajenos | Mensajes sobre llamadas ajenas o terminadas se ignoran sin respuesta, para no revelar si el id existe | `call-coordinator.test.js` |
| Llamadas sin respuesta | Terminan a los 30 s | `videocall.test.js` |

## Transporte

- **Medios:** WebRTC exige DTLS-SRTP; la app no ofrece ningún modo sin cifrar ni lo puede
  desactivar. Las pistas solo existen dentro de `RTCPeerConnection`.
- **Señalización:** en red local se usa HTTPS/WSS con certificado propio (`npm run start:lan`); por
  el túnel, Cloudflare termina TLS y la app envía HSTS. Por HTTP plano la app solo escucha en
  `127.0.0.1`.
- **Huellas DTLS:** el navegador valida que la huella de la conexión coincida con la del SDP
  recibido. Como el SDP pasa por el servidor, un servidor comprometido podría sustituirla. Para
  detectarlo, ambos participantes ven un **código de seguridad de 6 dígitos** derivado con SHA-256
  de las dos huellas ordenadas (`src/client/calls/security-code.js`). Si los códigos que se dicen
  en voz alta no coinciden, alguien intercepta la llamada.
- **No es cifrado de extremo a extremo frente al servidor.** La app no lo declara. DTLS-SRTP P2P
  cifra entre los dos navegadores y el servidor nunca recibe medios, pero la autenticidad de las
  claves depende del código de seguridad verificado por las personas.
- **TURN:** no se usa. No hay credenciales de relay que exponer: el cliente solo recibe URLs STUN
  (CP-016). Consecuencia: en redes que bloquean la conexión directa la llamada falla con un aviso.

## Privacidad de participantes

| Aspecto | Comportamiento |
|---|---|
| Consentimiento de cámara y micrófono | Solo se piden al pulsar Videollamar o Contestar; el navegador muestra su propio aviso |
| Indicador de captura | Vista previa propia visible durante la llamada, además del indicador del navegador |
| Silenciar y apagar cámara | Cambian `track.enabled`; el botón refleja el estado con `aria-pressed` |
| Liberación | Al terminar por cualquier motivo se detienen todas las pistas, incluso si la llamada terminó mientras se pedía el permiso (`LocalMedia.release`) |
| Grabaciones | No existen; ni el cliente ni el servidor graban audio o video |
| Metadatos | El servidor registra ids opacos y motivos, nunca nombres, mensajes, SDP, IP ni tokens (CP-017) |
| IP por ICE | Solo se intercambian candidatos después de aceptar; la otra persona y el STUN ven la IP |

## Ciclo de vida verificado

```text
  [sin llamada] --invite--> [sonando] --accept--> [negociando] --oferta/respuesta--> [activa]
       ^                        |  reject / cancel / 30 s          |  hangup / desconexión / fallo
       |                        v                                  v
       +----------------- [terminada: medios detenidos, recursos liberados] <-----+
```

Cada transición está cubierta por pruebas unitarias (`call-coordinator`, `call-controller`), de
integración con sockets reales (`videocall`, `audit-scenarios`) y E2E con dos navegadores
(`npm run e2e`, evidencia en `docs/evidence/e2e/`).
