# Prueba de carga de senalizacion MiniWasp

Generado por `npm run load` (scripts/load/run-signaling-load.mjs) el 2026-11-12T00:39:37.298Z.

## Entorno

| Dato | Valor |
|---|---|
| os | Windows_NT 10.0.26300 (win32 x64) |
| osVersion | Windows 11 Home |
| cpuModel | Intel(R) Core(TM) i5-10300H CPU @ 2.50GHz |
| logicalCores | 8 |
| totalMemoryGiB | 15.8 |
| nodeVersion | v24.11.0 |
| date | 2026-11-12T00:39:37.298Z |
| appUrl | https://127.0.0.1:54378 (puerto libre de esta corrida) |

## Como reproducir

- `npm install`
- `npm run load`

## Diseno y limites

- Todo corre en una sola maquina: el generador de carga comparte CPU con el servidor y la red es loopback (sin latencia ni perdida reales).
- Los limites del servidor son por IP. Si todos los clientes salieran de 127.0.0.1 solo cabrian 30 conexiones, 20 invitaciones/30 s y 300 senales/10 s en total. Para simular varios equipos cada cliente usa su propia direccion de origen loopback (127.0.x.y), 4 clientes por direccion, y cada etapa usa un rango distinto.
- Sesiones: una por usuario simulado via POST /session con cabecera Origin; como el acceso admite 6 intentos/min por IP, cada direccion de acceso hace 4. La cookie no esta atada a la IP, asi que la conexion WebSocket puede salir de otra direccion.
- Carga por IP y etapa: 2 parejas x 3 ciclos = 6 invitaciones (limite 20/30 s) y 148 mensajes del limitador de senales (limite 300/10 s). No se envia chat (limite 10/5 s).
- Ciclo por pareja: invite -> ringing/incoming, accept -> accepted, offer y answer con SDP sintetico de 5920 caracteres (tamano de la oferta real observada en E2E-03), 10 candidatos de sondeo ida y vuelta y hangup -> call-ended en ambos lados. Ciclos secuenciales por pareja; parejas en paralelo.
- Despues de los ciclos los clientes quedan conectados 3000 ms (CPU en reposo con N conexiones) y luego se desconectan; se espera a que /metrics muestre connectionsActive=0 y callsActive=0.
- CPU y memoria del proceso del servidor se muestrean cada 500 ms desde afuera (PowerShell Get-Process: TotalProcessorTime, WorkingSet64, PrivateMemorySize64). CPU expresada como % de un nucleo. No se fuerza la recoleccion de basura.

## Resultados por etapa

