import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WebSocket } from 'ws';
import { CloseCode, PeerRegistry } from '../../src/server/peers/peer-registry.js';
import { Peer } from '../../src/server/peers/peer.js';
import { ServerEvent } from '../../src/shared/events.js';

class FakeServerSocket {
  readyState = WebSocket.OPEN;
  sent = [];
  closeCode = null;

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close(code) {
    this.closeCode = code;
  }
}

function sessionOf(id, { roomId = 'sala-1', isOwner = false } = {}) {
  return { id, roomId, isOwner };
}

function createPeer({ address = 'ip', session = sessionOf('sesion') } = {}) {
  return new Peer({ socket: new FakeServerSocket(), address, session });
}

describe('Peer', () => {
  it('genera ids que no se repiten', () => {
    assert.notEqual(createPeer().id, createPeer().id);
  });

  it('toma la sala y el rol de su sesion', () => {
    const peer = createPeer({ session: sessionOf('s', { roomId: 'sala-7', isOwner: true }) });

    assert.equal(peer.sessionId, 's');
    assert.equal(peer.roomId, 'sala-7');
    assert.equal(peer.isOwner, true);
  });

  it('solo esta presente cuando tiene nombre', () => {
    const peer = createPeer();
    assert.equal(peer.isPresent, false);
    assert.equal(peer.name, null);

    peer.rename('Ana');

    assert.equal(peer.isPresent, true);
    assert.deepEqual(peer.toPublicProfile(), { id: peer.id, name: 'Ana', isOwner: false });
  });

  it('compara nombres sin distinguir mayusculas', () => {
    const peer = createPeer();
    assert.equal(peer.isNamed('Ana'), false);

    peer.rename('Ana');

    assert.equal(peer.isNamed('ANA'), true);
    assert.equal(peer.isNamed('Luis'), false);
  });

  it('sabe si comparte sala con otra conexion', () => {
    const peer = createPeer();

    assert.equal(peer.sharesRoomWith(createPeer()), true);
    assert.equal(peer.sharesRoomWith(createPeer({ session: sessionOf('x', { roomId: 'otra' }) })), false);
    assert.equal(peer.sharesRoomWith(undefined), false);
  });

  it('informa si el nombre cambio', () => {
    const peer = createPeer();

    assert.equal(peer.rename('Ana'), true);
    assert.equal(peer.rename('Ana'), false);
  });

  it('no expone su direccion, sesion ni sala en el perfil publico', () => {
    const peer = createPeer({ address: '10.0.0.1', session: sessionOf('sesion-secreta', { roomId: 'sala-secreta' }) });
    peer.rename('Ana');

    assert.doesNotMatch(JSON.stringify(peer.toPublicProfile()), /10\.0\.0\.1|sesion-secreta|sala-secreta/);
  });

  it('no envia nada a un socket cerrado', () => {
    const socket = new FakeServerSocket();
    socket.readyState = WebSocket.CLOSED;

    new Peer({ socket, address: 'ip', session: sessionOf('s') }).send({ type: ServerEvent.ERROR });

    assert.deepEqual(socket.sent, []);
  });

  it('envia errores con el formato del protocolo', () => {
    const socket = new FakeServerSocket();

    new Peer({ socket, address: 'ip', session: sessionOf('s') }).sendError('fallo');

    assert.deepEqual(socket.sent, [{ type: ServerEvent.ERROR, error: 'fallo' }]);
  });
});

