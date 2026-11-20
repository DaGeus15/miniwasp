// Pantalla de inicio: crear una sala o unirse con una invitacion, tras aceptar las normas.
export class HomeView {
  #home;
  #chat;
  #createButton;
  #joinForm;
  #inviteInput;
  #errorLabel;
  #rulesCheckbox;

  constructor(document) {
    this.#home = document.querySelector('#home');
    this.#chat = document.querySelector('#chat');
    this.#createButton = document.querySelector('#create-room');
    this.#joinForm = document.querySelector('#join-form');
    this.#inviteInput = document.querySelector('#invite-token');
    this.#errorLabel = document.querySelector('#home-error');
    this.#rulesCheckbox = document.querySelector('#accept-rules');
  }

  hasAcceptedRules() {
    return this.#rulesCheckbox.checked;
  }

  setRulesAccepted(isAccepted) {
    this.#rulesCheckbox.checked = isAccepted;
  }

  onRulesChange(handler) {
    this.#rulesCheckbox.addEventListener('change', () => handler(this.#rulesCheckbox.checked));
  }

  // Un enlace de invitacion abierto sin haber aceptado las normas deja el ID listo para entrar.
  prefillInvite(inviteToken) {
    this.#inviteInput.value = inviteToken;
    this.#rulesCheckbox.focus();
  }

  onCreate(handler) {
    this.#createButton.addEventListener('click', () => {
      this.#clearError();
      handler();
    });
  }

  onJoin(handler) {
    this.#joinForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#clearError();
      handler(this.#inviteInput.value);
    });
  }

  showHome() {
    this.#home.hidden = false;
    this.#chat.hidden = true;
  }

  showChat() {
    this.#inviteInput.value = '';
    this.#home.hidden = true;
    this.#chat.hidden = false;
  }

  showError(text) {
    this.#errorLabel.textContent = text;
    this.#errorLabel.hidden = false;
  }

  #clearError() {
    this.#errorLabel.hidden = true;
  }
}
