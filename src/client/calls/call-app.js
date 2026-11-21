import { ServerEvent } from '../../shared/events.js';
import { CallController } from './call-controller.js';
import { CallSignaling } from './call-signaling.js';
import { CallView } from './call-view.js';
import { IceServerSource } from './ice-server-source.js';
import { LocalMedia } from './local-media.js';
import { PeerLink } from './peer-link.js';

function bindCallView(callView, calls) {
  callView.onAccept(() => calls.accept());
  callView.onReject(() => calls.reject());
  callView.onToggleMicrophone(() => calls.toggleMicrophone());
  callView.onToggleCamera(() => calls.toggleCamera());
  callView.onHangUp(() => calls.hangUp());
}

function createEventHandlers(calls, iceServers) {
  return new Map([
    [ServerEvent.WELCOME, (event) => iceServers.useWelcomeServers(event.iceServers)],
    [ServerEvent.CALL_RINGING, (event) => calls.handleRinging(event)],
    [ServerEvent.CALL_INCOMING, (event) => calls.handleIncoming(event)],
    [ServerEvent.CALL_ACCEPTED, (event) => calls.handleAccepted(event)],
    [ServerEvent.CALL_SIGNAL, (event) => calls.handleSignal(event)],
    [ServerEvent.CALL_ENDED, (event) => calls.handleEnded(event)],
  ]);
}

// Punto de composicion de la videollamada: la app solo conoce lo que devuelve esta funcion.
export function createCallFeature({ document, send, notices, request, schedule, getUserMedia, createPeerConnection }) {
  const callView = new CallView(document);
  const iceServers = new IceServerSource(request, schedule);
  const calls = new CallController({
    iceServers,
    schedule,
    signaling: new CallSignaling(send),
    view: callView,
    notices,
    createMedia: () => new LocalMedia(getUserMedia),
    createLink: (options) => new PeerLink({ ...options, createPeerConnection }),
  });
  bindCallView(callView, calls);

  return {
    eventHandlers: createEventHandlers(calls, iceServers),
    startCall: (peer) => calls.start(peer),
    handleConnectionLost: () => calls.handleConnectionLost(),
    handleConnectionRestored: () => calls.handleConnectionRestored(),
    handleRoomLeft: () => calls.handleRoomLeft(),
  };
}
