import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallController, RETURN_GRACE_MS } from '../../src/client/calls/call-controller.js';
import { CallPhase } from '../../src/client/calls/call-phase.js';
import { LocalMedia } from '../../src/client/calls/local-media.js';
import { CallEndReason, SignalKind } from '../../src/shared/events.js';
import { FakeStream } from '../support/fake-webrtc.js';

const peer = { id: 'peer-1', name: 'Luis' };
const callId = 'call-1';

class SpySignaling {
  sent = [];
  isOnline = true;

  #record(action, value) {
    this.sent.push([action, value]);
    return this.isOnline;
  }

  invite(peerId) {
    return this.#record('invite', peerId);
  }

  accept(id) {
    return this.#record('accept', id);
  }

  reject(id) {
    return this.#record('reject', id);
  }

  hangUp(id) {
    return this.#record('hangUp', id);
  }

  relay(id, signal) {
    return this.#record('relay', { id, signal });
  }

  resume(id) {
    return this.#record('resume', id);
  }
}

class SpyView {
  phases = [];
  localStream = null;
  remoteStream = null;
  isHidden = false;
  microphoneEnabled = true;
  cameraEnabled = true;

  showPhase(phase, peerName) {
    this.phases.push([phase, peerName]);
    this.isHidden = false;
  }

  get currentPhase() {
    return this.phases.at(-1)?.[0];
  }

  showLocalStream(stream) {
    this.localStream = stream;
  }

  showRemoteStream(stream) {
    this.remoteStream = stream;
  }

  showMicrophoneEnabled(isEnabled) {
    this.microphoneEnabled = isEnabled;
  }

  showCameraEnabled(isEnabled) {
    this.cameraEnabled = isEnabled;
  }

  showSecurityCode(code) {
    this.securityCode = code;
  }

  showReconnecting(isReconnecting) {
    this.isReconnecting = isReconnecting;
  }

  hide() {
    this.isHidden = true;
    this.isReconnecting = false;
  }
}

class SpyLink {
  offersStarted = 0;
  received = [];
  isClosed = false;

  constructor(options) {
    this.options = options;
  }

  securityCode = async () => '123 456';

  startOffer() {
    this.offersStarted += 1;
  }

  receive(signal) {
    this.received.push(signal);
  }

  close() {
    this.isClosed = true;
  }
}

function setup({ getUserMedia, createLink, iceServers = [] } = {}) {
  const signaling = new SpySignaling();
  const timers = [];
  const renewals = [];
  const view = new SpyView();
  const stream = new FakeStream();
  const links = [];
  const notices = { shown: [], cleared: 0 };

  const controller = new CallController({
    signaling,
    view,
    iceServers: {
      forCall: async () => iceServers,
      keepRenewed: (link, isCurrent) => renewals.push({ link, isCurrent }),
    },
    schedule: (callback, delayMs) => timers.push({ callback, delayMs }),
    notices: {
      show: (key) => notices.shown.push(key),
      clear: () => {
        notices.cleared += 1;
      },
    },
    createMedia: () => new LocalMedia(getUserMedia ?? (async () => stream)),
    createLink:
      createLink ??
      ((options) => {
        const link = new SpyLink(options);
        links.push(link);
        return link;
      }),
  });

  return { controller, signaling, view, stream, links, notices, timers, renewals };
}

async function startOutgoingCall(context) {
  await context.controller.start(peer);
  context.controller.handleRinging({ callId, peer });
}

async function establishOutgoingCall(context) {
  await startOutgoingCall(context);
  await context.controller.handleAccepted({ callId });
  context.links[0].options.onConnected();
}

async function acceptIncomingCall(context) {
  context.controller.handleIncoming({ callId, peer });
  await context.controller.accept();
}

