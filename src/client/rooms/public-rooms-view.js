import { MAX_ROOM_TITLE_LENGTH } from '../../shared/limits.js';
import { createTextElement } from '../common/dom.js';

// Apartado "Salas publicas" de la portada: la lista para entrar y el formulario para crear una.
export class PublicRoomsView {
  #document;
  #list;
  #emptyLabel;
  #refreshButton;
  #form;
  #titleInput;
  #labels;
  #handleJoin = () => {};

  constructor(document, labels) {
    this.#document = document;
    this.#list = document.querySelector('#public-room-list');
    this.#emptyLabel = document.querySelector('#public-rooms-empty');
    this.#refreshButton = document.querySelector('#refresh-public-rooms');
    this.#form = document.querySelector('#public-room-form');
    this.#titleInput = document.querySelector('#public-room-title');
    this.#labels = labels;
    this.#titleInput.maxLength = MAX_ROOM_TITLE_LENGTH;
  }

  onRefresh(handler) {
    this.#refreshButton.addEventListener('click', handler);
  }

  onJoin(handler) {
    this.#handleJoin = handler;
  }

  onCreate(handler) {
    this.#form.addEventListener('submit', (event) => {
      event.preventDefault();
      handler(this.#titleInput.value);
    });
  }

  // null significa que no se pudo cargar la lista.
  render(rooms) {
    this.#list.replaceChildren(...(rooms ?? []).map((room) => this.#createItem(room)));
    this.#emptyLabel.textContent = rooms ? this.#labels.empty : this.#labels.unavailable;
    this.#emptyLabel.hidden = Boolean(rooms?.length);
  }

  clearTitle() {
    this.#titleInput.value = '';
  }

  #createItem(room) {
    const item = this.#document.createElement('li');
    item.className = 'public-room';
    item.append(
      createTextElement(this.#document, 'span', 'public-room-title', room.title),
      createTextElement(this.#document, 'span', 'public-room-members', this.#labels.members(room.members, room.capacity)),
    );
    const button = createTextElement(this.#document, 'button', 'public-room-join button button-secondary', this.#labels.join);
    button.type = 'button';
    button.setAttribute('aria-label', this.#labels.joinLabel(room.title));
    button.disabled = room.members >= room.capacity;
    button.addEventListener('click', () => this.#handleJoin(room.listingId));
    item.append(button);
    return item;
  }
}
