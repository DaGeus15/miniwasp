const MEDIA_CONSTRAINTS = {
  audio: true,
  video: { width: { ideal: 1280 }, height: { ideal: 720 } },
};

const MEDIA_ERROR_KEYS = new Map([
  ['NotAllowedError', 'mediaDenied'],
  ['NotFoundError', 'mediaMissing'],
  ['NotReadableError', 'mediaInUse'],
]);

export function mediaErrorKey(error) {
  return MEDIA_ERROR_KEYS.get(error?.name) ?? 'mediaUnavailable';
}

function stopTracks(stream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function toggleTracks(tracks) {
  for (const track of tracks) {
    track.enabled = !track.enabled;
  }
  return tracks.some((track) => track.enabled);
}

// Camara y microfono de una sola llamada. Garantiza que la camara se apague aunque
// la llamada termine mientras el navegador sigue pidiendo el permiso.
export class LocalMedia {
  #getUserMedia;
  #stream = null;
  #isReleased = false;

  constructor(getUserMedia) {
    this.#getUserMedia = getUserMedia;
  }

  get stream() {
    return this.#stream;
  }

  async acquire() {
    const stream = await this.#getUserMedia(MEDIA_CONSTRAINTS);
    if (this.#isReleased) {
      stopTracks(stream);
      return null;
    }
    this.#stream = stream;
    return stream;
  }

  release() {
    this.#isReleased = true;
    if (this.#stream) {
      stopTracks(this.#stream);
      this.#stream = null;
    }
  }

  toggleMicrophone() {
    return toggleTracks(this.#stream.getAudioTracks());
  }

  toggleCamera() {
    return toggleTracks(this.#stream.getVideoTracks());
  }
}
