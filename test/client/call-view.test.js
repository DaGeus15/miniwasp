import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallPhase } from '../../src/client/calls/call-phase.js';
import { CallView } from '../../src/client/calls/call-view.js';
import { TEXTS } from '../../src/client/common/texts.js';
import { createPage } from '../support/page.js';

const CONTROL_IDS = ['call-accept', 'call-reject', 'call-microphone', 'call-camera', 'call-hangup'];

function setup() {
  const { document } = createPage();
  const element = (selector) => document.querySelector(selector);

  return {
    document,
    element,
    view: new CallView(document),
    visibleControls: () => CONTROL_IDS.filter((id) => !document.getElementById(id).hidden),
  };
}

describe('CallView', () => {
  it('empieza oculta', () => {
    assert.equal(setup().element('#call').hidden, true);
  });

  it('muestra los controles de cada fase', () => {
    const expectedControls = new Map([
      [CallPhase.PREPARING, ['call-hangup']],
      [CallPhase.CALLING, ['call-hangup']],
      [CallPhase.INCOMING, ['call-accept', 'call-reject']],
      [CallPhase.CONNECTING, ['call-hangup']],
      [CallPhase.ACTIVE, ['call-microphone', 'call-camera', 'call-hangup']],
    ]);

    for (const [phase, controls] of expectedControls) {
      const { view, element, visibleControls } = setup();

      view.showPhase(phase, 'Luis');

      assert.equal(element('#call').hidden, false);
      assert.deepEqual(visibleControls(), controls);
    }
  });

  it('muestra el nombre y el estado de la llamada', () => {
    const { view, element } = setup();

    view.showPhase(CallPhase.INCOMING, 'Luis');

    assert.equal(element('#call-peer').textContent, 'Luis');
    assert.equal(element('#call-status').textContent, TEXTS.callIncoming);
  });

  it('muestra como texto un nombre con HTML', () => {
    const { view, element } = setup();
    const name = '<img src=x onerror=alert(1)>';

    view.showPhase(CallPhase.INCOMING, name);

    assert.equal(element('#call-peer').textContent, name);
    assert.equal(element('#call-peer img'), null);
  });

  it('pone el foco en la accion principal', () => {
    const { view, element, document } = setup();

    view.showPhase(CallPhase.INCOMING, 'Luis');

    assert.equal(document.activeElement, element('#call-accept'));
  });

  it('asigna el video local y remoto', () => {
    const { view, element } = setup();
    const localStream = { id: 'local' };
    const remoteStream = { id: 'remota' };

    view.showLocalStream(localStream);
    view.showRemoteStream(remoteStream);

    assert.equal(element('#local-video').srcObject, localStream);
    assert.equal(element('#remote-video').srcObject, remoteStream);
  });

  it('oculta el video local mientras no haya camara', () => {
    const { view, element } = setup();
    assert.equal(element('#local-video').hidden, true);

    view.showLocalStream({});
    assert.equal(element('#local-video').hidden, false);

    view.hide();
    assert.equal(element('#local-video').hidden, true);
  });

  it('el video local no reproduce el propio microfono', () => {
    assert.equal(setup().element('#local-video').hasAttribute('muted'), true);
  });

  it('refleja el estado del microfono y la camara', () => {
    const { view, element } = setup();
    const microphone = element('#call-microphone');
    const camera = element('#call-camera');

    view.showMicrophoneEnabled(false);
    view.showCameraEnabled(false);

    assert.equal(microphone.textContent, TEXTS.microphoneOff);
    assert.equal(microphone.getAttribute('aria-pressed'), 'true');
    assert.equal(camera.textContent, TEXTS.cameraOff);
    assert.equal(camera.getAttribute('aria-pressed'), 'true');
  });

  it('al ocultarse limpia los videos y restablece los botones', () => {
    const { view, element } = setup();
    view.showPhase(CallPhase.ACTIVE, 'Luis');
    view.showLocalStream({});
    view.showRemoteStream({});
    view.showMicrophoneEnabled(false);
    view.showCameraEnabled(false);

    view.hide();

    assert.equal(element('#call').hidden, true);
    assert.equal(element('#local-video').srcObject, null);
    assert.equal(element('#remote-video').srcObject, null);
    assert.equal(element('#call-microphone').textContent, TEXTS.microphoneOn);
    assert.equal(element('#call-camera').getAttribute('aria-pressed'), 'false');
  });

  it('avisa los clics de cada control', () => {
    const { view, element } = setup();
    const clicks = [];

    view.onAccept(() => clicks.push('accept'));
    view.onReject(() => clicks.push('reject'));
    view.onToggleMicrophone(() => clicks.push('microphone'));
    view.onToggleCamera(() => clicks.push('camera'));
    view.onHangUp(() => clicks.push('hangUp'));

    for (const id of CONTROL_IDS) {
      element(`#${id}`).click();
    }

    assert.deepEqual(clicks, ['accept', 'reject', 'microphone', 'camera', 'hangUp']);
  });
});

describe('CallView: codigo de seguridad', () => {
  it('muestra el codigo y lo borra al ocultarse', () => {
    const { view, element } = setup();
    view.showPhase(CallPhase.ACTIVE, 'Luis');

    view.showSecurityCode('123 456');
    assert.equal(element('#call-security-code').hidden, false);
    assert.equal(element('#call-security-code').textContent, TEXTS.securityCode('123 456'));

    view.hide();
    assert.equal(element('#call-security-code').hidden, true);
    assert.equal(element('#call-security-code').textContent, '');
  });
});

describe('CallView: reconexion', () => {
  it('muestra el aviso con indicador de carga mientras reconecta y lo quita al ocultarse', () => {
    const { view, element } = setup();
    view.showPhase(CallPhase.ACTIVE, 'Luis');
    assert.equal(element('#call-reconnecting').hidden, true);

    view.showReconnecting(true);
    assert.equal(element('#call-reconnecting').hidden, false);
    assert.equal(element('#call-reconnecting').getAttribute('role'), 'status');
    assert.ok(element('#call-reconnecting .call-spinner'));
    assert.match(element('#call-reconnecting').textContent, /Reconectando/);

    view.hide();
    assert.equal(element('#call-reconnecting').hidden, true);
  });
});
