import { MAX_ATTACHMENT_BYTES } from '../../shared/attachments.js';
import { VoiceRecordingUnsupportedError } from './voice-recorder.js';

const ONE_SECOND_MS = 1000;
// Las fotos se reducen antes de enviarse, asi que se acepta elegir originales mas grandes.
const MAX_ORIGINAL_IMAGE_BYTES = 30 * 1024 * 1024;

function isImage(file) {
  return file.type.startsWith('image/');
}

// Adjuntos de la redaccion: el archivo elegido (se sube al enviar el mensaje) y las notas de
// voz (se suben y se envian al terminar de grabar, como en las apps de mensajeria).
export class AttachmentComposer {
  #client;
  #preparer;
  #recorder;
  #picker;
  #voiceView;
  #notices;
  #schedule;
  #onVoiceNote;
  #pendingFile = null;
  #recordingGeneration = 0;

  constructor({ client, preparer, recorder, picker, voiceView, notices, schedule, onVoiceNote }) {
    this.#client = client;
    this.#preparer = preparer;
    this.#recorder = recorder;
    this.#picker = picker;
    this.#voiceView = voiceView;
    this.#notices = notices;
    this.#schedule = schedule;
    this.#onVoiceNote = onVoiceNote;
    picker.onSelect((file) => this.#select(file));
    picker.onRemove(() => this.#clearPending());
    voiceView.onCancel(() => this.#cancelRecording());
  }

  get hasPending() {
    return this.#pendingFile !== null;
  }

  get isRecording() {
    return this.#recorder.isRecording;
  }

  restrictToReviewable(isReviewableOnly) {
    this.#picker.setReviewableOnly(isReviewableOnly);
  }

  // Sube el archivo elegido. Devuelve el adjunto, o null si fallo (ya se aviso a la persona).
  async uploadPending() {
    this.#picker.setBusy(true);
    try {
      const prepared = await this.#prepare(this.#pendingFile);
      const attachment = prepared ? await this.#upload(prepared) : null;
      if (attachment) {
        this.#clearPending();
      }
      return attachment;
    } finally {
      this.#picker.setBusy(false);
    }
  }

  async toggleRecording() {
    if (this.#recorder.isRecording) {
      await this.#finishRecording();
      return;
    }
    try {
      await this.#recorder.start({ onLimit: () => this.#finishRecording() });
      this.#recordingGeneration += 1;
      this.#tick(this.#recordingGeneration, 0);
    } catch (error) {
      this.#notices.show(error instanceof VoiceRecordingUnsupportedError ? 'voiceUnsupported' : 'voiceDenied');
    }
  }

  #select(file) {
    const maxBytes = isImage(file) ? MAX_ORIGINAL_IMAGE_BYTES : MAX_ATTACHMENT_BYTES;
    if (file.size > maxBytes) {
      this.#notices.show('attachmentTooLarge');
      return;
    }
    this.#notices.clear();
    this.#pendingFile = file;
    this.#picker.showSelected(file);
  }

  #clearPending() {
    this.#pendingFile = null;
    this.#picker.clear();
  }

  async #prepare(file) {
    if (!isImage(file)) {
      return { blob: file, fileName: file.name };
    }
    try {
      return await this.#preparer.prepare(file);
    } catch {
      this.#notices.show('imageUnreadable');
      return null;
    }
  }

  async #upload({ blob, fileName }) {
    const { attachment, error } = await this.#client.upload(blob, fileName);
    if (!attachment) {
      this.#notices.showText(error);
    }
    return attachment ?? null;
  }

  // El contador se detiene solo cuando termina esa grabacion: cada una tiene su generacion.
  #tick(generation, elapsedSeconds) {
    if (generation !== this.#recordingGeneration || !this.#recorder.isRecording) {
      return;
    }
    this.#voiceView.showRecording(elapsedSeconds);
    this.#schedule(() => this.#tick(generation, elapsedSeconds + 1), ONE_SECOND_MS);
  }

  // Puede llamarse dos veces (la persona la detiene justo al llegar al limite): solo cuenta una.
  async #finishRecording() {
    if (!this.#recorder.isRecording) {
      return;
    }
    this.#voiceView.showIdle();
    this.#voiceView.setBusy(true);
    try {
      const attachment = await this.#upload(await this.#recorder.stop());
      if (attachment) {
        this.#onVoiceNote(attachment);
      }
    } finally {
      this.#voiceView.setBusy(false);
    }
  }

  #cancelRecording() {
    this.#recorder.cancel();
    this.#voiceView.showIdle();
  }
}