describe('PeerRegistry', () => {
  function setup() {
    const registry = new PeerRegistry();
    const sockets = { first: new FakeServerSocket(), second: new FakeServerSocket(), outsider: new FakeServerSocket() };
    return {
      registry,
      sockets,
      first: registry.add({ socket: sockets.first, address: 'ip-1', session: sessionOf('s1') }),
      second: registry.add({ socket: sockets.second, address: 'ip-2', session: sessionOf('s2') }),
      outsider: registry.add({
        socket: sockets.outsider,
        address: 'ip-3',
        session: sessionOf('s3', { roomId: 'sala-2' }),
      }),
    };
  }

  it('encuentra a cada persona por su id', () => {
    const { registry, first } = setup();

    assert.equal(registry.find(first.id), first);
    assert.equal(registry.find('desconocido'), undefined);
  });

  it('solo lista a quienes tienen nombre y son de la sala pedida', () => {
    const { registry, first, outsider } = setup();
    registry.rename(first, 'Ana');
    registry.rename(outsider, 'Rosa');

    assert.deepEqual(registry.publicProfiles('sala-1'), [{ id: first.id, name: 'Ana', isOwner: false }]);
    assert.deepEqual(registry.publicProfiles('sala-2'), [{ id: outsider.id, name: 'Rosa', isOwner: false }]);
  });

  it('anuncia la presencia solo a la sala de quien cambia de nombre', () => {
    const { registry, first, sockets } = setup();

    registry.rename(first, 'Ana');

    assert.deepEqual(sockets.second.sent, [
      { type: ServerEvent.PRESENCE, peers: [{ id: first.id, name: 'Ana', isOwner: false }] },
    ]);
    assert.deepEqual(sockets.outsider.sent, []);
  });

  it('no repite el anuncio si el nombre es el mismo', () => {
    const { registry, first, sockets } = setup();
    registry.rename(first, 'Ana');

    registry.rename(first, 'Ana');

    assert.equal(sockets.second.sent.length, 1);
  });

  it('anuncia la salida de quien tenia nombre solo a su sala', () => {
    const { registry, first, sockets } = setup();
    registry.rename(first, 'Ana');

    registry.remove(first);

    assert.deepEqual(sockets.second.sent.at(-1), { type: ServerEvent.PRESENCE, peers: [] });
    assert.deepEqual(sockets.outsider.sent, []);
    assert.equal(registry.find(first.id), undefined);
  });

  it('no anuncia la salida de quien nunca aparecio', () => {
    const { registry, first, sockets } = setup();

    registry.remove(first);

    assert.deepEqual(sockets.second.sent, []);
  });

  it('sabe si una sala todavia tiene conexiones', () => {
    const { registry, first, second } = setup();
    assert.equal(registry.hasMembers('sala-1'), true);

    registry.remove(first);
    registry.remove(second);

    assert.equal(registry.hasMembers('sala-1'), false);
    assert.equal(registry.hasMembers('sala-2'), true);
  });

  it('limita las personas por sala contando sesiones, no pestanas', () => {
    const { registry } = setup();

    assert.equal(registry.admitsSession('sala-1', 's9', 3), true);
    assert.equal(registry.admitsSession('sala-1', 's9', 2), false);
    assert.equal(registry.admitsSession('sala-1', 's1', 2), true, 'otra pestana de alguien que ya esta');
  });

  it('difunde un evento solo a la sala indicada', () => {
    const { registry, sockets } = setup();
    const event = { type: ServerEvent.ERROR, error: 'aviso' };

    registry.broadcast('sala-1', event);

    assert.deepEqual(sockets.first.sent, [event]);
    assert.deepEqual(sockets.second.sent, [event]);
    assert.deepEqual(sockets.outsider.sent, []);
  });

  it('cierra solo las conexiones de una sesion, con el codigo indicado', () => {
    const { registry, sockets } = setup();

    registry.closeSession('s1', CloseCode.EXPELLED);
    registry.closeSession('s2');

    assert.equal(sockets.first.closeCode, CloseCode.EXPELLED);
    assert.equal(sockets.second.closeCode, CloseCode.SESSION_ENDED);
    assert.equal(sockets.outsider.closeCode, null);
  });

  it('cierra todas las conexiones de una sala cerrada', () => {
    const { registry, sockets } = setup();

    registry.closeRoom('sala-1');

    assert.equal(sockets.first.closeCode, CloseCode.ROOM_CLOSED);
    assert.equal(sockets.second.closeCode, CloseCode.ROOM_CLOSED);
    assert.equal(sockets.outsider.closeCode, null);
  });

  it('cierra las conexiones cuyas sesiones ya no estan activas', () => {
    const { registry, sockets } = setup();

    registry.closeInactiveSessions((sessionId) => sessionId !== 's1');

    assert.equal(sockets.first.closeCode, CloseCode.SESSION_ENDED);
    assert.equal(sockets.second.closeCode, null);
  });

  it('usa codigos de cierre fijos del protocolo', () => {
    assert.deepEqual(CloseCode, { SESSION_ENDED: 4401, EXPELLED: 4403, ROOM_CLOSED: 4404 });
  });
});

describe('PeerRegistry: reconexiones', () => {
  function addPeer(registry, sessionId) {
    return registry.add({ socket: new FakeServerSocket(), address: 'ip', session: sessionOf(sessionId) });
  }

  it('CP-014: muestra una sola vez a quien reconecta, con su conexion mas reciente', () => {
    const registry = new PeerRegistry();
    const previous = addPeer(registry, 's1');
    const current = addPeer(registry, 's1');
    registry.rename(previous, 'Ana');
    registry.rename(current, 'Ana');

    assert.deepEqual(registry.publicProfiles('sala-1'), [{ id: current.id, name: 'Ana', isOwner: false }]);
  });

  it('vuelve a mostrar la conexion anterior si la nueva se cierra', () => {
    const registry = new PeerRegistry();
    const previous = addPeer(registry, 's1');
    const current = addPeer(registry, 's1');
    registry.rename(previous, 'Ana');
    registry.rename(current, 'Ana');

    registry.remove(current);

    assert.deepEqual(registry.publicProfiles('sala-1'), [{ id: previous.id, name: 'Ana', isOwner: false }]);
  });
});
