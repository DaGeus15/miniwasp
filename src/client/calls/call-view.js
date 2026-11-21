import { CallPhase } from './call-phase.js';
import { TEXTS } from '../common/texts.js';

const Control = Object.freeze({
  ACCEPT: 'accept',
  REJECT: 'reject',
  MICROPHONE: 'microphone',
  CAMERA: 'camera',
  HANG_UP: 'hangUp',
});

// Cada fase declara que muestra; para agregar una fase no hay que tocar la logica de la vista.
const PHASE_LAYOUTS = new Map([
  [CallPhase.PREPARING, { status: TEXTS.callPreparing, controls: [Control.HANG_UP] }],
  [CallPhase.CALLING, { status: TEXTS.callCalling, controls: [Control.HANG_UP] }],
  [CallPhase.INCOMING, { status: TEXTS.callIncoming, controls: [Control.ACCEPT, Control.REJECT] }],
  [CallPhase.CONNECTING, { status: TEXTS.callConnecting, controls: [Control.HANG_UP] }],
  [
    CallPhase.ACTIVE,
    { status: TEXTS.callActive, controls: [Control.MICROPHONE, Control.CAMERA, Control.HANG_UP] },
  ],
]);

function renderToggle(button, isEnabled, enabledText, disabledText) {
  button.textContent = isEnabled ? enabledText : disabledText;
  button.setAttribute('aria-pressed', String(!isEnabled));
}

export class CallView {
  #panel;
  #peerName;
  #status;
  #securityCode;
  #localVideo;
  #remoteVideo;
  #reconnecting;
  #controls;

  constructor(document) {
    this.#panel = document.querySelector('#call');
    this.#peerName = document.querySelector('#call-peer');
    this.#status = document.querySelector('#call-status');
    this.#securityCode = document.querySelector('#call-security-code');
    this.#localVideo = document.querySelector('#local-video');
    this.#remoteVideo = document.querySelector('#remote-video');
    this.#reconnecting = document.querySelector('#call-reconnecting');
    this.#controls = new Map([
      [Control.ACCEPT, document.querySelector('#call-accept')],
      [Control.REJECT, document.querySelector('#call-reject')],
      [Control.MICROPHONE, document.querySelector('#call-microphone')],
      [Control.CAMERA, document.querySelector('#call-camera')],
      [Control.HANG_UP, document.querySelector('#call-hangup')],
    ]);
  }

  onAccept(handler) {
    this.#onControl(Control.ACCEPT, handler);
  }

  onReject(handler) {
    this.#onControl(Control.REJECT, handler);
  }

  onToggleMicrophone(handler) {
    this.#onControl(Control.MICROPHONE, handler);
  }

  onToggleCamera(handler) {
    this.#onControl(Control.CAMERA, handler);
  }

  onHangUp(handler) {
    this.#onControl(Control.HANG_UP, handler);
  }

  showPhase(phase, peerName) {
    const { status, controls } = PHASE_LAYOUTS.get(phase);

    // textContent evita XSS: el nombre lo escribio otro usuario.
    this.#peerName.textContent = peerName;
    this.#status.textContent = status;
    this.#panel.hidden = false;

    for (const [control, button] of this.#controls) {
      button.hidden = !controls.includes(control);
    }
    this.#controls.get(controls[0]).focus();
  }

  showSecurityCode(code) {
    this.#securityCode.textContent = TEXTS.securityCode(code);
    this.#securityCode.hidden = false;
  }

  showLocalStream(stream) {
    this.#localVideo.srcObject = stream;
    this.#localVideo.hidden = false;
  }

  showRemoteStream(stream) {
    this.#remoteVideo.srcObject = stream;
  }

  showReconnecting(isReconnecting) {
    this.#reconnecting.hidden = !isReconnecting;
  }

  showMicrophoneEnabled(isEnabled) {
    renderToggle(
      this.#controls.get(Control.MICROPHONE),
      isEnabled,
      TEXTS.microphoneOn,
      TEXTS.microphoneOff,
    );
  }

  showCameraEnabled(isEnabled) {
    renderToggle(this.#controls.get(Control.CAMERA), isEnabled, TEXTS.cameraOn, TEXTS.cameraOff);
  }

  hide() {
    this.#panel.hidden = true;
    this.showReconnecting(false);
    this.#securityCode.hidden = true;
    this.#securityCode.textContent = '';
    this.#localVideo.hidden = true;
    this.#localVideo.srcObject = null;
    this.#remoteVideo.srcObject = null;
    this.showMicrophoneEnabled(true);
    this.showCameraEnabled(true);
  }

  #onControl(control, handler) {
    this.#controls.get(control).addEventListener('click', handler);
  }
}
