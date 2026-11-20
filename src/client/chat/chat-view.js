import { MAX_NAME_LENGTH, MAX_TEXT_LENGTH } from '../../shared/limits.js';
import { createTextElement } from '../common/dom.js';

// Acciones de cada mensaje. Que se vean depende del CSS: "Borrar" en los mensajes propios (o en
// todos, para quien creo la sala) y "Reportar" en los de otras personas. El servidor decide.
export const MessageAction = Object.freeze({ DELETE: 'delete', REPORT: 'report' });

function formatTime(isoDate) {
  return new Date(isoDate).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

// Pantalla del chat: mensajes, estado, errores y el formulario para escribir.
export class ChatView {
  #document;
  #attachmentRenderer;
  #actionLabels;
  #messagesList;
  #statusLabel;
  #errorLabel;
  #composer;
  #nameInput;
  #textInput;
  #logoutButton;
  #chat;

  constructor(document, { attachmentRenderer, actionLabels }) {
    this.#document = document;
    this.#attachmentRenderer = attachmentRenderer;
    this.#actionLabels = actionLabels;
    this.#messagesList = document.querySelector('#messages');
    this.#statusLabel = document.querySelector('#status');
    this.#errorLabel = document.querySelector('#error');
    this.#composer = document.querySelector('#composer');
    this.#nameInput = document.querySelector('#name');
    this.#textInput = document.querySelector('#text');
    this.#logoutButton = document.querySelector('#logout');
    this.#chat = document.querySelector('#chat');

    this.#nameInput.maxLength = MAX_NAME_LENGTH;
    this.#textInput.maxLength = MAX_TEXT_LENGTH;
  }

  addMessage(message) {
    const item = this.#document.createElement('li');
    item.className = 'message';
    item.dataset.messageId = message.id;
    if (message.name === this.#nameInput.value.trim()) {
      item.classList.add('message-own');
    }
    item.append(createTextElement(this.#document, 'strong', 'message-name', message.name));
    if (message.attachment) {
      item.append(this.#attachmentRenderer.render(message));
    }
    if (message.text) {
      item.append(createTextElement(this.#document, 'p', 'message-text', message.text));
    }
    item.append(createTextElement(this.#document, 'time', 'message-time', formatTime(message.time)), this.#actions());
    this.#messagesList.append(item);
    this.#messagesList.scrollTop = this.#messagesList.scrollHeight;
  }

  removeMessage(messageId) {
    this.#findMessage(messageId)?.remove();
  }

  markReported(messageId, reports) {
    const item = this.#findMessage(messageId);
    if (item) {
      item.classList.add('message-reported');
      item.dataset.reports = String(reports);
    }
  }

  // Quien creo la sala puede borrar cualquier mensaje.
  setOwner(isOwner) {
    this.#messagesList.classList.toggle('messages-owner', isOwner);
  }

  // El tipo de sala cambia lo que se ofrece (en las publicas no hay notas de voz).
  setRoomKind(visibility) {
    this.#chat.dataset.visibility = visibility;
  }

  onMessageAction(handler) {
    this.#messagesList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      const item = button?.closest('[data-message-id]');
      if (item) {
        handler(button.dataset.action, item.dataset.messageId);
      }
    });
  }

  showHistory(messages) {
    this.#messagesList.replaceChildren();
    messages.forEach((message) => this.addMessage(message));
  }

  showStatus(text) {
    this.#statusLabel.textContent = text;
  }

  showError(text) {
    this.#errorLabel.textContent = text;
    this.#errorLabel.hidden = false;
  }

  clearError() {
    this.#errorLabel.hidden = true;
  }

  getName() {
    return this.#nameInput.value;
  }

  setName(name) {
    this.#nameInput.value = name;
  }

  clearText() {
    this.#textInput.value = '';
    this.#textInput.focus();
  }

  onSubmit(handler) {
    this.#composer.addEventListener('submit', (event) => {
      event.preventDefault();
      this.clearError();
      handler({ name: this.#nameInput.value, text: this.#textInput.value });
    });
  }

  onNameChange(handler) {
    this.#nameInput.addEventListener('change', handler);
  }

  onLogout(handler) {
    this.#logoutButton.addEventListener('click', handler);
  }

  #actions() {
    const actions = this.#document.createElement('div');
    actions.className = 'message-actions';
    for (const action of Object.values(MessageAction)) {
      const button = createTextElement(this.#document, 'button', `message-action message-${action}`, this.#actionLabels.get(action));
      button.type = 'button';
      button.dataset.action = action;
      actions.append(button);
    }
    return actions;
  }

  #findMessage(messageId) {
    return [...this.#messagesList.children].find((item) => item.dataset.messageId === messageId);
  }
}
