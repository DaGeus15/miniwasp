const HTML_TYPE = 'text/html; charset=utf-8';
const CSS_TYPE = 'text/css; charset=utf-8';
const JAVASCRIPT_TYPE = 'text/javascript; charset=utf-8';
const SVG_TYPE = 'image/svg+xml';

// Las rutas son relativas a src: la URL coincide con el disco para que los import
// funcionen igual en el navegador. El codigo del servidor nunca se publica.
const JAVASCRIPT_MODULES = [
  'client/app.js',
  'client/attachments/attachment-app.js',
  'client/attachments/attachment-client.js',
  'client/attachments/attachment-composer.js',
  'client/attachments/attachment-picker-view.js',
  'client/attachments/attachment-renderer.js',
  'client/attachments/image-preparer.js',
  'client/attachments/voice-recorder-view.js',
  'client/attachments/voice-recorder.js',
  'client/calls/call-app.js',
  'client/calls/call-controller.js',
  'client/calls/call-phase.js',
  'client/calls/call-signaling.js',
  'client/calls/call-view.js',
  'client/calls/local-media.js',
  'client/calls/peer-link.js',
  'client/calls/security-code.js',
  'client/rooms/home-view.js',
  'client/rooms/invite-link.js',
  'client/rooms/public-rooms-view.js',
  'client/rooms/room-access.js',
  'client/rooms/room-app.js',
  'client/rooms/room-bar-view.js',
  'client/rooms/room-client.js',
  'client/rooms/room-controller.js',
  'client/rooms/room-signaling.js',
  'client/chat/chat-app.js',
  'client/chat/chat-view.js',
  'client/chat/connection.js',
  'client/chat/name-store.js',
  'client/common/dom.js',
  'client/common/stored-value.js',
  'client/common/texts.js',
  'client/presence/presence-controller.js',
  'client/presence/presence-view.js',
  'client/whispers/whisper-app.js',
  'client/whispers/whisper-controller.js',
  'client/whispers/whisper-view.js',
  'shared/attachments.js',
  'shared/draft.js',
  'shared/events.js',
  'shared/limits.js',
  'shared/server-event.js',
  'shared/signal.js',
];

const STYLE_IMAGES = [
  'client/styles/icon.svg',
  'client/styles/icon-camera.svg',
  'client/styles/icon-camera-off.svg',
  'client/styles/icon-hangup.svg',
  'client/styles/icon-mic.svg',
  'client/styles/icon-mic-off.svg',
];

// Lista cerrada de archivos: la URL nunca se usa para construir una ruta.
export const PUBLIC_ASSETS = new Map([
  ['/', { file: 'client/index.html', type: HTML_TYPE }],
  ['/privacy.html', { file: 'client/privacy.html', type: HTML_TYPE }],
  ['/rules.html', { file: 'client/rules.html', type: HTML_TYPE }],
  ['/client/styles/style.css', { file: 'client/styles/style.css', type: CSS_TYPE }],
  ...STYLE_IMAGES.map((file) => [`/${file}`, { file, type: SVG_TYPE }]),
  ...JAVASCRIPT_MODULES.map((file) => [`/${file}`, { file, type: JAVASCRIPT_TYPE }]),
]);
