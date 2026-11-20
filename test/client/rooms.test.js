import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TEXTS, textFor } from '../../src/client/common/texts.js';
import { HomeView } from '../../src/client/rooms/home-view.js';
import { buildInviteLink, parseInviteInput, readInviteFromHash } from '../../src/client/rooms/invite-link.js';
import { RoomAccess } from '../../src/client/rooms/room-access.js';
import { RoomBarView } from '../../src/client/rooms/room-bar-view.js';
import { RoomClient, RoomResult } from '../../src/client/rooms/room-client.js';
import { RoomController } from '../../src/client/rooms/room-controller.js';
import { RoomSignaling } from '../../src/client/rooms/room-signaling.js';
import { ClientEvent, ServerEvent } from '../../src/shared/events.js';
import { startTestApp } from '../support/app-harness.js';
import { flushPromises } from '../support/async.js';
import { createPage } from '../support/page.js';

const INVITE = 'AbCdEfGhIjKlMnOpQrStUv';

function respondingWith(status) {
  const requests = [];
  const request = async (path, options) => {
    requests.push({ path, options });
    return { status };
  };
  return { request, requests };
}

async function failingRequest() {
  throw new TypeError('Failed to fetch');
}

describe('enlace de invitacion', () => {
  it('lleva la invitacion en el fragmento, que el navegador no envia al servidor', () => {
    assert.equal(buildInviteLink('https://chat.test', INVITE), `https://chat.test/#join=${INVITE}`);
  });

  it('lee la invitacion del fragmento solo si tiene el formato esperado', () => {
    assert.equal(readInviteFromHash(`#join=${INVITE}`), INVITE);
    for (const hash of ['', '#otro', '#join=', '#join=<script>', '#join=corto', undefined]) {
      assert.equal(readInviteFromHash(hash), null);
    }
  });

  it('acepta el ID solo o el enlace completo pegado', () => {
    assert.equal(parseInviteInput(`  ${INVITE} `), INVITE);
    assert.equal(parseInviteInput(`https://chat.test/#join=${INVITE}`), INVITE);
    for (const input of ['', 'hola mundo', 'https://chat.test/', 'https://chat.test/#join=<x>']) {
      assert.equal(parseInviteInput(input), null);
    }
  });
});

describe('RoomClient', () => {
  it('distingue una sala activa, terminada o sin servidor', async () => {
    assert.equal(await new RoomClient(respondingWith(200).request).status(), RoomResult.ACTIVE);
    assert.equal(await new RoomClient(respondingWith(401).request).status(), RoomResult.EXPIRED);
    assert.equal(await new RoomClient(failingRequest).status(), RoomResult.UNREACHABLE);
  });

  it('crea y se une con POST y JSON, nunca con datos en la URL', async () => {
    const { request, requests } = respondingWith(204);
    const client = new RoomClient(request);

    await client.createRoom();
    await client.joinRoom(INVITE);

    assert.deepEqual(requests.map(({ path, options }) => [path, options.method]), [
      ['/rooms', 'POST'],
      ['/rooms/join', 'POST'],
    ]);
    assert.deepEqual(JSON.parse(requests[0].options.body), { acceptedRules: true });
    assert.deepEqual(JSON.parse(requests[1].options.body), { inviteToken: INVITE, acceptedRules: true });
    assert.equal(requests[1].options.headers['Content-Type'], 'application/json');
  });

  it('traduce cada respuesta del servidor', async () => {
    const expected = new Map([
      [204, RoomResult.GRANTED],
      [404, RoomResult.NOT_FOUND],
      [429, RoomResult.THROTTLED],
      [503, RoomResult.FULL],
      [500, RoomResult.UNREACHABLE],
    ]);
    for (const [status, result] of expected) {
      assert.equal(await new RoomClient(respondingWith(status).request).joinRoom(INVITE), result);
    }
    assert.equal(await new RoomClient(failingRequest).createRoom(), RoomResult.UNREACHABLE);
  });

  it('pide salir y tolera la falta de red', async () => {
    const { request, requests } = respondingWith(204);

    await new RoomClient(request).leave();

    assert.equal(requests[0].options.method, 'DELETE');
    await assert.doesNotReject(new RoomClient(failingRequest).leave());
  });
});

