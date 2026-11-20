import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TEXTS } from '../../src/client/common/texts.js';
import { ClientEvent, ServerEvent, SignalKind } from '../../src/shared/events.js';
import { startTestApp } from '../support/app-harness.js';
import { flushPromises } from '../support/async.js';
import { FakeStream } from '../support/fake-webrtc.js';

const OWN_PEER_ID = 'peer-propio';
const luis = { id: 'peer-luis', name: 'Luis' };
const callId = 'call-1';

function receive(socket, event) {
  socket.simulateData(JSON.stringify(event));
}

async function setup({ savedName = 'Ana' } = {}) {
  const app = await startTestApp({ savedName });
  const { document, socket } = app;

  socket.simulateOpen();
  receive(socket, {
    type: ServerEvent.WELCOME,
    peerId: OWN_PEER_ID,
    peers: [{ id: OWN_PEER_ID, name: savedName }, luis],
    iceServers: [{ urls: 'stun:stun.test' }],
    inviteToken: 'AbCdEfGhIjKlMnOpQrStUv',
    isOwner: false,
    visibility: 'private',
    title: null,
  });

  return {
    ...app,
    callPanel: document.querySelector('#call'),
    sentOfType: (type) =>
      socket.sent.map((data) => JSON.parse(data)).filter((event) => event.type === type),
    clickCall: () => document.querySelector('.person-call').click(),
    click: (selector) => document.querySelector(selector).click(),
    callStatus: () => document.querySelector('#call-status').textContent,
  };
}

describe('videollamada desde la app', () => {
  it('se anuncia con su nombre y lista solo a los demas', async () => {
    const { document, sentOfType } = await setup();

    assert.deepEqual(sentOfType(ClientEvent.PRESENCE), [
      { type: ClientEvent.PRESENCE, name: 'Ana' },
    ]);
    assert.deepEqual(
      [...document.querySelectorAll('.person-name')].map((element) => element.textContent),
      ['Luis'],
    );
  });

  it('anuncia el nombre cuando la persona lo escribe', async () => {
    const { window, nameInput, sentOfType } = await setup({ savedName: '' });
    nameInput.value = 'Rosa';

    nameInput.dispatchEvent(new window.Event('change'));

    assert.deepEqual(sentOfType(ClientEvent.PRESENCE), [
      { type: ClientEvent.PRESENCE, name: 'Rosa' },
    ]);
  });

  it('pide el nombre antes de llamar', async () => {
    const { clickCall, errorLabel, sentOfType } = await setup({ savedName: '' });

    clickCall();

    assert.equal(errorLabel.textContent, TEXTS.nameRequired);
    assert.deepEqual(sentOfType(ClientEvent.CALL_INVITE), []);
  });

  it('completa una llamada saliente con el boton', async () => {
    const { socket, connections, callPanel, document, ...app } = await setup();

    app.clickCall();
    await flushPromises();

    assert.equal(callPanel.hidden, false);
    assert.deepEqual(app.sentOfType(ClientEvent.CALL_INVITE), [
      { type: ClientEvent.CALL_INVITE, to: luis.id },
    ]);

    receive(socket, { type: ServerEvent.CALL_RINGING, callId, peer: luis });
    assert.equal(app.callStatus(), TEXTS.callCalling);
    assert.equal(document.querySelector('#call-peer').textContent, luis.name);

    receive(socket, { type: ServerEvent.CALL_ACCEPTED, callId });
    await flushPromises();

    assert.deepEqual(connections[0].configuration.iceServers, [{ urls: 'stun:stun.test' }]);
    assert.deepEqual(app.sentOfType(ClientEvent.CALL_SIGNAL), [
      {
        type: ClientEvent.CALL_SIGNAL,
        callId,
        signal: { kind: SignalKind.OFFER, sdp: 'sdp-oferta' },
      },
    ]);

    receive(socket, {
      type: ServerEvent.CALL_SIGNAL,
      callId,
      signal: { kind: SignalKind.ANSWER, sdp: 'sdp-respuesta' },
    });
    await flushPromises();
    connections[0].simulateTrack(new FakeStream());
    connections[0].simulateState('connected');

    assert.equal(app.callStatus(), TEXTS.callActive);
    assert.ok(document.querySelector('#remote-video').srcObject);

    app.click('#call-microphone');
    app.click('#call-camera');
    assert.equal(document.querySelector('#call-microphone').textContent, TEXTS.microphoneOff);
    assert.equal(document.querySelector('#call-camera').textContent, TEXTS.cameraOff);

    app.click('#call-hangup');
    assert.equal(callPanel.hidden, true);
    assert.deepEqual(app.sentOfType(ClientEvent.CALL_HANGUP), [
      { type: ClientEvent.CALL_HANGUP, callId },
    ]);
    assert.equal(connections[0].isClosed, true);
  });

  it('contesta una llamada entrante', async () => {
    const { socket, connections, callPanel, ...app } = await setup();

    receive(socket, { type: ServerEvent.CALL_INCOMING, callId, peer: luis });
    assert.equal(callPanel.hidden, false);
    assert.equal(app.callStatus(), TEXTS.callIncoming);

    app.click('#call-accept');
    await flushPromises();
    assert.deepEqual(app.sentOfType(ClientEvent.CALL_ACCEPT), [
      { type: ClientEvent.CALL_ACCEPT, callId },
    ]);

    receive(socket, {
      type: ServerEvent.CALL_SIGNAL,
      callId,
      signal: { kind: SignalKind.OFFER, sdp: 'sdp-remota' },
    });
    await flushPromises();

    assert.equal(connections[0].remoteDescription.sdp, 'sdp-remota');
    assert.equal(app.sentOfType(ClientEvent.CALL_SIGNAL)[0].signal.kind, SignalKind.ANSWER);
  });

  it('rechaza una llamada entrante', async () => {
    const { socket, callPanel, click, sentOfType } = await setup();
    receive(socket, { type: ServerEvent.CALL_INCOMING, callId, peer: luis });

    click('#call-reject');

    assert.equal(callPanel.hidden, true);
    assert.deepEqual(sentOfType(ClientEvent.CALL_REJECT), [
      { type: ClientEvent.CALL_REJECT, callId },
    ]);
  });

  it('muestra el motivo cuando la llamada termina', async () => {
    const { socket, clickCall, callPanel, errorLabel } = await setup();
    clickCall();
    await flushPromises();
    receive(socket, { type: ServerEvent.CALL_RINGING, callId, peer: luis });

    receive(socket, { type: ServerEvent.CALL_ENDED, callId, reason: 'rejected' });

    assert.equal(callPanel.hidden, true);
    assert.equal(errorLabel.textContent, TEXTS.callRejected);
  });

  it('actualiza la lista cuando cambia la presencia', async () => {
    const { socket, document } = await setup();

    receive(socket, { type: ServerEvent.PRESENCE, peers: [] });

    assert.equal(document.querySelectorAll('.person').length, 0);
    assert.equal(document.querySelector('#people-empty').hidden, false);
  });

  it('termina la llamada y vacia la lista si se pierde el servidor', async () => {
    const { socket, document, callPanel, errorLabel, localStream, clickCall } = await setup();
    clickCall();
    await flushPromises();

    socket.simulateClose();

    assert.equal(callPanel.hidden, true);
    assert.equal(errorLabel.textContent, TEXTS.callDisconnected);
    assert.equal(document.querySelectorAll('.person').length, 0);
    assert.equal(localStream.getTracks().every((track) => track.isStopped), true);
  });
});
