import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TEXTS } from '../../src/client/common/texts.js';
import { RoomClient, RoomResult } from '../../src/client/rooms/room-client.js';
import { ClientEvent, ServerEvent, WhisperEndReason } from '../../src/shared/events.js';
import { startTestApp } from '../support/app-harness.js';

const LISTING_ID = '11111111-2222-4333-8444-555555555555';
const ROOM = { listingId: LISTING_ID, title: 'Fútbol <b>ecuatoriano</b>', members: 3, capacity: 20 };

function flushPromises() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function welcome(visibility, extra = {}) {
  return JSON.stringify({
    type: ServerEvent.WELCOME,
    peerId: 'yo',
    peers: [{ id: 'luis', name: 'Luis', isOwner: false }],
    iceServers: [],
    inviteToken: 'AbCdEfGhIjKlMnOpQrStUv',
    isOwner: false,
    visibility,
    title: visibility === 'public' ? 'Fútbol' : null,
    ...extra,
  });
}

function sentEvents(app) {
  return app.socket.sent.map((data) => JSON.parse(data));
}

describe('RoomClient: salas publicas y pases', () => {
  it('crea, lista, entra y se muda con las rutas correctas', async () => {
    const calls = [];
    const client = new RoomClient(async (path, options = {}) => {
      calls.push({ path, method: options.method ?? 'GET', body: options.body && JSON.parse(options.body) });
      return path === '/rooms/public' ? { status: 200, json: async () => ({ rooms: [ROOM] }) } : { status: 204 };
    });

    assert.equal(await client.createPublicRoom('Fútbol'), RoomResult.GRANTED);
    assert.deepEqual(await client.listPublicRooms(), [ROOM]);
    await client.joinPublicRoom(LISTING_ID);
    await client.transfer('pase');

    assert.deepEqual(calls[0].body, { visibility: 'public', title: 'Fútbol', acceptedRules: true });
    assert.equal(calls[2].path, `/rooms/public/${LISTING_ID}/join`);
    assert.deepEqual(calls[3].body, { transferToken: 'pase', acceptedRules: true });
  });

  it('traduce los rechazos nuevos y una lista que no se pudo cargar', async () => {
    const answering = (status) => new RoomClient(async () => ({ status, json: async () => ({}) }));

    assert.equal(await answering(400).createPublicRoom('x'), RoomResult.INVALID);
    assert.equal(await answering(403).joinPublicRoom(LISTING_ID), RoomResult.BANNED);
    assert.equal(await answering(422).createPublicRoom('x'), RoomResult.BLOCKED);
    assert.equal(await answering(500).listPublicRooms(), null);
    assert.equal(await new RoomClient(async () => Promise.reject(new Error('sin red'))).listPublicRooms(), null);
  });
});

describe('salas publicas en la portada', () => {
  it('muestra la lista sin interpretar HTML y entra a la sala elegida', async () => {
    const app = await startTestApp({ sessionStatus: 401 });
    app.server.publicRooms = [ROOM, { ...ROOM, listingId: 'llena', title: 'Llena', members: 20 }];
    app.document.querySelector('#refresh-public-rooms').click();
    await flushPromises();
    const items = [...app.document.querySelectorAll('.public-room')];

    assert.equal(items[0].querySelector('.public-room-title').textContent, 'Fútbol <b>ecuatoriano</b>');
    assert.equal(items[0].querySelector('.public-room-members').textContent, '3 de 20 personas');
    assert.equal(items[1].querySelector('button').disabled, true);
    assert.equal(app.document.querySelector('#public-rooms-empty').hidden, true);
    items[0].querySelector('button').click();
    await flushPromises();
    assert.equal(app.requests.at(-1).path, `/rooms/public/${LISTING_ID}/join`);
    assert.equal(app.sockets.length, 1);
  });

  it('crea una sala publica con su titulo y avisa si el titulo no se permite', async () => {
    const app = await startTestApp({ sessionStatus: 401 });
    app.server.createStatus = 422;
    app.document.querySelector('#public-room-title').value = '  Mala palabra ';
    app.document.querySelector('#public-room-form').requestSubmit();
    await flushPromises();

    assert.deepEqual(JSON.parse(app.requests.at(-1).body), { visibility: 'public', title: 'Mala palabra', acceptedRules: true });
    assert.equal(app.document.querySelector('#home-error').textContent, TEXTS.roomTitleBlocked);
    assert.equal(app.sockets.length, 0);
  });

  it('avisa cuando la lista esta vacia o no se pudo cargar', async () => {
    const app = await startTestApp({ sessionStatus: 401 });
    const empty = app.document.querySelector('#public-rooms-empty');

    assert.equal(empty.hidden, false);
    assert.equal(empty.textContent, TEXTS.publicRoomsEmpty);
  });
});

