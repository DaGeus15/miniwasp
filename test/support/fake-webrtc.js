export class FakeTrack {
  enabled = true;
  isStopped = false;

  constructor(kind) {
    this.kind = kind;
  }

  stop() {
    this.isStopped = true;
  }
}

export class FakeStream {
  #tracks = [new FakeTrack('audio'), new FakeTrack('video')];

  getTracks() {
    return this.#tracks;
  }

  getAudioTracks() {
    return this.#tracks.filter((track) => track.kind === 'audio');
  }

  getVideoTracks() {
    return this.#tracks.filter((track) => track.kind === 'video');
  }
}

export class FakePeerConnection extends EventTarget {
  connectionState = 'new';
  addedTracks = [];
  localDescription = null;
  remoteDescription = null;
  candidates = [];
  isClosed = false;

  constructor(configuration) {
    super();
    this.configuration = configuration;
  }

  addTrack(track, stream) {
    this.addedTracks.push({ track, stream });
  }

  async createOffer() {
    return { type: 'offer', sdp: 'sdp-oferta' };
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'sdp-respuesta' };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
  }

  async addIceCandidate(candidate) {
    this.candidates.push(candidate);
  }

  getConfiguration() {
    return this.configuration;
  }

  setConfiguration(configuration) {
    if (this.rejectsConfiguration) {
      throw new TypeError('configuracion no valida');
    }
    this.configuration = configuration;
  }

  close() {
    this.isClosed = true;
  }

  simulateCandidate(candidate) {
    this.dispatchEvent(Object.assign(new Event('icecandidate'), { candidate }));
  }

  simulateTrack(stream) {
    this.dispatchEvent(Object.assign(new Event('track'), { streams: [stream] }));
  }

  simulateState(state) {
    this.connectionState = state;
    this.dispatchEvent(new Event('connectionstatechange'));
  }
}