describe('HomeView', () => {
  function setup() {
    const { document, Event } = createPage();
    return {
      document,
      view: new HomeView(document),
      home: document.querySelector('#home'),
      chat: document.querySelector('#chat'),
      inviteInput: document.querySelector('#invite-token'),
      errorLabel: document.querySelector('#home-error'),
      submitJoin() {
        const event = new Event('submit', { cancelable: true });
        document.querySelector('#join-form').dispatchEvent(event);
        return event;
      },
    };
  }

  it('alterna entre el inicio y la sala', () => {
    const { view, home, chat, inviteInput } = setup();

    view.showHome();
    assert.equal(home.hidden, false);
    assert.equal(chat.hidden, true);

    inviteInput.value = INVITE;
    view.showChat();
    assert.equal(home.hidden, true);
    assert.equal(chat.hidden, false);
    assert.equal(inviteInput.value, '');
  });

  it('avisa la creacion y la union sin recargar la pagina', () => {
    const { document, view, inviteInput, errorLabel, submitJoin } = setup();
    const actions = [];
    view.onCreate(() => actions.push('crear'));
    view.onJoin((value) => actions.push(`unirse:${value}`));
    view.showError('error anterior');

    document.querySelector('#create-room').click();
    inviteInput.value = INVITE;
    const event = submitJoin();

    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(actions, ['crear', `unirse:${INVITE}`]);
    assert.equal(errorLabel.hidden, true);
  });

  it('muestra los errores como texto', () => {
    const { view, errorLabel } = setup();

    view.showError('<b>error</b>');

    assert.equal(errorLabel.textContent, '<b>error</b>');
    assert.equal(errorLabel.hidden, false);
  });
});

describe('RoomAccess', () => {
  function setup({ status = RoomResult.ACTIVE, result = RoomResult.GRANTED, invite = null, rulesAccepted = true } = {}) {
    const events = [];
    const client = {
      status: async () => status,
      createRoom: async () => {
        events.push('crear');
        return result;
      },
      joinRoom: async (token) => {
        events.push(`unirse:${token}`);
        return result;
      },
      leave: async () => events.push('salir'),
    };
    const view = {
      showHome: () => events.push('inicio'),
      showChat: () => events.push('sala'),
      showError: (text) => events.push(`error:${text}`),
      hasAcceptedRules: () => rulesAccepted,
      prefillInvite: (token) => events.push(`invitacion:${token}`),
    };
    const access = new RoomAccess({
      client,
      view,
      textFor,
      onEnter: () => events.push('conectar'),
      onExit: () => events.push('desconectar'),
      takeInviteFromLink: () => invite,
    });
    return { access, events };
  }

  it('entra directo si ya hay una sala activa', async () => {
    const { access, events } = setup();

    await access.start();

    assert.deepEqual(events, ['sala', 'conectar']);
  });

  it('un enlace de invitacion tiene prioridad sobre la sala anterior', async () => {
    const { access, events } = setup({ invite: INVITE });

    await access.start();

    assert.deepEqual(events, [`unirse:${INVITE}`, 'sala', 'conectar']);
  });

  it('muestra el inicio si no hay sala, y avisa si no hay servidor', async () => {
    const expired = setup({ status: RoomResult.EXPIRED });
    await expired.access.start();
    assert.deepEqual(expired.events, ['inicio']);

    const unreachable = setup({ status: RoomResult.UNREACHABLE });
    await unreachable.access.start();
    assert.deepEqual(unreachable.events, ['inicio', `error:${TEXTS.serverUnreachable}`]);
  });

  it('crea una sala y entra', async () => {
    const { access, events } = setup();

    await access.create();

    assert.deepEqual(events, ['crear', 'sala', 'conectar']);
  });

  it('explica por que no pudo entrar', async () => {
    const expected = new Map([
      [RoomResult.NOT_FOUND, TEXTS.roomNotFound],
      [RoomResult.THROTTLED, TEXTS.tooManyAttempts],
      [RoomResult.FULL, TEXTS.roomsFull],
      [RoomResult.UNREACHABLE, TEXTS.serverUnreachable],
    ]);
    for (const [result, text] of expected) {
      const { access, events } = setup({ result });

      await access.join(INVITE);

      assert.deepEqual(events, [`unirse:${INVITE}`, 'inicio', `error:${text}`]);
    }
  });

  it('sin aceptar las normas no crea ni une, y deja lista la invitacion del enlace', async () => {
    const blocked = setup({ rulesAccepted: false });
    await blocked.access.create();
    await blocked.access.join(INVITE);
    assert.deepEqual(blocked.events, [`error:${TEXTS.rulesRequired}`, `error:${TEXTS.rulesRequired}`]);

    const fromLink = setup({ rulesAccepted: false, invite: INVITE });
    await fromLink.access.start();
    assert.deepEqual(fromLink.events, ['inicio', `invitacion:${INVITE}`, `error:${TEXTS.rulesRequired}`]);
  });

  it('rechaza una invitacion mal escrita sin preguntar al servidor', async () => {
    const { access, events } = setup();

    await access.join('esto no es una invitacion');

    assert.deepEqual(events, [`error:${TEXTS.invalidInvite}`]);
  });

  it('solo saca a la persona si su sala realmente termino', async () => {
    const expired = setup({ status: RoomResult.EXPIRED });
    await expired.access.verifySession();
    assert.deepEqual(expired.events, ['desconectar', 'inicio', `error:${TEXTS.sessionExpired}`]);

    for (const status of [RoomResult.ACTIVE, RoomResult.UNREACHABLE]) {
      const { access, events } = setup({ status });
      await access.verifySession();
      assert.deepEqual(events, []);
    }
  });

  it('salir avisa al servidor y vuelve al inicio', async () => {
    const { access, events } = setup();

    await access.leave();

    assert.deepEqual(events, ['salir', 'desconectar', 'inicio']);
  });
});