| Etapa | Clientes | IPs origen | Conectados | Conexion ms p50/p95/p99 | Presencia converge (ms) | Ciclos OK | RTT senal A->B->A ms p50/p95/p99 | invite->ringing ms p50/p95/p99 | Relevo 1 sentido ms p50/p95/p99 | CPU % 1 nucleo prom/pico | WS pico MiB | WS tras desconectar MiB | Errores | conn/calls tras desconectar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1-10 | 10 | 3 | 10/10 | 43.39 / 47.76 / 47.76 (n=10) | 12.1 | 15/15 | 1.78 / 3.06 / 4.07 (n=150) | 2.77 / 4.56 / 4.56 (n=15) | 2.43 / 3.26 / 4.68 (n=60) | 37.9 / 40.5 | 78.1 | 68.4 | 0 | 0 / 0 |
| S2-25 | 25 | 7 | 25/25 | 99.86 / 103.92 / 104.91 (n=25) | 25.4 | 36/36 | 3.8 / 5.6 / 6.27 (n=360) | 5.63 / 7.53 / 7.56 (n=36) | 4.88 / 6.77 / 7.63 (n=144) | 64.4 / 69.7 | 69.6 | 67.6 | 0 | 0 / 0 |
| S3-50 | 50 | 13 | 50/50 | 171.39 / 185.51 / 188.5 (n=50) | 128.6 | 75/75 | 7.56 / 11.86 / 12.86 (n=750) | 9.77 / 14.2 / 16.36 (n=75) | 8.62 / 13.47 / 14.72 (n=300) | 56.5 / 102.6 | 76.8 | 70.0 | 0 | 0 / 0 |
| S4-100 | 100 | 25 | 100/100 | 391.07 / 418.21 / 420.6 (n=100) | 599.3 | 150/150 | 14.9 / 17.25 / 30.71 (n=1500) | 22.49 / 41.17 / 41.32 (n=150) | 17.05 / 35.98 / 41.26 (n=600) | 70.8 / 139.8 | 108.5 | 76.5 | 0 | 0 / 0 |
| S5-150 | 150 | 38 | 150/150 | 521.97 / 561.21 / 565.91 (n=150) | 1762.7 | 225/225 | 19.92 / 27.6 / 29.86 (n=2250) | 27.83 / 43.63 / 46.2 (n=225) | 24.92 / 46.47 / 47.59 (n=900) | 65.3 / 118.8 | 191.4 | 86.8 | 0 | 0 / 0 |
| R1-100 | 100 | 25 | 100/100 | 387.68 / 420.09 / 423.18 (n=100) | 563.6 | 150/150 | 12.35 / 16.29 / 21.07 (n=1500) | 19.58 / 24.47 / 24.76 (n=150) | 16.31 / 28.38 / 29.08 (n=600) | 71.5 / 117.9 | 138.8 | 78.1 | 0 | 0 / 0 |
| R2-100 | 100 | 25 | 100/100 | 306.42 / 331.92 / 333.73 (n=100) | 443.3 | 150/150 | 11.62 / 14.61 / 14.96 (n=1500) | 14.27 / 19.83 / 19.92 (n=150) | 13.03 / 19.64 / 23.16 (n=600) | 57.1 / 104.2 | 115.5 | 77.6 | 0 | 0 / 0 |

RTT senal A->B->A: candidato de sondeo enviado por A, reenviado por el servidor a B, devuelto por B y reenviado a A (dos pasos por el servidor). Relevo 1 sentido: invite->incoming, accept->accepted, offer y answer medidos en el mismo proceso.

## Topes de conexion

| Prueba | Descripcion | Intentos | IPs origen | Aceptadas | Rechazos por codigo HTTP | connectionsActive al final | Resultado |
|---|---|---|---|---|---|---|---|
| B1-tope-por-IP | 31 conexiones desde 127.0.0.1 (tope por IP 30) | 31 | 1 | 30 (esperado 30) | {"503":1} | 0 | **PASS** |
| B2-tope-total | 205 conexiones desde 52 IPs (tope total 200) | 205 | 52 | 200 (esperado 200) | {"503":5} | 0 | **PASS** |

## Memoria y fugas

| Momento | Heap usado tras GC forzado MiB | Heap total MiB | Working set MiB | Privada MiB |
|---|---|---|---|---|
| Reposo tras arrancar | 7.52 | 9.05 | 65.7 | 32.6 |
| Tras crear 206 sesiones | 9.43 | 11.05 | 76.4 | 50.7 |
| Tras S1-10 (desconectados) | 8.82 | 10.3 | 68.4 | 36.6 |
| Tras S2-25 (desconectados) | 8.9 | 10.55 | 67.6 | 34.6 |
| Tras S3-50 (desconectados) | 8.98 | 10.55 | 70 | 37.7 |
| Tras S4-100 (desconectados) | 8.2 | 10.55 | 76.5 | 44.8 |
| Tras S5-150 (desconectados) | 8.34 | 11.3 | 86.8 | 57.4 |
| Tras R1-100 (desconectados) | 8.38 | 10.8 | 78.1 | 46.4 |
| Tras R2-100 (desconectados) | 8.42 | 11.3 | 77.6 | 46.2 |
| Final tras 15 s de reposo | 8.32 | 10.55 | 67.8 | 37.4 |

Criterio: con GC forzado, el heap usado final no supera en mas de 10 % al medido tras desconectar la primera etapa (las 206 sesiones ya existen en ese punto y siguen vivas por diseno, TTL 8 h). Resultado: **PASS** (referencia 8.82 MiB, final 8.32 MiB, limite 9.70 MiB).

## Veredicto

**PASS**: todas las etapas completaron sus ciclos sin errores y los contadores volvieron a 0.
