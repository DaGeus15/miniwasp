// Aviso de susurro entrante (aceptar o rechazar) y la casilla para no recibir susurros.
export class WhisperView {
  #dialog;
  #fromLabel;
  #acceptButton;
  #rejectButton;
  #preference;
  #preferenceField;
  #labels;

  constructor(document, labels) {
    this.#dialog = document.querySelector('#whisper-dialog');
    this.#fromLabel = document.querySelector('#whisper-from');
    this.#acceptButton = document.querySelector('#whisper-accept');
    this.#rejectButton = document.querySelector('#whisper-reject');
    this.#preference = document.querySelector('#accept-whispers');
    this.#preferenceField = document.querySelector('#whisper-preference');
    this.#labels = labels;
  }

  onAccept(handler) {
    this.#acceptButton.addEventListener('click', handler);
  }

  onReject(handler) {
    this.#rejectButton.addEventListener('click', handler);
  }

  onPreferenceChange(handler) {
    this.#preference.addEventListener('change', () => handler(this.#preference.checked));
  }

  // textContent: el nombre lo eligio otra persona y nunca se interpreta como HTML.
  showIncoming(name) {
    this.#fromLabel.textContent = this.#labels.incoming(name);
    this.#dialog.hidden = false;
    this.#acceptButton.focus();
  }

  hideIncoming() {
    this.#dialog.hidden = true;
    this.#fromLabel.textContent = '';
  }

  showPreference({ isAvailable, acceptsWhispers }) {
    this.#preferenceField.hidden = !isAvailable;
    this.#preference.checked = acceptsWhispers;
  }
}