describe('RoomSignaling', () => {
  it('traduce cada accion de sala a su evento', () => {
    const sent = [];
    const signaling = new RoomSignaling((payload) => sent.push(payload) > 0);

    signaling.announce('Ana');
    signaling.expel('peer-1');
    signaling.rotateInvite();

    assert.deepEqual(sent, [
      { type: ClientEvent.PRESENCE, name: 'Ana' },
      { type: ClientEvent.ROOM_EXPEL, peerId: 'peer-1' },
      { type: ClientEvent.ROOM_ROTATE_INVITE },
    ]);
  });
});

describe('RoomBarView y RoomController', () => {
  function setup({ copyText = async () => {} } = {}) {
    const { document } = createPage();
    const view = new RoomBarView(document, { roomKind: TEXTS.roomKind });
    const rotations = [];
    const controller = new RoomController({
      view,
      signaling: { rotateInvite: () => rotations.push('renovar') },
      copyText,
      origin: 'https://chat.test',
      textFor,
    });
    view.onCopy(() => controller.copyInvite());
    view.onRotate(() => controller.rotateInvite());
    return { document, controller, rotations, element: (selector) => document.querySelector(selector) };
  }

  it('muestra el tipo de sala y oculta la invitacion de un susurro', () => {
    const { controller, element } = setup();

    controller.handleWelcome({ inviteToken: INVITE, isOwner: false, visibility: 'public', title: 'Fútbol' });
    assert.equal(element('#room-kind').textContent, 'Sala pública · Fútbol');
    controller.handleWelcome({ inviteToken: INVITE, isOwner: false, visibility: 'whisper', title: null });
    assert.equal(element('#room-kind').textContent, 'Conversación privada entre dos');
    assert.equal(element('.room-bar').dataset.visibility, 'whisper');
  });

  it('muestra la invitacion y los controles segun el rol', () => {
    const { controller, element } = setup();

    controller.handleWelcome({ inviteToken: INVITE, isOwner: false });
    assert.equal(element('#invite-code').textContent, INVITE);
    assert.equal(element('#rotate-invite').hidden, true);

    controller.handleWelcome({ inviteToken: INVITE, isOwner: true });
    assert.equal(element('#rotate-invite').hidden, false);
  });

  it('copia el enlace completo y confirma', async () => {
    const copied = [];
    const { controller, element } = setup({ copyText: async (text) => copied.push(text) });
    controller.handleWelcome({ inviteToken: INVITE, isOwner: true });

    element('#copy-invite').click();
    await flushPromises();

    assert.deepEqual(copied, [`https://chat.test/#join=${INVITE}`]);
    assert.equal(element('#copy-status').textContent, TEXTS.inviteCopied);
  });

  it('avisa si el navegador no permite copiar', async () => {
    const { controller, element } = setup({
      copyText: async () => {
        throw new Error('sin permiso');
      },
    });
    controller.handleWelcome({ inviteToken: INVITE, isOwner: false });

    await controller.copyInvite();

    assert.equal(element('#copy-status').textContent, TEXTS.inviteCopyFailed);
  });

  it('no copia nada antes de conocer la invitacion', async () => {
    const copied = [];
    const { controller } = setup({ copyText: async (text) => copied.push(text) });

    await controller.copyInvite();

    assert.deepEqual(copied, []);
  });

  it('una invitacion renovada reemplaza la anterior y borra el aviso', async () => {
    const { controller, element } = setup();
    controller.handleWelcome({ inviteToken: INVITE, isOwner: true });
    await controller.copyInvite();

    controller.handleInvite({ inviteToken: 'NuevaInvitacion1234567' });

    assert.equal(element('#invite-code').textContent, 'NuevaInvitacion1234567');
    assert.equal(element('#copy-status').textContent, '');
  });

  it('el boton de renovar pide una invitacion nueva', () => {
    const { controller, element, rotations } = setup();
    controller.handleWelcome({ inviteToken: INVITE, isOwner: true });

    element('#rotate-invite').click();

    assert.deepEqual(rotations, ['renovar']);
  });
});

