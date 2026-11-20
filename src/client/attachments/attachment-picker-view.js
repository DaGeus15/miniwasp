import { formatFileSize } from './attachment-renderer.js';

// Tipos que se pueden elegir. Las fotos PNG o WebP se convierten a JPEG antes de enviarse.
const ACCEPTED_FILES = 'image/jpeg,image/png,image/webp,application/pdf,text/plain';
// En salas estrictas solo lo que la moderacion puede revisar por dentro: fotos y texto.
const REVIEWABLE_FILES = 'image/jpeg,image/png,image/webp,text/plain';

// Boton para adjuntar un archivo y la ficha que muestra el elegido antes de enviarlo.
export class AttachmentPickerView {
  #attachButton;
  #fileInput;
  #chip;
  #chipName;
  #removeButton;

  constructor(document) {
    this.#attachButton = document.querySelector('#attach-file');
    this.#fileInput = document.querySelector('#file-input');
    this.#chip = document.querySelector('#attachment-chip');
    this.#chipName = document.querySelector('#attachment-name');
    this.#removeButton = document.querySelector('#attachment-remove');
    this.#fileInput.accept = ACCEPTED_FILES;
    this.#attachButton.addEventListener('click', () => this.#fileInput.click());
  }

  setReviewableOnly(isReviewableOnly) {
    this.#fileInput.accept = isReviewableOnly ? REVIEWABLE_FILES : ACCEPTED_FILES;
  }

  onSelect(handler) {
    this.#fileInput.addEventListener('change', () => {
      const [file] = this.#fileInput.files;
      this.#fileInput.value = '';
      if (file) {
        handler(file);
      }
    });
  }

  onRemove(handler) {
    this.#removeButton.addEventListener('click', handler);
  }

  showSelected(file) {
    this.#chipName.textContent = `${file.name} · ${formatFileSize(file.size)}`;
    this.#chip.hidden = false;
  }

  clear() {
    this.#chipName.textContent = '';
    this.#chip.hidden = true;
  }

  setBusy(isBusy) {
    this.#attachButton.disabled = isBusy;
    this.#chip.classList.toggle('attachment-chip-busy', isBusy);
  }
}