describe('CallController: llamada saliente', () => {
  it('pide la camara antes de invitar y muestra la vista previa', async () => {
    const context = setup();
    const { controller, signaling, view, stream, notices } = context;

    await controller.start(peer);

    assert.deepEqual(view.phases, [[CallPhase.PREPARING, peer.name]]);
    assert.equal(view.localStream, stream);
    assert.deepEqual(signaling.sent, [['invite', peer.id]]);
    assert.equal(notices.cleared, 1);
  });

  it('no invita si se niega el permiso de la camara', async () => {
    const denied = Object.assign(new Error('denegado'), { name: 'NotAllowedError' });
    const { controller, signaling, view, notices } = setup({
      getUserMedia: async () => {
        throw denied;
      },
    });

    await controller.start(peer);

    assert.deepEqual(signaling.sent, []);
    assert.deepEqual(notices.shown, ['mediaDenied']);
    assert.equal(view.isHidden, true);
  });

  it('avisa y apaga la camara si no hay conexion para invitar', async () => {
    const { controller, signaling, view, stream, notices } = setup();
    signaling.isOnline = false;

    await controller.start(peer);

    assert.deepEqual(notices.shown, ['offline']);
    assert.equal(view.isHidden, true);
    assert.equal(stream.getTracks().every((track) => track.isStopped), true);
  });

  it('solo permite una llamada a la vez', async () => {
    const context = setup();
    await startOutgoingCall(context);

    await context.controller.start({ id: 'otra', name: 'Rosa' });

    assert.equal(context.signaling.sent.filter(([action]) => action === 'invite').length, 1);
  });

  it('muestra que esta llamando cuando el servidor confirma', async () => {
    const context = setup();

    await startOutgoingCall(context);

    assert.equal(context.view.currentPhase, CallPhase.CALLING);
  });

  it('cuelga una invitacion confirmada despues de cancelar', async () => {
    const { controller, signaling } = setup();
    await controller.start(peer);
    controller.hangUp();

    controller.handleRinging({ callId, peer });

    assert.deepEqual(signaling.sent.at(-1), ['hangUp', callId]);
  });

  it('crea la oferta solo cuando la otra persona acepta', async () => {
    const context = setup();
    await startOutgoingCall(context);
    assert.equal(context.links.length, 0);

    await context.controller.handleAccepted({ callId });

    assert.equal(context.view.currentPhase, CallPhase.CONNECTING);
    assert.equal(context.links[0].offersStarted, 1);
    assert.equal(context.links[0].options.stream, context.stream);
  });

  it('usa los servidores ICE pedidos para esta llamada', async () => {
    const iceServers = [{ urls: 'turn:turn.test', username: 'u', credential: 'c' }];
    const context = setup({ iceServers });
    await startOutgoingCall(context);

    await context.controller.handleAccepted({ callId });

    assert.equal(context.links[0].options.iceServers, iceServers);
  });

  it('muestra el error si WebRTC no esta disponible', async () => {
    const context = setup({
      createLink() {
        throw new ReferenceError('RTCPeerConnection is not defined');
      },
    });
    await startOutgoingCall(context);

    await context.controller.handleAccepted({ callId });

    assert.deepEqual(context.notices.shown, ['callFailed']);
    assert.deepEqual(context.signaling.sent.at(-1), ['hangUp', callId]);
  });

  it('ignora una aceptacion de otra llamada', async () => {
    const context = setup();
    await startOutgoingCall(context);

    await context.controller.handleAccepted({ callId: 'otra' });

    assert.equal(context.links.length, 0);
  });
});

