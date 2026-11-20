import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ModerationProfiles } from '../../src/server/moderation/moderation-profile.js';
import { PublicRoomDirectory } from '../../src/server/rooms/public-room-directory.js';
import { RoomBanList, MAX_BANS_PER_ROOM } from '../../src/server/rooms/room-ban-list.js';
import { RoomRegistry } from '../../src/server/rooms/room-registry.js';
import { Room, RoomVisibility } from '../../src/server/rooms/room.js';
import { ClientEvent, ServerEvent } from '../../src/shared/events.js';
import { createTestServer } from '../support/test-server.js';
import { openClient, stopServer } from '../support/ws-client.js';

function readCookie(response) {
  return response.headers.get('set-cookie')?.split(';')[0] ?? null;
}

describe('Room: tipos de sala', () => {
  it('una privada usa el perfil estandar y una publica el estricto con id de lista propio', () => {
    const privateRoom = new Room();
    const publicRoom = new Room({ visibility: RoomVisibility.PUBLIC, title: 'Fútbol' });

    assert.equal(privateRoom.profile, ModerationProfiles.STANDARD);
    assert.equal(privateRoom.title, null);
    assert.equal(privateRoom.listingId, null);
    assert.equal(publicRoom.profile, ModerationProfiles.STRICT);
    assert.equal(publicRoom.title, 'Fútbol');
    assert.notEqual(publicRoom.listingId, publicRoom.id);
    assert.equal(publicRoom.isListed, true);
  });

  it('un susurro admite dos personas y no se puede abrir con su invitacion', () => {
    const registry = new RoomRegistry({ schedule: () => () => {} });
    const whisper = registry.create({ visibility: RoomVisibility.WHISPER });

    assert.equal(whisper.capacityWithin(20), 2);
    assert.equal(whisper.isOpenByInvite, false);
    assert.equal(registry.findByInvite(whisper.inviteToken), null);
    assert.equal(new Room({ visibility: 'inventada' }).visibility, RoomVisibility.PRIVATE);
    assert.equal(new Room().capacityWithin(20), 20);
  });

  it('el perfil estricto solo acepta lo que se puede revisar por dentro', () => {
    assert.equal(ModerationProfiles.STRICT.allowsType('image/jpeg'), true);
    assert.equal(ModerationProfiles.STRICT.allowsType('audio/webm'), false);
    assert.equal(ModerationProfiles.STRICT.allowsType('application/pdf'), false);
    assert.equal(ModerationProfiles.STANDARD.allowsType('application/pdf'), true);
  });
});

describe('RoomBanList', () => {
  it('veta huellas, ignora vacias y tiene tope', () => {
    const bans = new RoomBanList();
    bans.ban('abc');
    bans.ban(undefined);

    assert.equal(bans.isBanned('abc'), true);
    assert.equal(bans.isBanned(undefined), false);
    for (let index = 0; index < MAX_BANS_PER_ROOM + 5; index += 1) {
      bans.ban(`ref-${index}`);
    }
    assert.equal(bans.isBanned(`ref-${MAX_BANS_PER_ROOM + 1}`), false);
  });
});

describe('PublicRoomDirectory', () => {
  it('lista solo salas publicas con gente, las mas concurridas primero, sin datos internos', () => {
    const members = new Map();
    const directory = new PublicRoomDirectory({ countMembers: (id) => members.get(id) ?? 0, maxRoomMembers: 20, maxRooms: 3 });
    const quiet = new Room({ visibility: RoomVisibility.PUBLIC, title: 'Tranquila' });
    const busy = new Room({ visibility: RoomVisibility.PUBLIC, title: 'Concurrida' });
    const empty = new Room({ visibility: RoomVisibility.PUBLIC, title: 'Vacía' });
    [quiet, busy, empty, new Room()].forEach((room) => directory.add(room));
    members.set(quiet.id, 1).set(busy.id, 5);

    const listed = directory.list();

    assert.deepEqual(listed.map((entry) => entry.title), ['Concurrida', 'Tranquila']);
    assert.deepEqual(Object.keys(listed[0]), ['listingId', 'title', 'members', 'capacity']);
    assert.equal(directory.find(busy.listingId), busy);
    assert.equal(directory.hasCapacity, false);
    members.set(busy.id, 20);
    assert.equal(directory.isFull(busy), true);
    directory.remove(busy);
    assert.equal(directory.find(busy.listingId), null);
  });
});

