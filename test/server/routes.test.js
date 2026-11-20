import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WebSocket } from 'ws';
import { createCallRoutes, createChatRoute, createRoomRoutes } from '../../src/server/messaging/routes.js';
import { RoomMessenger } from '../../src/server/messaging/room-messenger.js';
import { CloseCode, PeerRegistry } from '../../src/server/peers/peer-registry.js';
import { RoomRegistry } from '../../src/server/rooms/room-registry.js';
import { SessionStore } from '../../src/server/security/session-store.js';
import { ClientEvent, ServerEvent } from '../../src/shared/events.js';

class RecordingSocket {
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

const allowAll = { allow: () => true };

function setup() {
  const sessions = new SessionStore();
  const rooms = new RoomRegistry({ schedule: () => () => {} });
  const peers = new PeerRegistry();
  const room = rooms.create();
  const logger = { info() {} };
  const contentGate = { reviewText() {} };
  const context = {
    rooms,
    peers,
    sessions,
    contentGate,
    messenger: new RoomMessenger({ peers, contentGate, metrics: { increment() {} }, logger }),
    videoCalls: { leaveAll() {} },
    chatLimiter: allowAll,
    presenceLimiter: allowAll,
    signalLimiter: allowAll,
    reportLimiter: allowAll,
    logger,
  };
  const join = ({ isOwner = false } = {}) => {
    const { session } = sessions.create({ roomId: room.id, isOwner });
    const socket = new RecordingSocket();
    return { peer: peers.add({ socket, address: 'ip', session }), socket, session };
  };
  return { context, room, rooms, peers, sessions, join, roomRoutes: createRoomRoutes(context) };
}

describe('ruta del chat', () => {
  it('responde con un error de validacion si el nombre no es texto', () => {
    const { context, join } = setup();

    assert.throws(() => createChatRoute(context).handle(join().peer, {}), {
      name: 'ValidationError',
      message: 'El nombre debe ser texto',
    });
  });

  it('guarda y difunde el mensaje con el nombre validado de quien lo envia', () => {
    const { context, room, join } = setup();
    const ana = join();
    const luis = join();

    createChatRoute(context).handle(ana.peer, { name: ' Ana ', text: 'hola' });

    assert.deepEqual(room.chat.history().map(({ name, text }) => ({ name, text })), [{ name: 'Ana', text: 'hola' }]);
    assert.ok(luis.socket.sent.some((event) => event.type === ServerEvent.MESSAGE));
    assert.equal(ana.peer.name, 'Ana');
  });

  it('un texto invalido no reserva el nombre ni guarda nada', () => {
    const { context, room, join } = setup();
    const ana = join();

    assert.throws(() => createChatRoute(context).handle(ana.peer, { name: 'Ana', text: '   ' }));

    assert.deepEqual(room.chat.history(), []);
    assert.equal(room.names.isAvailableFor('otra-sesion', 'Ana'), true);
    assert.equal(ana.peer.name, null);
  });

  it('SEC-002: nadie toma el nombre de otra persona aunque esta ya se haya ido', () => {
    const { context, peers, room, join } = setup();
    const ana = join();
    createChatRoute(context).handle(ana.peer, { name: 'Ana', text: 'hola' });
    peers.remove(ana.peer);
    const impostor = join();

    assert.throws(() => createChatRoute(context).handle(impostor.peer, { name: 'ANA', text: 'soy Ana' }), {
      message: 'Ese nombre ya lo usa otra persona de esta sala',
    });
    assert.equal(room.chat.history().length, 1);
  });

  it('la misma sesion puede volver a usar su nombre tras reconectar', () => {
    const { context, peers, sessions, room, join } = setup();
    const ana = join();
    createChatRoute(context).handle(ana.peer, { name: 'Ana', text: 'hola' });
    peers.remove(ana.peer);
    const reconnected = peers.add({ socket: new RecordingSocket(), address: 'ip', session: ana.session });

    createChatRoute(context).handle(reconnected, { name: 'Ana', text: 'volvi' });

    assert.equal(room.chat.history().length, 2);
    assert.ok(sessions);
  });
});

describe('rutas de la sala', () => {
  it('la presencia reserva el nombre y lo anuncia a la sala', () => {
    const { roomRoutes, room, join } = setup();
    const ana = join();
    const luis = join();

    roomRoutes.get(ClientEvent.PRESENCE).handle(ana.peer, { name: 'Ana' });

    assert.equal(room.names.isAvailableFor(luis.session.id, 'ana'), false);
    assert.equal(luis.socket.sent.at(-1).type, ServerEvent.PRESENCE);
  });

  it('cambiar de nombre libera el anterior', () => {
    const { roomRoutes, room, join } = setup();
    const ana = join();

    roomRoutes.get(ClientEvent.PRESENCE).handle(ana.peer, { name: 'Ana' });
    roomRoutes.get(ClientEvent.PRESENCE).handle(ana.peer, { name: 'Anita' });

    assert.equal(room.names.isAvailableFor('otra', 'Ana'), true);
    assert.equal(room.names.isAvailableFor('otra', 'Anita'), false);
  });

  it('la presencia usa su propio limite, distinto del de las senales', () => {
    const { context, roomRoutes } = setup();

    assert.equal(roomRoutes.get(ClientEvent.PRESENCE).limiter, context.presenceLimiter);
    assert.equal(roomRoutes.get(ClientEvent.CHAT_MESSAGE).limiter, context.chatLimiter);
    assert.equal(roomRoutes.get(ClientEvent.ROOM_EXPEL).limiter, context.signalLimiter);
  });

  it('sacar a alguien revoca su sesion, libera su nombre, cierra su conexion y renueva la invitacion', () => {
    const { roomRoutes, sessions, room, join } = setup();
    const owner = join({ isOwner: true });
    const guest = join();
    roomRoutes.get(ClientEvent.PRESENCE).handle(guest.peer, { name: 'Luis' });
    const previousInvite = room.inviteToken;

    roomRoutes.get(ClientEvent.ROOM_EXPEL).handle(owner.peer, { peerId: guest.peer.id });

    assert.equal(sessions.isActive(guest.session.id), false);
    assert.equal(room.names.isAvailableFor('otra', 'Luis'), true);
    assert.equal(guest.socket.closeCode, CloseCode.EXPELLED);
    assert.notEqual(room.inviteToken, previousInvite);
    assert.deepEqual(owner.socket.sent.at(-1), { type: ServerEvent.ROOM_INVITE, inviteToken: room.inviteToken });
  });

  it('ignora sacar a alguien inexistente, a si mismo o de otra sala', () => {
    const { roomRoutes, rooms, peers, sessions, room, join } = setup();
    const owner = join({ isOwner: true });
    const otherRoom = rooms.create();
    const { session } = sessions.create({ roomId: otherRoom.id, isOwner: false });
    const stranger = peers.add({ socket: new RecordingSocket(), address: 'ip', session });
    const invite = room.inviteToken;

    for (const peerId of ['no-existe', owner.peer.id, stranger.id]) {
      roomRoutes.get(ClientEvent.ROOM_EXPEL).handle(owner.peer, { peerId });
    }

    assert.equal(room.inviteToken, invite);
    assert.equal(sessions.isActive(session.id), true);
    assert.equal(owner.socket.closeCode, null);
  });

  it('solo quien creo la sala puede sacar personas o renovar la invitacion', () => {
    const { roomRoutes, room, join } = setup();
    const owner = join({ isOwner: true });
    const guest = join();
    const invite = room.inviteToken;

    for (const [type, payload] of [
      [ClientEvent.ROOM_EXPEL, { peerId: owner.peer.id }],
      [ClientEvent.ROOM_ROTATE_INVITE, {}],
    ]) {
      assert.throws(() => roomRoutes.get(type).handle(guest.peer, payload), {
        name: 'ValidationError',
        message: 'Solo quien creó la sala puede hacer esto',
      });
    }
    assert.equal(room.inviteToken, invite);
  });

  it('renovar la invitacion la anuncia a toda la sala', () => {
    const { roomRoutes, room, join } = setup();
    const owner = join({ isOwner: true });
    const guest = join();

    roomRoutes.get(ClientEvent.ROOM_ROTATE_INVITE).handle(owner.peer, {});

    assert.deepEqual(guest.socket.sent.at(-1), { type: ServerEvent.ROOM_INVITE, inviteToken: room.inviteToken });
  });
});

describe('rutas de llamadas', () => {
  it('entrega cada accion de llamada al coordinador con quien la envio', () => {
    const received = [];
    const record = (method) => (...args) => received.push([method, ...args]);
    const calls = {
      invite: record('invite'),
      accept: record('accept'),
      reject: record('reject'),
      hangUp: record('hangUp'),
      relaySignal: record('relaySignal'),
    };
    const signalLimiter = { name: 'senales' };
    const inviteLimiter = { name: 'invitaciones' };
    const routes = createCallRoutes({ calls, signalLimiter, inviteLimiter });
    const peer = { id: 'ana' };
    const signal = { kind: 'offer', sdp: 'v=0' };

    routes.get(ClientEvent.CALL_INVITE).handle(peer, { to: 'luis' });
    routes.get(ClientEvent.CALL_ACCEPT).handle(peer, { callId: 'c1' });
    routes.get(ClientEvent.CALL_REJECT).handle(peer, { callId: 'c1' });
    routes.get(ClientEvent.CALL_HANGUP).handle(peer, { callId: 'c1' });
    routes.get(ClientEvent.CALL_SIGNAL).handle(peer, { callId: 'c1', signal });

    assert.deepEqual(received, [
      ['invite', peer, 'luis'],
      ['accept', peer, 'c1'],
      ['reject', peer, 'c1'],
      ['hangUp', peer, 'c1'],
      ['relaySignal', peer, 'c1', signal],
    ]);
    assert.equal(routes.get(ClientEvent.CALL_INVITE).limiter, inviteLimiter);
    assert.equal(routes.get(ClientEvent.CALL_SIGNAL).limiter, signalLimiter);
  });
});
