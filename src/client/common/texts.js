import { MAX_NAME_LENGTH, MAX_TEXT_LENGTH } from '../../shared/limits.js';

const ROOM_KIND_LABELS = new Map([
  ['private', () => 'Sala privada'],
  ['public', (title) => `Sala pública · ${title}`],
  ['whisper', () => 'Conversación privada entre dos'],
]);

// Unico lugar con los textos de la interfaz: para traducir la app basta con cambiar este archivo.
export const TEXTS = {
  online: 'En línea',
  reconnecting: 'Reconectando…',
  offline: 'Sin conexión con el servidor',
  invalidServerEvent: 'Se recibió una respuesta no válida del servidor',
  nameRequired: 'Escribe tu nombre',
  textRequired: 'Escribe un mensaje',
  nameTooLong: `El nombre supera ${MAX_NAME_LENGTH} caracteres`,
  textTooLong: `El mensaje supera ${MAX_TEXT_LENGTH} caracteres`,

  roomNotFound: 'La sala no existe o el enlace ya no es válido',
  roomsFull: 'No se pueden crear más salas por ahora. Inténtalo más tarde.',
  tooManyAttempts: 'Demasiados intentos. Espera un minuto.',
  serverUnreachable: 'No se pudo conectar con el servidor',
  invalidInvite: 'Pega el ID de invitación o el enlace completo',
  rulesRequired: 'Para entrar confirma que tienes 16 años o más y que aceptas las normas.',
  sessionExpired: 'Ya no estás en la sala: saliste, te sacaron o la sala se cerró.',
  inviteCopied: 'Enlace copiado',
  inviteCopyFailed: 'No se pudo copiar; comparte el ID manualmente',
  ownerBadge: 'Creó la sala',
  deleteAction: 'Borrar',
  reportAction: 'Reportar',
  reportSent: 'Gracias. Avisamos a quien creó la sala.',
  attachmentTooLarge: 'El archivo es demasiado grande',
  attachmentFailed: 'No se pudo enviar el archivo. Inténtalo de nuevo.',
  imageUnreadable: 'No se pudo leer la imagen. Prueba con una foto JPEG o PNG.',
  voiceUnsupported: 'Este navegador no puede grabar notas de voz',
  voiceDenied: 'Permite el acceso al micrófono para grabar notas de voz',
  recordVoice: 'Grabar nota de voz',
  stopVoice: 'Terminar y enviar la nota de voz',
  expelAction: 'Sacar',
  whisperAction: 'Susurrar',
  whisperActionLabel: (name) => `Invitar a ${name} a una sala privada`,
  whisperIncoming: (name) => `${name} quiere hablar contigo en privado. Si aceptas, pasarán juntos a una sala solo para ustedes dos.`,
  whisperSent: 'Invitación enviada. Esperando respuesta…',
  whisperRejected: 'La invitación a hablar en privado no fue aceptada',
  whisperTimeout: 'La invitación a hablar en privado venció',
  whisperUnavailable: 'Esa persona no está disponible para hablar en privado',
  roomKind: (visibility, title) => ROOM_KIND_LABELS.get(visibility)?.(title) ?? '',
  publicRoomsEmpty: 'No hay salas públicas abiertas. ¡Crea la primera!',
  publicRoomsUnavailable: 'No se pudo cargar la lista de salas públicas',
  publicRoomMembers: (members, capacity) => `${members} de ${capacity} personas`,
  publicRoomJoin: 'Entrar',
  publicRoomJoinLabel: (title) => `Entrar a la sala pública ${title}`,
  roomTitleInvalid: 'Escribe un título de hasta 40 caracteres',
  roomTitleBlocked: 'Ese título no está permitido en una sala pública',
  bannedFromRoom: 'Te sacaron de esa sala y no puedes volver a entrar',
  expelActionLabel: (name) => `Sacar a ${name} de la sala`,

  callAction: 'Videollamar',
  callActionLabel: (name) => `Videollamar a ${name}`,
  callPreparing: 'Preparando la cámara…',
  callCalling: 'Llamando…',
  callIncoming: 'Videollamada entrante',
  callConnecting: 'Conectando…',
  callActive: 'En llamada',
  securityCode: (code) => `Código de seguridad: ${code}. Compruébalo con la otra persona.`,
  microphoneOn: 'Silenciar',
  microphoneOff: 'Activar micrófono',
  cameraOn: 'Apagar cámara',
  cameraOff: 'Encender cámara',

  callRejected: 'La persona rechazó la llamada',
  callEnded: 'La llamada terminó',
  callBusy: 'La persona está en otra llamada',
  callUnavailable: 'La persona ya no está conectada',
  callDisconnected: 'Se perdió la conexión de la llamada',
  callTimedOut: 'La persona no contestó',
  callFailed: 'No se pudo establecer la videollamada',

  mediaDenied: 'Permite el acceso a la cámara y al micrófono para hacer videollamadas',
  mediaMissing: 'No se encontró una cámara o un micrófono',
  mediaInUse: 'Otra aplicación está usando la cámara o el micrófono',
  mediaUnavailable: 'Este navegador no permite usar la cámara aquí. Abre la app con HTTPS o en localhost',
};

const TEXTS_BY_KEY = new Map(Object.entries(TEXTS));

// Las claves llegan de otros modulos; una clave desconocida devuelve undefined en vez de
// exponer propiedades heredadas del objeto.
export function textFor(key) {
  return TEXTS_BY_KEY.get(key);
}