describe('salas publicas por HTTP', () => {
  let server;
  let httpUrl;
  let wsUrl;
  let clients;

  async function start(options = {}) {
    server = createTestServer(options);
    const port = await server.listen(0, '127.0.0.1');
    httpUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}`;
    clients = [];
  }

  function post(path, body, headers = {}) {
    return fetch(`${httpUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: httpUrl, ...headers },
      body: JSON.stringify(body),
    });
  }

  async function createPublicRoom(title, headers = {}) {
    const response = await post('/rooms', { acceptedRules: true, visibility: 'public', title }, headers);
    return { response, cookie: readCookie(response) };
  }

  async function connect(cookie) {
    const client = openClient(wsUrl, { headers: { Cookie: cookie } });
    clients.push(client);
    await client.next();
    return client;
  }

  async function listRooms() {
    return (await (await fetch(`${httpUrl}/rooms/public`)).json()).rooms;
  }

  afterEach(async () => {
    clients.forEach((client) => client.socket.terminate());
    await stopServer(server);
  });

  it('una sala publica aparece en la portada cuando hay alguien y se puede entrar desde ahi', async () => {
    await start();
    const { response, cookie } = await createPublicRoom('Charla general');
    assert.equal(response.status, 204);
    assert.deepEqual(await listRooms(), []);

    await connect(cookie);
    const [listed] = await listRooms();
    const join = await post(`/rooms/public/${listed.listingId}/join`, { acceptedRules: true });
    const status = await (await fetch(`${httpUrl}/session`, { headers: { Cookie: readCookie(join) } })).json();

    assert.deepEqual({ title: listed.title, members: listed.members, capacity: listed.capacity }, { title: 'Charla general', members: 1, capacity: 20 });
    assert.equal(join.status, 204);
    assert.deepEqual({ visibility: status.visibility, title: status.title, isOwner: status.isOwner }, { visibility: 'public', title: 'Charla general', isOwner: false });
  });

  it('el titulo es obligatorio, se modera con las reglas estrictas y no acepta caracteres invisibles', async () => {
    // Los intentos fallidos tambien cuentan para el limite: aqui se desactiva para probar cada caso.
    await start({ publicRoomCreationLimiter: { allow: () => true } });
    const cases = [
      [undefined, 400],
      ['  ', 400],
      ['x'.repeat(41), 400],
      [`Sala${String.fromCodePoint(0x202e)}`, 400],
      ['Vendo cocaina', 422],
    ];
    for (const [title, status] of cases) {
      const { response } = await createPublicRoom(title);
      assert.equal(response.status, status, String(title));
      assert.equal(response.headers.get('set-cookie'), null);
    }
  });

  it('limita la creacion de salas publicas por IP y su numero total', async () => {
    await start({ maxPublicRooms: 1 });
    assert.equal((await createPublicRoom('Una')).response.status, 204);
    assert.equal((await createPublicRoom('Dos')).response.status, 503);
    await stopServer(server);

    await start();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await createPublicRoom(`Sala ${attempt}`);
    }
    assert.equal((await createPublicRoom('Cuarta')).response.status, 429);
  });

  it('unirse exige normas, una sala existente y lugar libre', async () => {
    await start({ maxRoomMembers: 1 });
    const { cookie } = await createPublicRoom('Charla general');
    await connect(cookie);
    const [listed] = await listRooms();

    assert.equal((await post(`/rooms/public/${listed.listingId}/join`, {})).status, 400);
    assert.equal((await post('/rooms/public/00000000-0000-4000-8000-000000000000/join', { acceptedRules: true })).status, 404);
    const full = await post(`/rooms/public/${listed.listingId}/join`, { acceptedRules: true });
    assert.equal(full.status, 503);
    assert.equal((await full.json()).code, 'ROOM_FULL');
    assert.equal((await post(`/rooms/public/${listed.listingId}/join`, { acceptedRules: true }, { Origin: 'https://evil.test' })).status, 403);
  });

  it('quien es expulsado de una sala publica no puede volver, ni por la lista ni por invitacion', async () => {
    await start();
    const { cookie: ownerCookie } = await createPublicRoom('Charla general');
    const owner = await connect(ownerCookie);
    const [listed] = await listRooms();
    const guestCookie = readCookie(await post(`/rooms/public/${listed.listingId}/join`, { acceptedRules: true }));
    const guest = openClient(wsUrl, { headers: { Cookie: guestCookie }, ignoredEvents: [] });
    clients.push(guest);
    let welcome = await guest.next();
    while (welcome.type !== ServerEvent.WELCOME) {
      welcome = await guest.next();
    }

    owner.send({ type: ClientEvent.ROOM_EXPEL, peerId: welcome.peerId });
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
    const status = await (await fetch(`${httpUrl}/session`, { headers: { Cookie: ownerCookie } })).json();
    const again = await post(`/rooms/public/${listed.listingId}/join`, { acceptedRules: true });
    const byInvite = await post('/rooms/join', { acceptedRules: true, inviteToken: status.inviteToken });

    assert.equal(again.status, 403);
    assert.equal((await again.json()).code, 'BANNED_FROM_ROOM');
    assert.equal(byInvite.status, 403);
  });

  it('en una sala publica se bloquean las groserias y el modo lento frena rafagas', async () => {
    await start();
    const { cookie } = await createPublicRoom('Charla general');
    const client = await connect(cookie);

    client.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Ana', text: 'hola a todos' });
    assert.equal((await client.next()).type, ServerEvent.MESSAGE);
    client.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Ana', text: 'otro mensaje' });
    assert.match((await client.next()).error, /modo lento/);
  });

  it('las groserias se bloquean en una sala publica pero no en una privada', async () => {
    await start();
    const { cookie: publicCookie } = await createPublicRoom('Charla general');
    const privateCookie = readCookie(await post('/rooms', { acceptedRules: true }));
    const inPublic = await connect(publicCookie);
    const inPrivate = await connect(privateCookie);

    inPublic.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Ana', text: 'que mierda de partido' });
    inPrivate.send({ type: ClientEvent.CHAT_MESSAGE, name: 'Ana', text: 'que mierda de partido' });

    assert.match((await inPublic.next()).error, /groser/);
    assert.equal((await inPrivate.next()).type, ServerEvent.MESSAGE);
  });

  it('en una sala publica no se pueden subir notas de voz ni PDF', async () => {
    await start();
    const { cookie } = await createPublicRoom('Charla general');
    const upload = (bytes) =>
      fetch(`${httpUrl}/rooms/attachments`, {
        method: 'POST',
        headers: { Origin: httpUrl, Cookie: cookie, 'X-File-Name': 'archivo' },
        body: bytes,
      });

    const voice = await upload(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1]));
    const pdf = await upload(Buffer.from('%PDF-1.7'));
    const text = await upload(Buffer.from('notas del grupo'));

    assert.equal(voice.status, 415);
    assert.match((await voice.json()).error, /fotos y archivos de texto/);
    assert.equal(pdf.status, 415);
    assert.equal(text.status, 201);
  });
});
