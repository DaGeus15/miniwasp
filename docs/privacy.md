# Privacidad y protección de datos

Inventario de los datos que trata la aplicación y cómo se aplican los principios de la Ley
Orgánica de Protección de Datos Personales del Ecuador (LOPDP). Este documento describe el
comportamiento técnico; la evaluación jurídica de un despliegue concreto corresponde a quien lo
opere. La versión para las personas usuarias es `src/client/privacy.html` (`/privacy.html`).

## Inventario

| Dato | Dónde | Finalidad | Retención | Quién lo ve |
|---|---|---|---|---|
| Audio y video | Solo entre los dos navegadores (DTLS-SRTP) | La llamada | No se almacena | La otra persona de la llamada |
| Nombre visible | Memoria del servidor y `localStorage` del navegador | Identificarse en el chat | Mientras exista la sala; el navegador lo recuerda hasta que se borre | Personas de la sala. **Nunca aparece en la lista de salas públicas** |
| Título de una sala pública | Memoria del servidor | Mostrar la sala en la lista pública | Mientras exista la sala | **Cualquiera**, sin entrar: portada y `GET /api/v1/rooms/public` |
| Ocupación de una sala pública | Calculada al pedir la lista | Elegir una sala con lugar | No se guarda | Cualquiera: solo el número de personas conectadas y el cupo |
| Mensajes de chat | Memoria del servidor | Conversación | Últimos 100 por sala; se borran al borrar el mensaje, al cerrarse la sala o al reiniciar | Personas de la sala |
| Adjuntos (fotos, notas de voz, PDF, texto) | Bucket compatible con S3 (Railway Buckets) **cifrados con AES-256-GCM**; en desarrollo, memoria del proceso | Compartirlos en la sala | Hasta que se borra el mensaje, sale del historial o se cierra la sala; si nunca se envían, 5 minutos | Personas de la sala. El proveedor del bucket solo ve datos cifrados, su tamaño y su hora |
| Clave de cifrado de la sala | Solo memoria del servidor | Descifrar los adjuntos de la sala | Se sobrescribe con ceros al cerrarse la sala | Nadie |
| Metadatos de fotos (EXIF, GPS) | Se eliminan en el navegador antes de enviar y otra vez en el servidor | — | No se conservan | Nadie |
| Contenido bloqueado por la moderación | Memoria del servidor solo mientras se analiza | Decidir si se publica | No se guarda ni se registra | Nadie; el registro solo dice la categoría |
| Faltas de moderación | Memoria del servidor, asociadas a la sesión | Silenciar o expulsar a quien insiste | Ventana de 15 minutos; se olvidan al cerrarse la sesión | Nadie |
| Reportes de mensajes | Memoria del servidor | Avisar a quien creó la sala y borrar con 3 reportes | Lo que dure el mensaje | Quien creó la sala ve cuántos reportes hay, no quién reportó |
| Aceptación de las normas | `localStorage` del navegador (`miniwasp-rules-accepted`) | No volver a marcar la casilla | Hasta que se borren los datos del sitio | Nadie más |
| Token de sesión | Cookie `HttpOnly`; el servidor guarda solo su hash | Autenticación | 8 horas, al salir o al cerrarse la sala | Nadie (ni el JavaScript de la página) |
| Dirección IP | Memoria del servidor (límites y cupos) | Seguridad | Mientras dure la ventana del límite o la conexión | Nadie; no se registra |
| Huella seudónima de la IP (HMAC con una clave aleatoria del proceso) | Memoria del servidor: en cada sesión y, si alguien es expulsado de una sala pública, en su lista de vetos | Impedir que vuelva quien fue expulsado de una sala pública; correlacionar registros | La de la sesión, lo que dure la sesión; la del veto, **lo que dure la sala** (como mucho 500 por sala) | Nadie; nunca se guarda la IP |
| Preferencia de no recibir susurros | Memoria del servidor (por sesión) y `localStorage` (`miniwasp-accepts-whispers`) | Respetar la decisión de no recibir invitaciones | Lo que dure la sesión; el navegador la recuerda hasta que se borre | Nadie; quien invita solo ve "no disponible" |
| Pase de traslado a un susurro | Memoria del servidor | Mudar a cada persona al susurro | Un solo uso, 60 segundos | Solo la persona que lo recibió |
| IP en candidatos ICE | Navegador de la otra persona, servidor STUN y, si está configurado, el TURN de Cloudflare | Establecer la conexión (directa o retransmitida) | No se almacena en MiniWasp | La otra persona tras aceptar; el STUN; el TURN, que retransmite el audio y el video cifrados sin poder verlos |
| Registros técnicos | Salida estándar del proceso | Diagnóstico | Lo que defina el operador | Operador; solo ids opacos, categorías y motivos |

## Principios

- **Minimización:** no hay cuentas, correos ni datos de contacto. Los registros no incluyen nombres,
  mensajes, nombres de archivo, contenido bloqueado, SDP, IP ni tokens (prueba CP-017). La lista de
  salas públicas solo muestra título y ocupación: nunca nombres, ids internos ni invitaciones. Los
  vetos guardan solo huellas HMAC, no direcciones. Las fotos
  pierden sus metadatos dos veces: en el navegador, que las vuelve a dibujar como JPEG de 1 600 px
  como máximo, y en el servidor, que las re-codifica desde los píxeles.
- **Limitación de la finalidad:** los datos solo se usan para la sala, la llamada en curso y la
  seguridad de la sala (moderación).
- **Retención mínima:** mensajes, sesiones y claves viven en memoria. Los adjuntos son lo único que
  sale del proceso, siempre cifrados, y se borran con su mensaje o con la sala. Al cerrarse la sala
  su clave se destruye (*crypto-shredding*): aunque el proveedor conservara una copia, sería ilegible.
- **Sin terceros para el contenido:** la moderación de texto e imágenes corre dentro del servidor
  (diccionario propio y modelo nsfwjs empaquetado con la aplicación). Ninguna foto ni mensaje se
  envía a servicios de análisis externos. El proveedor del bucket actúa como encargado del
  almacenamiento, pero solo recibe datos cifrados.
- **Seguridad:** cifrado en tránsito (HTTPS/WSS, DTLS-SRTP, `https` hacia el bucket) y en reposo para
  los adjuntos (AES-256-GCM, clave por sala); control de acceso por invitación; cookies protegidas;
  los adjuntos solo se entregan a personas de su sala; sin grabaciones.
- **Consentimiento y transparencia:** para crear o entrar a una sala hay que aceptar las normas de la
  comunidad (`/rules.html`, edad mínima de 16 años). El título de una sala pública es público por
  definición, y las normas lo explican. Un susurro solo empieza si la otra persona lo acepta. La cámara y el micrófono solo se activan cuando
  la persona pulsa Videollamar, Contestar o graba una nota de voz, tras el permiso del navegador.
- **Derechos de los titulares:** cada persona puede borrar sus mensajes (y sus adjuntos) para todas las
  personas de la sala. Lo demás se elimina al cerrarse la sala o al reiniciar el servidor. El nombre y
  la aceptación de las normas guardados en el navegador se eliminan borrando los datos del sitio.

## Pendientes para un despliegue real

- Definir la retención de los registros del proceso en el entorno de despliegue.
- Evaluar a los servidores STUN y TURN de un tercero (Cloudflare) y al proveedor del bucket (Railway) como
  encargados del tratamiento, con el contrato correspondiente.
- Definir un contacto para solicitudes de las personas titulares y avisos de contenido ilegal (ver
  [moderation.md](moderation.md)).