describe('salas desde la app', () => {
  it('no abre el WebSocket hasta entrar a una sala', async () => {
    const app = await startTestApp({ sessionStatus: 401 });
    const { document, sockets } = app;
    assert.equal(sockets.length, 0);
    assert.equal(document.querySelector('#home').hidden, false);

    document.querySelector('#create-room').click();
    await flushPromises();

    assert.equal(sockets.length, 1);
    assert.equal(document.querySelector('#chat').hidden, false);
    const { path, method, body } = app.requests.at(-1);
    assert.deepEqual({ path, method, body }, { path: '/rooms', method: 'POST', body: '{"acceptedRules":true}' });
  });

  it('la casilla de normas se recuerda en el navegador', async () => {
    const app = await startTestApp({ sessionStatus: 401, rulesAccepted: false });
    const checkbox = app.document.querySelector('#accept-rules');

    assert.equal(checkbox.checked, false);
    app.document.querySelector('#create-room').click();
    await flushPromises();
    assert.equal(app.sockets.length, 0);
    assert.equal(app.document.querySelector('#home-error').textContent, TEXTS.rulesRequired);

    checkbox.checked = true;
    checkbox.dispatchEvent(new app.window.Event('change'));
    assert.equal(app.saved.get('miniwasp-rules-accepted'), 'si');
  });

  it('se une automaticamente al abrir un enlace de invitacion y lo borra de la barra', async () => {
    const app = await startTestApp({ sessionStatus: 401, hash: `#join=${INVITE}` });

    assert.equal(app.address.clearedHash, true);
    assert.deepEqual(JSON.parse(app.requests[0].body), { inviteToken: INVITE, acceptedRules: true });
    assert.equal(app.sockets.length, 1);
  });

  it('muestra la invitacion de la sala y la copia como enlace', async () => {
    const app = await startTestApp();
    app.socket.simulateOpen();
    app.socket.simulateData(
      JSON.stringify({ type: ServerEvent.WELCOME, peerId: 'yo', peers: [], iceServers: [], inviteToken: INVITE, isOwner: true, visibility: 'private', title: null }),
    );

    app.document.querySelector('#copy-invite').click();
    await flushPromises();

    assert.equal(app.document.querySelector('#invite-code').textContent, INVITE);
    assert.deepEqual(app.copied, [`http://chat.test/#join=${INVITE}`]);
  });

  it('quien creo la sala puede sacar a alguien desde la lista', async () => {
    const app = await startTestApp({ savedName: 'Ana' });
    app.socket.simulateOpen();
    app.socket.simulateData(
      JSON.stringify({
        type: ServerEvent.WELCOME,
        peerId: 'yo',
        peers: [{ id: 'luis', name: 'Luis', isOwner: false }],
        iceServers: [],
        inviteToken: INVITE,
        isOwner: true,
        visibility: 'private',
        title: null,
      }),
    );

    app.document.querySelector('.person-expel').click();

    const sent = app.socket.sent.map((data) => JSON.parse(data));
    assert.deepEqual(sent.at(-1), { type: ClientEvent.ROOM_EXPEL, peerId: 'luis' });
  });

  it('salir de la sala avisa al servidor, desconecta y vuelve al inicio sin mostrar error', async () => {
    const { document, socket, requests } = await startTestApp();
    socket.simulateOpen();

    document.querySelector('#logout').click();
    await flushPromises();

    assert.ok(requests.some(({ method, path }) => method === 'DELETE' && path === '/session'));
    assert.equal(socket.readyState, 3);
    assert.equal(document.querySelector('#home').hidden, false);
    assert.equal(document.querySelector('#home-error').hidden, true);
  });

  it('vuelve al inicio si la conexion cae porque la sala termino', async () => {
    const app = await startTestApp();
    app.socket.simulateOpen();
    app.server.sessionStatus = 401;

    app.socket.simulateClose();
    await flushPromises();

    assert.equal(app.document.querySelector('#home').hidden, false);
    assert.equal(app.document.querySelector('#home-error').textContent, TEXTS.sessionExpired);
  });

  it('sigue reconectando si la conexion cae por la red', async () => {
    const app = await startTestApp();
    app.socket.simulateOpen();

    app.socket.simulateClose();
    await flushPromises();

    assert.equal(app.document.querySelector('#chat').hidden, false);
  });

  it('enlaza el aviso de privacidad desde el inicio y desde la sala', () => {
    const { document } = createPage();
    const links = [...document.querySelectorAll('a.privacy-link')];

    assert.ok(links.length >= 2);
    assert.ok(links.every((link) => link.getAttribute('href') === 'privacy.html'));
    assert.ok(document.querySelector('#home .privacy-link'));
    assert.ok(document.querySelector('#chat .privacy-link'));
  });
});
