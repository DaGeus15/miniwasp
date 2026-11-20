import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TEXTS } from '../../src/client/common/texts.js';
import { PresenceController } from '../../src/client/presence/presence-controller.js';
import { PresenceView } from '../../src/client/presence/presence-view.js';
import { createPage } from '../support/page.js';

const ana = { id: 'peer-ana', name: 'Ana' };
const luis = { id: 'peer-luis', name: 'Luis' };

function setupView() {
  const { document } = createPage();
  return {
    view: new PresenceView(document),
    emptyLabel: document.querySelector('#people-empty'),
    items: () => [...document.querySelectorAll('.person')],
  };
}

function setupController({ name = 'Ana' } = {}) {
  const announced = [];
  const rendered = [];
  const shownNotices = [];
  const approvedCalls = [];
  const identity = { name };

  const controller = new PresenceController({
    signaling: { announce: (value) => announced.push(value) },
    view: { render: (peers) => rendered.push(peers) },
    notices: { show: (key) => shownNotices.push(key) },
    getName: () => identity.name,
    onCallApproved: (peer) => approvedCalls.push(peer),
  });

  return { controller, announced, rendered, shownNotices, approvedCalls, identity };
}

describe('PresenceView', () => {
  it('muestra un aviso si no hay nadie mas', () => {
    const { view, emptyLabel, items } = setupView();

    view.render([]);

    assert.equal(emptyLabel.hidden, false);
    assert.equal(items().length, 0);
  });

  it('muestra a cada persona con su boton de videollamada', () => {
    const { view, emptyLabel, items } = setupView();

    view.render([ana, luis]);

    assert.equal(emptyLabel.hidden, true);
    assert.deepEqual(
      items().map((item) => item.querySelector('.person-name').textContent),
      ['Ana', 'Luis'],
    );
    const button = items()[0].querySelector('button');
    assert.equal(button.textContent, TEXTS.callAction);
    assert.equal(button.getAttribute('aria-label'), TEXTS.callActionLabel('Ana'));
  });

  it('reemplaza la lista anterior', () => {
    const { view, items } = setupView();
    view.render([ana, luis]);

    view.render([luis]);

    assert.equal(items().length, 1);
  });

  it('muestra como texto un nombre con HTML', () => {
    const { view, items } = setupView();
    const name = '<img src=x onerror=alert(1)>';

    view.render([{ id: '1', name }]);

    assert.equal(items()[0].querySelector('.person-name').textContent, name);
    assert.equal(items()[0].querySelector('img'), null);
  });

  it('avisa a quien se quiere llamar', () => {
    const { view, items } = setupView();
    const requested = [];
    view.onCallRequest((peer) => requested.push(peer));
    view.render([ana, luis]);

    items()[1].querySelector('button').click();

    assert.deepEqual(requested, [luis]);
  });

  it('no falla si aun no hay quien atienda el clic', () => {
    const { view, items } = setupView();
    view.render([ana]);

    assert.doesNotThrow(() => items()[0].querySelector('button').click());
  });
});

describe('PresenceController', () => {
  it('se anuncia al conectar y se excluye de la lista', () => {
    const { controller, announced, rendered } = setupController();

    controller.handleWelcome({ peerId: ana.id, peers: [ana, luis] });

    assert.deepEqual(announced, ['Ana']);
    assert.deepEqual(rendered, [[luis]]);
  });

  it('no se anuncia sin un nombre valido', () => {
    const { controller, announced } = setupController({ name: '   ' });

    controller.handleWelcome({ peerId: ana.id, peers: [] });

    assert.deepEqual(announced, []);
  });

  it('actualiza la lista cuando cambia la presencia', () => {
    const { controller, rendered } = setupController();
    controller.handleWelcome({ peerId: ana.id, peers: [] });

    controller.handlePresence({ peers: [ana, luis] });

    assert.deepEqual(rendered.at(-1), [luis]);
  });

  it('vacia la lista al perder la conexion', () => {
    const { controller, rendered } = setupController();

    controller.handleConnectionLost();

    assert.deepEqual(rendered, [[]]);
  });

  it('exige un nombre antes de llamar', () => {
    const { controller, shownNotices, approvedCalls } = setupController({ name: '' });

    controller.requestCall(luis);

    assert.deepEqual(shownNotices, ['nameRequired']);
    assert.deepEqual(approvedCalls, []);
  });

  it('anuncia el nombre actual antes de aprobar la llamada', () => {
    const { controller, identity, announced, approvedCalls } = setupController();
    identity.name = ' Ana Maria ';

    controller.requestCall(luis);

    assert.deepEqual(announced, ['Ana Maria']);
    assert.deepEqual(approvedCalls, [luis]);
  });
});

describe('PresenceView: rol en la sala', () => {
  it('marca a quien creo la sala', () => {
    const { view, items } = setupView();

    view.render([{ ...ana, isOwner: true }, luis]);

    assert.equal(items()[0].querySelector('.person-badge').textContent, TEXTS.ownerBadge);
    assert.equal(items()[1].querySelector('.person-badge'), null);
  });

  it('solo muestra el boton de sacar a quien puede hacerlo', () => {
    const { view, items } = setupView();

    view.render([ana]);
    assert.equal(items()[0].querySelector('.person-expel'), null);

    view.render([ana], { canExpel: true });
    const expelButton = items()[0].querySelector('.person-expel');
    assert.equal(expelButton.textContent, TEXTS.expelAction);
    assert.equal(expelButton.getAttribute('aria-label'), TEXTS.expelActionLabel('Ana'));
  });

  it('avisa a quien se quiere sacar', () => {
    const { view, items } = setupView();
    const requested = [];
    view.onExpelRequest((peer) => requested.push(peer));
    view.render([ana, luis], { canExpel: true });

    items()[1].querySelector('.person-expel').click();

    assert.deepEqual(requested, [luis]);
  });
});

describe('PresenceController: expulsiones', () => {
  function setupWithExpel({ isOwner }) {
    const expelled = [];
    const rendered = [];
    const controller = new PresenceController({
      signaling: { announce() {}, expel: (peerId) => expelled.push(peerId) },
      view: { render: (peers, options) => rendered.push(options) },
      notices: { show() {} },
      getName: () => 'Ana',
      onCallApproved() {},
    });
    controller.handleWelcome({ peerId: ana.id, peers: [ana, luis], isOwner });
    return { controller, expelled, rendered };
  }

  it('quien creo la sala ve la opcion de sacar y puede pedirlo', () => {
    const { controller, expelled, rendered } = setupWithExpel({ isOwner: true });

    controller.requestExpel(luis);

    assert.deepEqual(rendered.at(-1), { canExpel: true, canWhisper: false });
    assert.deepEqual(expelled, [luis.id]);
  });

  it('nadie mas ve la opcion ni puede pedirla', () => {
    const { controller, expelled, rendered } = setupWithExpel({ isOwner: false });

    controller.requestExpel(luis);

    assert.deepEqual(rendered.at(-1), { canExpel: false, canWhisper: false });
    assert.deepEqual(expelled, []);
  });

  it('sin conexion la lista queda vacia y sin opciones', () => {
    const { controller, rendered } = setupWithExpel({ isOwner: true });

    controller.handleConnectionLost();

    assert.deepEqual(rendered.at(-1), { canExpel: false, canWhisper: false });
  });
});