describe('CallController: llamada entrante', () => {
  it('no enciende la camara hasta que se acepta', () => {
    let cameraRequests = 0;
    const { controller, view } = setup({
      getUserMedia: async () => {
        cameraRequests += 1;
        return new FakeStream();
      },
    });

    controller.handleIncoming({ callId, peer });

    assert.deepEqual(view.phases, [[CallPhase.INCOMING, peer.name]]);
    assert.equal(cameraRequests, 0);
  });

  it('al aceptar prepara la conexion antes de avisar al servidor', async () => {
    const context = setup();

    await acceptIncomingCall(context);

    assert.equal(context.view.currentPhase, CallPhase.CONNECTING);
    assert.equal(context.links.length, 1);
    assert.equal(context.links[0].offersStarted, 0);
    assert.deepEqual(context.signaling.sent, [['accept', callId]]);
  });

  it('ignora aceptar si no hay una llamada entrante', async () => {
    const { controller, signaling } = setup();

    await controller.accept();

    assert.deepEqual(signaling.sent, []);
  });

  it('cuelga si no puede usar la camara al aceptar', async () => {
    const { controller, signaling, notices } = setup({
      getUserMedia: async () => {
        throw Object.assign(new Error('ocupada'), { name: 'NotReadableError' });
      },
    });
    controller.handleIncoming({ callId, peer });

    await controller.accept();

    assert.deepEqual(signaling.sent, [['hangUp', callId]]);
    assert.deepEqual(notices.shown, ['mediaInUse']);
  });

  it('no acepta si la llamada termino mientras se pedia el permiso', async () => {
    let grantPermission;
    const { controller, signaling, links } = setup({
      getUserMedia: () =>
        new Promise((resolve) => {
          grantPermission = resolve;
        }),
    });
    controller.handleIncoming({ callId, peer });
    const acceptance = controller.accept();

    controller.handleEnded({ callId, reason: CallEndReason.HANGUP });
    grantPermission(new FakeStream());
    await acceptance;

    assert.deepEqual(signaling.sent, []);
    assert.equal(links.length, 0);
  });

  it('no muestra error si la llamada termino antes de que fallara el permiso', async () => {
    let denyPermission;
    const { controller, notices } = setup({
      getUserMedia: () =>
        new Promise((_resolve, reject) => {
          denyPermission = reject;
        }),
    });
    controller.handleIncoming({ callId, peer });
    const acceptance = controller.accept();

    controller.handleEnded({ callId, reason: CallEndReason.HANGUP });
    denyPermission(Object.assign(new Error('denegado'), { name: 'NotAllowedError' }));
    await acceptance;

    assert.deepEqual(notices.shown, ['callEnded']);
  });

  it('rechaza sin tocar la camara', () => {
    const { controller, signaling, view } = setup();
    controller.handleIncoming({ callId, peer });

    controller.reject();

    assert.deepEqual(signaling.sent, [['reject', callId]]);
    assert.equal(view.isHidden, true);
  });

  it('ignora rechazar si no hay una llamada entrante', () => {
    const { controller, signaling } = setup();

    controller.reject();

    assert.deepEqual(signaling.sent, []);
  });

  it('rechaza una segunda llamada mientras esta ocupado', async () => {
    const context = setup();
    await establishOutgoingCall(context);

    context.controller.handleIncoming({ callId: 'otra', peer: { id: 'b', name: 'Rosa' } });

    assert.deepEqual(context.signaling.sent.at(-1), ['reject', 'otra']);
    assert.equal(context.view.currentPhase, CallPhase.ACTIVE);
  });
});

describe('CallController: durante la llamada', () => {
  it('pasa a activa cuando la conexion se establece', async () => {
    const context = setup();

    await establishOutgoingCall(context);

    assert.equal(context.view.currentPhase, CallPhase.ACTIVE);
  });

  it('muestra el video remoto y reenvia las senales locales', async () => {
    const context = setup();
    const remoteStream = new FakeStream();
    const signal = { kind: SignalKind.OFFER, sdp: 'v=0' };
    await establishOutgoingCall(context);
    const { options } = context.links[0];

    options.onRemoteStream(remoteStream);
    options.onSignal(signal);

    assert.equal(context.view.remoteStream, remoteStream);
    assert.deepEqual(context.signaling.sent.at(-1), ['relay', { id: callId, signal }]);
  });

  it('entrega a la conexion las senales de su llamada', async () => {
    const context = setup();
    const signal = { kind: SignalKind.ANSWER, sdp: 'v=0' };
    await establishOutgoingCall(context);

    context.controller.handleSignal({ callId, signal });
    context.controller.handleSignal({ callId: 'otra', signal });

    assert.deepEqual(context.links[0].received, [signal]);
  });

  it('ignora senales que llegan antes de tener conexion', async () => {
    const context = setup();
    await startOutgoingCall(context);

    assert.doesNotThrow(() => {
      context.controller.handleSignal({ callId, signal: { kind: SignalKind.ANSWER, sdp: 'v=0' } });
    });
  });

  it('alterna microfono y camara durante la llamada', async () => {
    const context = setup();
    await establishOutgoingCall(context);

    context.controller.toggleMicrophone();
    context.controller.toggleCamera();

    assert.equal(context.view.microphoneEnabled, false);
    assert.equal(context.view.cameraEnabled, false);
    assert.equal(context.stream.getAudioTracks()[0].enabled, false);
    assert.equal(context.stream.getVideoTracks()[0].enabled, false);
  });

  it('ignora los botones de medios si la llamada no esta activa', async () => {
    const context = setup();
    await startOutgoingCall(context);

    context.controller.toggleMicrophone();
    context.controller.toggleCamera();

    assert.equal(context.view.microphoneEnabled, true);
    assert.equal(context.view.cameraEnabled, true);
  });

  it('cuelga si la conexion falla', async () => {
    const context = setup();
    await establishOutgoingCall(context);

    context.links[0].options.onFailed();

    assert.deepEqual(context.signaling.sent.at(-1), ['hangUp', callId]);
    assert.deepEqual(context.notices.shown, ['callFailed']);
  });
});

