import { MAX_VOICE_NOTE_MS } from '../../shared/attachments.js';

// Formatos de grabacion en orden de preferencia: Chrome y Firefox graban Opus en WebM u Ogg;
// Safari graba AAC en MP4. El servidor acepta los tres (los reconoce por su contenido).
const VOICE_FORMATS = Object.freeze([
  { recorderType: 'audio/webm;codecs=opus', extension: 'webm' },
  { recorderType: 'audio/ogg;codecs=opus', extension: 'ogg' },
  { recorderType: 'audio/mp4', extension: 'm4a' },
]);
// Calidad de voz suficiente y liviana: dos minutos ocupan menos de 0,5 MB.
const AUDIO_BITS_PER_SECOND = 32000;

export class VoiceRecordingUnsupportedError extends Error {
  name = 'VoiceRecordingUnsupportedError';
}

// Graba una nota de voz de hasta dos minutos. El microfono se apaga al terminar o cancelar.
export class VoiceRecorder {
  #getUserMedia;
  #createMediaRecorder;
  #isTypeSupported;
  #schedule;
  #session = null;

  constructor({ getUserMedia, createMediaRecorder, isTypeSupported, schedule }) {
    this.#getUserMedia = getUserMedia;
    this.#createMediaRecorder = createMediaRecorder;
    this.#isTypeSupported = isTypeSupported;
    this.#schedule = schedule;
  }

  get isRecording() {
    return this.#session !== null;
  }

  // onLimit se llama si la grabacion llega a su duracion maxima sin que nadie la detenga.
  async start({ onLimit = () => {} } = {}) {
    const format = VOICE_FORMATS.find(({ recorderType }) => this.#isTypeSupported(recorderType));
    if (!format) {
      throw new VoiceRecordingUnsupportedError('Este navegador no puede grabar notas de voz');
    }
    const stream = await this.#getUserMedia({ audio: true, video: false });
    const recorder = this.#createMediaRecorder(stream, {
      mimeType: format.recorderType,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    const session = { stream, recorder, format, chunks: [] };
    recorder.addEventListener('dataavailable', (event) => session.chunks.push(event.data));
    recorder.start();
    this.#session = session;
    this.#schedule(() => this.#session === session && onLimit(), MAX_VOICE_NOTE_MS);
  }

  // Termina y entrega { blob, fileName }.
  stop() {
    const session = this.#finish();
    return new Promise((resolve) => {
      session.recorder.addEventListener('stop', () => {
        const blob = new Blob(session.chunks, { type: session.format.recorderType.split(';')[0] });
        resolve({ blob, fileName: `nota-de-voz.${session.format.extension}` });
      });
      session.recorder.stop();
    });
  }

  cancel() {
    if (this.#session) {
      this.#finish().recorder.stop();
    }
  }

  #finish() {
    const session = this.#session;
    this.#session = null;
    session.stream.getTracks().forEach((track) => track.stop());
    return session;
  }
}
