import { SignalKind } from '../../shared/events.js';
import { deriveSecurityCode } from './security-code.js';

// Conexion directa entre dos navegadores. Audio y video viajan cifrados por DTLS-SRTP
// y nunca pasan por el servidor, que solo reenvia la negociacion.
export class PeerLink {
  #connection;
  #remoteStream = null;
  #onSignal;
  #onRemoteStream;
  #onConnected;
  #onFailed;
  #isClosed = false;
  // Las senales se procesan en orden: un candidato no puede adelantarse a la descripcion.
  #signalQueue = Promise.resolve();
  #signalHandlers = new Map([
    [SignalKind.OFFER, (signal) => this.#answerOffer(signal)],
    [SignalKind.ANSWER, (signal) => this.#connection.setRemoteDescription(toDescription(signal))],
    [SignalKind.CANDIDATE, ({ candidate }) => this.#connection.addIceCandidate(candidate)],
  ]);

  constructor({
    createPeerConnection,
    iceServers,
    stream,
    onSignal,
    onRemoteStream,
    onConnected,
    onFailed,
  }) {
    this.#onSignal = onSignal;
    this.#onRemoteStream = onRemoteStream;
    this.#onConnected = onConnected;
    this.#onFailed = onFailed;
    this.#connection = createPeerConnection({ iceServers });

    for (const track of stream.getTracks()) {
      this.#connection.addTrack(track, stream);
    }
    this.#listenToConnection();
  }

  startOffer() {
    this.#enqueue(() => this.#publishDescription(SignalKind.OFFER, () => this.#connection.createOffer()));
  }

  receive(signal) {
    this.#enqueue(() => this.#signalHandlers.get(signal.kind)(signal));
  }

  // Credenciales TURN nuevas para la misma llamada, antes de que venzan las anteriores.
  updateIceServers(iceServers) {
    try {
      this.#connection.setConfiguration({ ...this.#connection.getConfiguration(), iceServers });
    } catch {
      // Si el navegador no acepta el cambio, la llamada sigue con las credenciales que tiene.
    }
  }

  close() {
    this.#isClosed = true;
    this.#connection.close();
  }

  // Sin el codigo la llamada sigue cifrada igual; solo se pierde la verificacion manual,
  // por eso un fallo al calcularlo no debe cortar la llamada.
  async securityCode() {
    try {
      return await deriveSecurityCode(
        this.#connection.localDescription?.sdp,
        this.#connection.remoteDescription?.sdp,
      );
    } catch {
      return null;
    }
  }

  #listenToConnection() {
    this.#connection.addEventListener('icecandidate', ({ candidate }) => {
      // Algunos navegadores anuncian el fin de los candidatos con un texto vacio.
      if (candidate?.candidate) {
        this.#onSignal({ kind: SignalKind.CANDIDATE, candidate: candidate.toJSON() });
      }
    });
    this.#connection.addEventListener('track', ({ streams: [stream] }) => {
      // El evento se repite por cada pista; el video solo debe recibir el stream una vez.
      if (stream !== this.#remoteStream) {
        this.#remoteStream = stream;
        this.#onRemoteStream(stream);
      }
    });
    this.#connection.addEventListener('connectionstatechange', () => {
      this.#handleStateChange(this.#connection.connectionState);
    });
  }

  #handleStateChange(state) {
    if (this.#isClosed) {
      return;
    }
    if (state === 'connected') {
      this.#onConnected();
    } else if (state === 'failed') {
      this.#fail();
    }
  }

  async #answerOffer(signal) {
    await this.#connection.setRemoteDescription(toDescription(signal));
    await this.#publishDescription(SignalKind.ANSWER, () => this.#connection.createAnswer());
  }

  async #publishDescription(kind, createDescription) {
    const description = await createDescription();
    await this.#connection.setLocalDescription(description);
    this.#onSignal({ kind, sdp: description.sdp });
  }

  #enqueue(task) {
    this.#signalQueue = this.#signalQueue.then(task).catch(() => this.#fail());
  }

  #fail() {
    if (!this.#isClosed) {
      this.#onFailed();
    }
  }
}

function toDescription({ kind, sdp }) {
  return { type: kind, sdp };
}
