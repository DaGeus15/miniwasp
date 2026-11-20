import { createTextElement } from '../common/dom.js';
import { TEXTS } from '../common/texts.js';

export class PresenceView {
  #document;
  #list;
  #emptyLabel;
  #handleCallRequest = () => {};
  #handleExpelRequest = () => {};
  #handleWhisperRequest = () => {};

  constructor(document) {
    this.#document = document;
    this.#list = document.querySelector('#people-list');
    this.#emptyLabel = document.querySelector('#people-empty');
  }

  onCallRequest(handler) {
    this.#handleCallRequest = handler;
  }

  onExpelRequest(handler) {
    this.#handleExpelRequest = handler;
  }

  onWhisperRequest(handler) {
    this.#handleWhisperRequest = handler;
  }

  // canWhisper: en las salas publicas se puede invitar a alguien a una sala privada de dos.
  render(peers, { canExpel = false, canWhisper = false } = {}) {
    this.#list.replaceChildren(...peers.map((peer) => this.#createItem(peer, { canExpel, canWhisper })));
    this.#emptyLabel.hidden = peers.length > 0;
  }

  #createItem(peer, { canExpel, canWhisper }) {
    const item = this.#document.createElement('li');
    item.className = 'person';
    item.append(createTextElement(this.#document, 'span', 'person-name', peer.name));
    if (peer.isOwner) {
      item.append(createTextElement(this.#document, 'span', 'person-badge', TEXTS.ownerBadge));
    }
    item.append(
      this.#createButton('person-call', TEXTS.callAction, TEXTS.callActionLabel(peer.name), () =>
        this.#handleCallRequest(peer),
      ),
    );
    if (canWhisper) {
      item.append(
        this.#createButton('person-whisper', TEXTS.whisperAction, TEXTS.whisperActionLabel(peer.name), () =>
          this.#handleWhisperRequest(peer),
        ),
      );
    }
    if (canExpel) {
      item.append(
        this.#createButton('person-expel', TEXTS.expelAction, TEXTS.expelActionLabel(peer.name), () =>
          this.#handleExpelRequest(peer),
        ),
      );
    }
    return item;
  }

  #createButton(className, text, label, onClick) {
    const button = createTextElement(this.#document, 'button', className, text);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', onClick);
    return button;
  }
}