describe('CallController: fin de la llamada', () => {
  it('colgar avisa al servidor y libera todo', async () => {
    const context = setup();
    await establishOutgoingCall(context);

    context.controller.hangUp();

    assert.deepEqual(context.signaling.sent.at(-1), ['hangUp', callId]);
    assert.equal(context.links[0].isClosed, true);
    assert.equal(context.view.isHidden, true);
    assert.equal(context.stream.getTracks().every((track) => track.isStopped), true);
    assert.deepEqual(context.notices.shown, []);
  });

  it('colgar sin llamada no hace nada', () => {
    const { controller, signaling } = setup();

    controller.hangUp();

    assert.deepEqual(signaling.sent, []);
  });

  it('permite otra llamada despues de terminar', async () => {
    const context = setup();
    await establishOutgoingCall(context);
    context.controller.hangUp();

    await context.controller.start(peer);

    assert.equal(context.signaling.sent.filter(([action]) => action === 'invite').length, 2);
  });

  it('explica cada motivo de finalizacion', async () => {
    const expectedNotices = new Map([
      [CallEndReason.REJECTED, 'callRejected'],
      [CallEndReason.HANGUP, 'callEnded'],
      [CallEndReason.DISCONNECTED, 'callDisconnected'],
      [CallEndReason.TIMEOUT, 'callTimedOut'],
    ]);

    for (const [reason, noticeKey] of expectedNotices) {
      const context = setup();
      await startOutgoingCall(context);

      context.controller.handleEnded({ callId, reason });

      assert.deepEqual(context.notices.shown, [noticeKey]);
    }
  });

  it('explica por que el servidor rechazo la invitacion', async () => {
    for (const [reason, noticeKey] of [
      [CallEndReason.BUSY, 'callBusy'],
      [CallEndReason.UNAVAILABLE, 'callUnavailable'],
    ]) {
      const { controller, notices, view } = setup();
      await controller.start(peer);

      controller.handleEnded({ callId: null, reason });

      assert.deepEqual(notices.shown, [noticeKey]);
      assert.equal(view.isHidden, true);
    }
  });

  it('ignora el fin de otra llamada', async () => {
    const context = setup();
    await establishOutgoingCall(context);

    context.controller.handleEnded({ callId: 'otra', reason: CallEndReason.HANGUP });

    assert.equal(context.view.isHidden, false);
  });

  it('ignora un fin de llamada cuando no hay ninguna', () => {
    const { controller, notices } = setup();

    controller.handleEnded({ callId: null, reason: CallEndReason.BUSY });

    assert.deepEqual(notices.shown, []);
  });

  it('si se pierde el servidor mientras suena, la llamada termina', async () => {
    const context = setup();
    await startOutgoingCall(context);

    context.controller.handleConnectionLost();

    assert.deepEqual(context.notices.shown, ['callDisconnected']);
    assert.equal(context.signaling.sent.some(([action]) => action === 'hangUp'), false);
  });

  it('una llamada en curso sigue mientras reconecta y al volver pide retomarla', async () => {
    const context = setup();
    await establishOutgoingCall(context);

    context.controller.handleConnectionLost();
    assert.equal(context.view.isReconnecting, true);
    assert.equal(context.view.isHidden, false);
    assert.equal(context.timers[0].delayMs, RETURN_GRACE_MS);

    context.controller.handleConnectionRestored();
    context.timers[0].callback();

    assert.equal(context.view.isReconnecting, false);
    assert.deepEqual(context.signaling.sent.at(-1), ['resume', callId]);
    assert.equal(context.view.isHidden, false);
    assert.deepEqual(context.notices.shown, []);
  });

  it('si no reconecta a tiempo, la llamada termina; un corte viejo no cierra uno nuevo', async () => {
    const context = setup();
    await establishOutgoingCall(context);
    context.controller.handleConnectionLost();
    context.controller.handleConnectionRestored();
    context.controller.handleConnectionLost();

    context.timers[0].callback();
    assert.equal(context.view.isHidden, false);
    context.timers[1].callback();

    assert.equal(context.view.isHidden, true);
    assert.deepEqual(context.notices.shown, ['callDisconnected']);
  });

  it('salir de la sala cierra la llamada aunque estuviera esperando reconectar', async () => {
    const context = setup();
    await establishOutgoingCall(context);
    context.controller.handleConnectionLost();

    context.controller.handleRoomLeft();
    context.controller.handleRoomLeft();

    assert.equal(context.view.isHidden, true);
    assert.equal(context.links[0].isClosed, true);
    assert.deepEqual(context.notices.shown, []);
  });

  it('las credenciales se renuevan desde que la llamada se establece, una sola vez y solo mientras siga', async () => {
    const context = setup();
    await establishOutgoingCall(context);
    context.links[0].options.onConnected();

    assert.equal(context.renewals.length, 1);
    assert.equal(context.renewals[0].link, context.links[0]);
    assert.equal(context.renewals[0].isCurrent(), true);
    context.controller.hangUp();
    assert.equal(context.renewals[0].isCurrent(), false);
  });

  it('quien llama pide los servidores ICE recien cuando aceptan, y no abre nada si colgo mientras', async () => {
    const context = setup();
    let requests = 0;
    let finishRequest;
    context.controller = new CallController({
      signaling: context.signaling,
      view: context.view,
      notices: { show() {}, clear() {} },
      createMedia: () => new LocalMedia(async () => context.stream),
      createLink: (options) => {
        context.links.push(new SpyLink(options));
        return context.links.at(-1);
      },
      schedule() {},
      iceServers: {
        forCall: () => {
          requests += 1;
          return new Promise((resolve) => {
            finishRequest = resolve;
          });
        },
        keepRenewed() {},
      },
    });
    await startOutgoingCall(context);
    assert.equal(requests, 0);

    const accepting = context.controller.handleAccepted({ callId });
    context.controller.hangUp();
    finishRequest([]);
    await accepting;

    assert.equal(requests, 1);
    assert.equal(context.links.length, 0);
  });

  it('volver en linea sin un corte pendiente no envia nada', async () => {
    const context = setup();
    await establishOutgoingCall(context);
    const sentBefore = context.signaling.sent.length;

    context.controller.handleConnectionRestored();

    assert.equal(context.signaling.sent.length, sentBefore);
  });

  it('perder el servidor sin llamada no hace nada', () => {
    const { controller, notices } = setup();

    controller.handleConnectionLost();

    assert.deepEqual(notices.shown, []);
  });
});

describe('CallController: codigo de seguridad', () => {
  async function connectWithCode(context, securityCode) {
    await startOutgoingCall(context);
    await context.controller.handleAccepted({ callId });
    context.links[0].securityCode = securityCode;
    context.links[0].options.onConnected();
  }

  it('muestra el codigo cuando la llamada se establece', async () => {
    const context = setup();

    await establishOutgoingCall(context);
    await Promise.resolve();

    assert.equal(context.view.securityCode, '123 456');
  });

  it('no muestra el codigo de una llamada que ya termino', async () => {
    const context = setup();
    let releaseCode;
    await connectWithCode(
      context,
      () =>
        new Promise((resolve) => {
          releaseCode = resolve;
        }),
    );

    context.controller.hangUp();
    releaseCode('999 999');
    await Promise.resolve();

    assert.equal(context.view.securityCode, undefined);
  });

  it('no muestra nada si no hay codigo disponible', async () => {
    const context = setup();

    await connectWithCode(context, async () => null);
    await Promise.resolve();

    assert.equal(context.view.securityCode, undefined);
  });
});
