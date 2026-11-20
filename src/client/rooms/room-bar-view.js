// Barra de la sala: muestra la invitacion para compartir y, a quien creo la sala,
// el boton para generar una nueva.
export class RoomBarView {
  #inviteCode;
  #copyButton;
  #rotateButton;
  #copyStatus;
  #roomBar;
  #roomKind;
  #labels;

  constructor(document, labels) {
    this.#roomBar = document.querySelector('.room-bar');
    this.#roomKind = document.querySelector('#room-kind');
    this.#labels = labels;
    this.#inviteCode = document.querySelector('#invite-code');
    this.#copyButton = document.querySelector('#copy-invite');
    this.#rotateButton = document.querySelector('#rotate-invite');
    this.#copyStatus = document.querySelector('#copy-status');
  }

  onCopy(handler) {
    this.#copyButton.addEventListener('click', handler);
  }

  onRotate(handler) {
    this.#rotateButton.addEventListener('click', handler);
  }

  // textContent: el ID llega del servidor y nunca se interpreta como HTML.
  showInvite(inviteToken) {
    this.#inviteCode.textContent = inviteToken;
    this.#copyStatus.textContent = '';
  }

  showOwnerControls(isOwner) {
    this.#rotateButton.hidden = !isOwner;
  }

  // Una sala publica muestra su titulo; un susurro no tiene invitacion que compartir.
  showRoomKind(visibility, title) {
    this.#roomBar.dataset.visibility = visibility;
    this.#roomKind.textContent = this.#labels.roomKind(visibility, title);
  }

  showCopyStatus(text) {
    this.#copyStatus.textContent = text;
  }
}
