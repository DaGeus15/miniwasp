import { startChat } from './chat/chat-app.js';

await startChat({
  document,
  location: {
    protocol: location.protocol,
    host: location.host,
    origin: location.origin,
    readHash: () => location.hash,
    // Quita la invitacion de la barra de direcciones para que no quede en el historial.
    clearHash: () => history.replaceState(null, '', location.pathname),
  },
  createSocket: (url) => new WebSocket(url),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  getStorage: () => localStorage,
  // Es async para que un contexto sin mediaDevices (HTTP en la red local) rechace la promesa.
  getUserMedia: async (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createPeerConnection: (configuration) => new RTCPeerConnection(configuration),
  createMediaRecorder: (stream, options) => new MediaRecorder(stream, options),
  isRecordingTypeSupported: (type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
  createImageBitmap: (blob) => createImageBitmap(blob),
  createCanvas: () => document.createElement('canvas'),
  request: (path, options) => fetch(path, options),
  copyText: (text) => navigator.clipboard.writeText(text),
});
