import { randomBytes, randomUUID } from 'node:crypto';
import { RoomCipher } from '../attachments/room-cipher.js';
import { ChatRoom } from '../chat/chat-room.js';
import { ModerationProfiles } from '../moderation/moderation-profile.js';
import { NameBook } from './name-book.js';
import { RoomBanList } from './room-ban-list.js';

const INVITE_TOKEN_BYTES = 16;
const WHISPER_CAPACITY = 2;

export const RoomVisibility = Object.freeze({
  PRIVATE: 'private',
  PUBLIC: 'public',
  WHISPER: 'whisper',
});

// Como se comporta cada tipo de sala. capacity null usa el tope general del servidor.
const ROOM_KINDS = new Map([
  [RoomVisibility.PRIVATE, { profile: ModerationProfiles.STANDARD, capacity: null, isOpenByInvite: true, isListed: false }],
  [RoomVisibility.PUBLIC, { profile: ModerationProfiles.STRICT, capacity: null, isOpenByInvite: true, isListed: true }],
  // Un susurro es una sala de dos personas que se conocieron en una sala publica: nadie mas entra.
  [RoomVisibility.WHISPER, { profile: ModerationProfiles.STRICT, capacity: WHISPER_CAPACITY, isOpenByInvite: false, isListed: false }],
]);

// 128 bits aleatorios: adivinar una invitacion vigente es inviable.
export function createInviteToken() {
  return randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
}

// Una sala temporal: su historial, sus nombres y la clave de sus archivos viven solo mientras
// la sala existe.
export class Room {
  #inviteToken;
  #createInviteToken;
  #kind;
  #cancelCleanup = null;

  constructor({ createToken = createInviteToken, onMessageRemoved, visibility = RoomVisibility.PRIVATE, title = null, now = Date.now } = {}) {
    this.#kind = ROOM_KINDS.get(visibility) ?? ROOM_KINDS.get(RoomVisibility.PRIVATE);
    this.id = randomUUID();
    this.visibility = ROOM_KINDS.has(visibility) ? visibility : RoomVisibility.PRIVATE;
    this.title = this.#kind.isListed ? title : null;
    // Id para la lista publica, distinto del id interno, que nunca sale del servidor.
    this.listingId = this.#kind.isListed ? randomUUID() : null;
    this.chat = new ChatRoom({ onMessageRemoved });
    this.cipher = new RoomCipher();
    this.names = new NameBook();
    this.bans = new RoomBanList();
    this.createdAt = now();
    this.#createInviteToken = createToken;
    this.#inviteToken = createToken();
  }

  get profile() {
    return this.#kind.profile;
  }

  get isOpenByInvite() {
    return this.#kind.isOpenByInvite;
  }

  get isListed() {
    return this.#kind.isListed;
  }

  // Cuantas personas caben: lo que permita el tipo de sala, sin pasar del tope del servidor.
  capacityWithin(serverMaxMembers) {
    return Math.min(this.#kind.capacity ?? serverMaxMembers, serverMaxMembers);
  }

  get inviteToken() {
    return this.#inviteToken;
  }

  // Al renovar la invitacion, los enlaces anteriores dejan de servir para entrar.
  rotateInvite() {
    this.#inviteToken = this.#createInviteToken();
    return this.#inviteToken;
  }

  get hasScheduledCleanup() {
    return this.#cancelCleanup !== null;
  }

  scheduleCleanup(schedule, delayMs, onExpire) {
    this.cancelCleanup();
    this.#cancelCleanup = schedule(onExpire, delayMs);
  }

  cancelCleanup() {
    this.#cancelCleanup?.();
    this.#cancelCleanup = null;
  }
}
