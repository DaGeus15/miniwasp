const SECONDS_PER_MINUTE = 60;

export function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// Boton del microfono y el indicador de grabacion (punto rojo, tiempo y cancelar).
export class VoiceRecorderView {
  #recordButton;
  #status;
  #timer;
  #cancelButton;
  #labels;

  constructor(document, labels) {
    this.#recordButton = document.querySelector('#record-voice');
    this.#status = document.querySelector('#voice-status');
    this.#timer = document.querySelector('#voice-timer');
    this.#cancelButton = document.querySelector('#voice-cancel');
    this.#labels = labels;
    this.#recordButton.setAttribute('aria-label', labels.start);
  }

  onToggle(handler) {
    this.#recordButton.addEventListener('click', handler);
  }

  onCancel(handler) {
    this.#cancelButton.addEventListener('click', handler);
  }

  showRecording(elapsedSeconds) {
    this.#timer.textContent = formatDuration(elapsedSeconds);
    this.#status.hidden = false;
    this.#recordButton.setAttribute('aria-pressed', 'true');
    this.#recordButton.setAttribute('aria-label', this.#labels.stop);
  }

  showIdle() {
    this.#status.hidden = true;
    this.#recordButton.setAttribute('aria-pressed', 'false');
    this.#recordButton.setAttribute('aria-label', this.#labels.start);
  }

  setBusy(isBusy) {
    this.#recordButton.disabled = isBusy;
  }
}
