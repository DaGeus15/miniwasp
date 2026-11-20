import { CallPhase } from './call-phase.js';
import { mediaErrorKey } from './local-media.js';
import { CallEndReason } from '../../shared/events.js';

const END_NOTICE_KEYS = new Map([
  [CallEndReason.REJECTED, 'callRejected'],
  [CallEndReason.HANGUP, 'callEnded'],
  [CallEndReason.BUSY, 'callBusy'],
  [CallEndReason.UNAVAILABLE, 'callUnavailable'],
  [CallEndReason.DISCONNECTED, 'callDisconnected'],
  [CallEndReason.TIMEOUT, 'callTimedOut'],
]);

// Ciclo de vida de la llamada en el navegador. Coordina a sus colaboradores sin conocer
// el DOM, WebRTC ni el formato de los mensajes. Solo hay una llamada a la vez.
export class CallController {
  #signaling;
  #createMedia;
  #createLink;
  #view;
  #notices;
  #iceServers = [];
  #call = null;

  constructor({ signaling, createMedia, createLink, view, notices }) {
    this.#signaling = signaling;
    this.#createMedia = createMedia;
    this.#createLink = createLink;
    this.#view = view;
    this.#notices = notices;
  }

  useIceServers(iceServers) {
    this.#iceServers = iceServers;
  }

  async start(peer) {
    if (this.#call) {
      return;
    }
    const call = this.#open({ id: null, peer, phase: CallPhase.PREPARING });

    const isReady = await this.#acquireMedia(call);
    if (isReady && !this.#signaling.invite(peer.id)) {
      this.#leave('offline');
    }
  }

  async accept() {
    const call = this.#call;
    if (call?.phase !== CallPhase.INCOMING) {
      return;
    }
    this.#enterPhase(call, CallPhase.CONNECTING);

    const isReady = await this.#acquireMedia(call);
    if (isReady && this.#openLink(call)) {
      this.#signaling.accept(call.id);
    }
  }

  reject() {
    if (this.#call?.phase === CallPhase.INCOMING) {
      this.#signaling.reject(this.#call.id);
      this.#close();
    }
  }

  hangUp() {
    if (this.#call) {
      this.#leave();
    }
  }

  toggleMicrophone() {
    if (this.#call?.phase === CallPhase.ACTIVE) {
      this.#view.showMicrophoneEnabled(this.#call.media.toggleMicrophone());
    }
  }

  toggleCamera() {
    if (this.#call?.phase === CallPhase.ACTIVE) {
      this.#view.showCameraEnabled(this.#call.media.toggleCamera());
    }
  }

  handleRinging({ callId, peer }) {
    const call = this.#call;
    if (call?.id === null && call.peer.id === peer.id) {
      call.id = callId;
      this.#enterPhase(call, CallPhase.CALLING);
    } else {
      // El usuario colgo antes de que el servidor confirmara la invitacion.
      this.#signaling.hangUp(callId);
    }
  }

  handleIncoming({ callId, peer }) {
    if (this.#call) {
      this.#signaling.reject(callId);
      return;
    }
    this.#open({ id: callId, peer, phase: CallPhase.INCOMING });
  }

  handleAccepted({ callId }) {
    const call = this.#findCall(callId);
    if (!call) {
      return;
    }
    this.#enterPhase(call, CallPhase.CONNECTING);
    if (this.#openLink(call)) {
      call.link.startOffer();
    }
  }

  handleSignal({ callId, signal }) {
    this.#findCall(callId)?.link?.receive(signal);
  }

  handleEnded({ callId, reason }) {
    if (this.#findCall(callId)) {
      this.#close(END_NOTICE_KEYS.get(reason));
    }
  }

  handleConnectionLost() {
    if (this.#call) {
      this.#close('callDisconnected');
    }
  }

  #open({ id, peer, phase }) {
    const call = { id, peer, phase, media: this.#createMedia(), link: null };
    this.#call = call;
    this.#notices.clear();
    this.#enterPhase(call, phase);
    return call;
  }

  #findCall(callId) {
    return this.#call?.id === callId ? this.#call : null;
  }

  #enterPhase(call, phase) {
    call.phase = phase;
    this.#view.showPhase(phase, call.peer.name);
  }

  async #acquireMedia(call) {
    try {
      const stream = await call.media.acquire();
      if (stream === null) {
        return false;
      }
      this.#view.showLocalStream(stream);
      return true;
    } catch (error) {
      if (this.#call === call) {
        this.#leave(mediaErrorKey(error));
      }
      return false;
    }
  }

  #openLink(call) {
    try {
      call.link = this.#createLink({
        iceServers: this.#iceServers,
        stream: call.media.stream,
        onSignal: (signal) => this.#signaling.relay(call.id, signal),
        onRemoteStream: (stream) => this.#view.showRemoteStream(stream),
        onConnected: () => this.#activate(call),
        onFailed: () => this.#leave('callFailed'),
      });
      return true;
    } catch {
      this.#leave('callFailed');
      return false;
    }
  }

  async #activate(call) {
    this.#enterPhase(call, CallPhase.ACTIVE);
    const securityCode = await call.link.securityCode();
    if (this.#call === call && securityCode) {
      this.#view.showSecurityCode(securityCode);
    }
  }

  #leave(noticeKey) {
    if (this.#call.id !== null) {
      this.#signaling.hangUp(this.#call.id);
    }
    this.#close(noticeKey);
  }

  #close(noticeKey) {
    const { media, link } = this.#call;
    link?.close();
    media.release();
    this.#call = null;
    this.#view.hide();
    if (noticeKey) {
      this.#notices.show(noticeKey);
    }
  }
}