describe('susurros en la app', () => {
  it('en una sala publica ofrece susurrar, oculta la voz y envia la preferencia', async () => {
    const app = await startTestApp({ savedName: 'Ana' });
    app.socket.simulateOpen();
    app.socket.simulateData(welcome('public'));

    assert.equal(app.document.querySelector('#chat').dataset.visibility, 'public');
    assert.equal(app.document.querySelector('#whisper-preference').hidden, false);
    assert.deepEqual(sentEvents(app).find((event) => event.type === ClientEvent.WHISPER_PREFERENCE), {
      type: ClientEvent.WHISPER_PREFERENCE,
      acceptsWhispers: true,
    });
    app.document.querySelector('.person-whisper').click();
    assert.deepEqual(sentEvents(app).at(-1), { type: ClientEvent.WHISPER_INVITE, to: 'luis' });
    assert.equal(app.errorLabel.textContent, TEXTS.whisperSent);
  });

  it('en una sala privada no hay susurros', async () => {
    const app = await startTestApp({ savedName: 'Ana' });
    app.socket.simulateOpen();
    app.socket.simulateData(welcome('private'));

    assert.equal(app.document.querySelector('.person-whisper'), null);
    assert.equal(app.document.querySelector('#whisper-preference').hidden, true);
  });

  it('recibe una invitacion, la acepta y se muda a la sala privada', async () => {
    const app = await startTestApp({ savedName: 'Ana' });
    app.socket.simulateOpen();
    app.socket.simulateData(welcome('public'));
    app.socket.simulateData(
      JSON.stringify({ type: ServerEvent.WHISPER_INCOMING, whisperId: 'w1', from: { id: 'luis', name: '<i>Luis</i>' } }),
    );
    const dialog = app.document.querySelector('#whisper-dialog');

    assert.equal(dialog.hidden, false);
    assert.match(app.document.querySelector('#whisper-from').textContent, /^<i>Luis<\/i> quiere hablar/);
    app.document.querySelector('#whisper-accept').click();
    assert.deepEqual(sentEvents(app).at(-1), { type: ClientEvent.WHISPER_ACCEPT, whisperId: 'w1' });
    app.socket.simulateData(JSON.stringify({ type: ServerEvent.WHISPER_READY, whisperId: 'w1', transferToken: 'pase' }));
    await flushPromises();

    assert.equal(dialog.hidden, true);
    assert.equal(app.requests.at(-1).path, '/rooms/transfer');
    assert.equal(app.sockets.length, 2);
  });

  it('rechazar responde al servidor y un final de invitacion se explica', async () => {
    const app = await startTestApp({ savedName: 'Ana' });
    app.socket.simulateOpen();
    app.socket.simulateData(welcome('public'));
    app.socket.simulateData(JSON.stringify({ type: ServerEvent.WHISPER_INCOMING, whisperId: 'w2', from: { id: 'luis', name: 'Luis' } }));

    app.document.querySelector('#whisper-reject').click();
    assert.deepEqual(sentEvents(app).at(-1), { type: ClientEvent.WHISPER_REJECT, whisperId: 'w2' });
    app.socket.simulateData(JSON.stringify({ type: ServerEvent.WHISPER_ENDED, whisperId: null, reason: WhisperEndReason.TIMEOUT }));
    assert.equal(app.errorLabel.textContent, TEXTS.whisperTimeout);
  });

  it('si el pase falla avisa, y la preferencia de no recibir susurros se recuerda', async () => {
    const app = await startTestApp({ savedName: 'Ana' });
    app.server.transferStatus = 404;
    app.socket.simulateOpen();
    app.socket.simulateData(welcome('public'));
    app.socket.simulateData(JSON.stringify({ type: ServerEvent.WHISPER_READY, whisperId: 'w3', transferToken: 'vencido' }));
    await flushPromises();
    assert.equal(app.errorLabel.textContent, TEXTS.whisperUnavailable);

    const preference = app.document.querySelector('#accept-whispers');
    preference.checked = false;
    preference.dispatchEvent(new app.window.Event('change'));
    assert.equal(app.saved.get('miniwasp-accepts-whispers'), 'no');
    assert.deepEqual(sentEvents(app).at(-1), { type: ClientEvent.WHISPER_PREFERENCE, acceptsWhispers: false });
  });
});
