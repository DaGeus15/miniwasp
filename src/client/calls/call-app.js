import { ServerEvent } from '../../shared/events.js';
import { CallController } from './call-controller.js';
import { CallSignaling } from './call-signaling.js';
import { CallView } from './call-view.js';
import { LocalMedia } from './local-media.js';
import { PeerLink } from './peer-link.js';

function bindCallView(callView, calls) {
  callView.onAccept(() => calls.accept());
  callView.onReject(() => calls.reject());
  callView.onToggleMicrophone(() => calls.toggleMicrophone());
  callView.onToggleCamera(() => calls.toggleCamera());
  callView.onHangUp(() => calls.hangUp());
}

function createEventHandlers(calls) {
  return new Map([
    [ServerEvent.WELCOME, (event) => calls.useIceServers(event.iceServers)],
    [ServerEvent.CALL_RINGING, (event) => calls.handleRinging(event)],
    [ServerEvent.CALL_INCOMING, (event) => calls.handleIncoming(event)],
    [ServerEvent.CALL_ACCEPTED, (event) => calls.handleAccepted(event)],
    [ServerEvent.CALL_SIGNAL, (event) => calls.handleSignal(event)],
    [ServerEvent.CALL_ENDED, (event) => calls.handleEnded(event)],
  ]);
}

// Punto de composicion de la videollamada: la app solo conoce lo que devuelve esta funcion.
export function createCallFeature({ document, send, notices, getUserMedia, createPeerConnection }) {
  const callView = new CallView(document);
  const calls = new CallController({
    signaling: new CallSignaling(send),
    view: callView,
    notices,
    createMedia: () => new LocalMedia(getUserMedia),
    createLink: (options) => new PeerLink({ ...options, createPeerConnection }),
  });
  bindCallView(callView, calls);

  return {
    eventHandlers: createEventHandlers(calls),
    startCall: (peer) => calls.start(peer),
    handleConnectionLost: () => calls.handleConnectionLost(),
  };
}
