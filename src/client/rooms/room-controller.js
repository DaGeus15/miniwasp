import { buildInviteLink } from './invite-link.js';

// Mantiene la invitacion vigente de la sala y la comparte.
export class RoomController {
  #view;
  #signaling;
  #copyText;
  #origin;
  #textFor;
  #inviteToken = null;

  constructor({ view, signaling, copyText, origin, textFor }) {
    this.#view = view;
    this.#signaling = signaling;
    this.#copyText = copyText;
    this.#origin = origin;
    this.#textFor = textFor;
  }

  handleWelcome({ inviteToken, isOwner, visibility, title }) {
    this.#view.showOwnerControls(isOwner);
    this.#view.showRoomKind(visibility, title);
    this.handleInvite({ inviteToken });
  }

  handleInvite({ inviteToken }) {
    this.#inviteToken = inviteToken;
    this.#view.showInvite(inviteToken);
  }

  async copyInvite() {
    if (!this.#inviteToken) {
      return;
    }
    try {
      await this.#copyText(buildInviteLink(this.#origin, this.#inviteToken));
      this.#view.showCopyStatus(this.#textFor('inviteCopied'));
    } catch {
      this.#view.showCopyStatus(this.#textFor('inviteCopyFailed'));
    }
  }

  rotateInvite() {
    this.#signaling.rotateInvite();
  }
}
