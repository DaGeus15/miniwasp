import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findAttachmentType } from '../../../src/shared/attachments.js';
import { ServerEvent } from '../../../src/shared/events.js';
import { AttachmentStore } from '../../../src/server/attachments/attachment-store.js';
import { MemoryBlobStorage } from '../../../src/server/attachments/memory-blob-storage.js';
import { RoomMessenger } from '../../../src/server/messaging/room-messenger.js';
import { ModerationProfiles } from '../../../src/server/moderation/moderation-profile.js';
import { ContentBlockedError } from '../../../src/server/moderation/content-blocked-error.js';
import { ContentGate, SessionMutedError } from '../../../src/server/moderation/content-gate.js';
import { StrikeTracker } from '../../../src/server/moderation/strike-tracker.js';
import { TextModerator } from '../../../src/server/moderation/text-moderator.js';
import { Room } from '../../../src/server/rooms/room.js';

const silentLogger = { info() {}, warn() {} };
const metrics = { increment() {} };

function setup() {
  const broadcasts = [];
  const ownerNotices = [];
  const peers = {
    broadcast: (roomId, event) => broadcasts.push(event),
    notifyOwners: (roomId, event) => ownerNotices.push(event),
  };
  const attachments = new AttachmentStore({ storage: new MemoryBlobStorage(), logger: silentLogger });
  const expelled = [];
  const contentGate = new ContentGate({
    textModerator: new TextModerator(),
    imageInspector: null,
    strikes: new StrikeTracker(),
    onExpel: (session) => expelled.push(session.id),
    logger: silentLogger,
    metrics,
  });
  const room = new Room({ onMessageRemoved: (message) => message.attachment && attachments.delete(message.attachment.id) });
  const messenger = new RoomMessenger({ peers, attachments, contentGate, metrics, logger: silentLogger });
  const owner = { id: 'duena', roomId: room.id, isOwner: true };
  const member = (id) => ({ id, roomId: room.id, isOwner: false });
  return { messenger, room, attachments, broadcasts, ownerNotices, owner, member, expelled };
}

describe('RoomMessenger: enviar', () => {
  it('publica un adjunto con pie de foto opcional y lo consume una sola vez', async () => {
    const { messenger, room, attachments, member } = setup();
    const ana = member('ana');
    const attachment = await attachments.add({
      room,
      sessionId: 'ana',
      type: findAttachmentType('application/pdf'),
      fileName: 'a.pdf',
      bytes: Buffer.from('%PDF-'),
    });

    const message = messenger.send({ room, session: ana, name: 'Ana', text: '   ', attachmentId: attachment.id });

    assert.equal(message.text, '');
    assert.deepEqual(message.attachment, attachment.toPublic());
    assert.throws(() => messenger.send({ room, session: ana, name: 'Ana', attachmentId: attachment.id }));
  });

  it('un mensaje bloqueado o invalido no consume el adjunto ni se guarda', async () => {
    const { messenger, room, attachments, member } = setup();
    const ana = member('ana');
    const attachment = await attachments.add({
      room,
      sessionId: 'ana',
      type: findAttachmentType('text/plain'),
      fileName: 'a.txt',
      bytes: Buffer.from('hola'),
    });

    assert.throws(
      () => messenger.send({ room, session: ana, name: 'Ana', text: 'vendo cocaina', attachmentId: attachment.id }),
      ContentBlockedError,
    );
    assert.throws(() => messenger.send({ room, session: ana, name: 'Ana', text: 'x'.repeat(501), attachmentId: attachment.id }));
    assert.deepEqual(room.chat.history(), []);
    assert.ok(messenger.send({ room, session: ana, name: 'Ana', attachmentId: attachment.id }));
  });

  it('tres bloqueos silencian la sesion y lo mas grave la expulsa', () => {
    const { messenger, room, member, expelled } = setup();
    const luis = member('luis');
    const attempt = (session, text) => () => messenger.send({ room, session, name: 'Luis', text });

    for (let strike = 0; strike < 3; strike += 1) {
      assert.throws(attempt(luis, 'vendo cocaina'), ContentBlockedError);
    }
    assert.throws(attempt(luis, 'hola'), SessionMutedError);
    assert.throws(attempt(member('otro'), 'fotos de niñas desnudas'), ContentBlockedError);
    assert.deepEqual(expelled, ['otro']);
  });
});

describe('RoomMessenger: borrar y reportar', () => {
  it('borra para todos si lo pide su autor o quien creo la sala, y nadie mas', () => {
    const { messenger, room, broadcasts, owner, member } = setup();
    const ana = member('ana');
    const first = messenger.send({ room, session: ana, name: 'Ana', text: 'uno' });
    const second = messenger.send({ room, session: ana, name: 'Ana', text: 'dos' });

    assert.throws(() => messenger.delete({ room, session: member('luis'), messageId: first.id }), /tus propios/);
    messenger.delete({ room, session: ana, messageId: first.id });
    messenger.delete({ room, session: owner, messageId: second.id });
    messenger.delete({ room, session: owner, messageId: 'no-existe' });

    assert.deepEqual(room.chat.history(), []);
    assert.deepEqual(
      broadcasts.filter((event) => event.type === ServerEvent.MESSAGE_DELETED).map((event) => event.messageId),
      [first.id, second.id],
    );
  });

  it('avisa a quien creo la sala y borra solo al llegar a varios reportes distintos', () => {
    const { messenger, room, ownerNotices, member } = setup();
    const ana = member('ana');
    const message = messenger.send({ room, session: ana, name: 'Ana', text: 'hola' });
    const report = (session) => messenger.report({ room, session, messageId: message.id });

    report(ana);
    report(member('luis'));
    report(member('luis'));
    report(member('carla'));

    assert.deepEqual(ownerNotices, [
      { type: ServerEvent.MESSAGE_REPORTED, messageId: message.id, reports: 1 },
      { type: ServerEvent.MESSAGE_REPORTED, messageId: message.id, reports: 2 },
    ]);
    for (let index = 0; index < ModerationProfiles.STANDARD.reportsToRemove; index += 1) {
      report(member(`persona-${index}`));
    }
    assert.equal(room.chat.has(message.id), false);
    messenger.report({ room, session: member('tarde'), messageId: message.id });
  });

  it('borrar un mensaje con adjunto borra tambien el archivo', async () => {
    const { messenger, room, attachments, member } = setup();
    const ana = member('ana');
    const attachment = await attachments.add({
      room,
      sessionId: 'ana',
      type: findAttachmentType('application/pdf'),
      fileName: 'a.pdf',
      bytes: Buffer.from('%PDF-'),
    });
    const message = messenger.send({ room, session: ana, name: 'Ana', attachmentId: attachment.id });

    messenger.delete({ room, session: ana, messageId: message.id });

    assert.equal(attachments.findSent(room.id, attachment.id), null);
  });
});
