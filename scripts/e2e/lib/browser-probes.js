// Sondas que la prueba E2E inyecta en cada pagina antes de que cargue la app.
// Solo observan: guardan referencias a RTCPeerConnection, a los streams de la camara,
// a los eventos del WebSocket (sin SDP ni candidatos) y a los cambios visibles de la UI.
// Se carga como script clasico con page.addInitScript({ path }).
/* global window, document, MutationObserver */
'use strict';

const e2eState = {
  peerConnections: [],
  mediaStreams: [],
  mediaRequests: [],
  sentEvents: [],
  receivedEvents: [],
  uiLog: [],
  clicks: [],
  sockets: [],
  socketCloses: [],
};

const E2E_WATCHED_IDS = ['call-status', 'status', 'error', 'home-error', 'invite-code', 'home', 'chat', 'call'];

// Reloj de pared (ms): es el mismo en todos los procesos de Chrome y en Node, asi que
// permite comparar marcas tomadas en navegadores distintos.
function e2eNow() {
  return Date.now();
}

function e2eDescribeEvent(data) {
  try {
    const event = JSON.parse(data);
    return {
      type: event.type ?? 'untyped',
      kind: event.signal?.kind,
      sdpLength: event.signal?.sdp?.length,
      callId: event.callId,
      reason: event.reason,
    };
  } catch {
    return { type: 'unparsable' };
  }
}

function e2eRecordEvent(list, data) {
  list.push({ ...e2eDescribeEvent(data), t: e2eNow() });
}

function e2eWrapPeerConnection() {
  const NativePeerConnection = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeerConnection {
    constructor(...args) {
      super(...args);
      e2eState.peerConnections.push(this);
    }
  };
}

function e2eWrapGetUserMedia() {
  const devices = navigator.mediaDevices;
  if (!devices) {
    return;
  }
  const original = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints) => {
    try {
      const stream = await original(constraints);
      e2eState.mediaStreams.push(stream);
      e2eState.mediaRequests.push({ ok: true, t: e2eNow() });
      return stream;
    } catch (error) {
      e2eState.mediaRequests.push({ ok: false, errorName: error.name, t: e2eNow() });
      throw error;
    }
  };
}

function e2eWrapWebSocket() {
  const NativeWebSocket = window.WebSocket;
  const nativeSend = NativeWebSocket.prototype.send;
  NativeWebSocket.prototype.send = function send(data) {
    e2eRecordEvent(e2eState.sentEvents, data);
    return nativeSend.call(this, data);
  };
  window.WebSocket = class extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      e2eState.sockets.push(this);
      this.addEventListener('message', (event) => e2eRecordEvent(e2eState.receivedEvents, event.data));
      this.addEventListener('close', (event) => e2eState.socketCloses.push({ code: event.code, t: e2eNow() }));
    }
  };
}

const E2E_CONTAINER_IDS = new Set(['home', 'chat', 'call']);

// De los contenedores solo interesa si se ven; de los textos, lo que dicen.
function e2eRecordElement(element) {
  const isContainer = E2E_CONTAINER_IDS.has(element.id);
  e2eState.uiLog.push({
    id: element.id,
    text: isContainer ? '' : element.textContent.trim().slice(0, 120),
    hidden: element.hidden,
    t: e2eNow(),
  });
}

function e2eWatchElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }
  const isContainer = E2E_CONTAINER_IDS.has(id);
  new MutationObserver(() => e2eRecordElement(element)).observe(element, {
    attributes: true,
    attributeFilter: ['hidden'],
    characterData: !isContainer,
    childList: !isContainer,
    subtree: !isContainer,
  });
}

function e2eWatchClicks() {
  window.addEventListener(
    'click',
    (event) => {
      const target = event.target.closest('button') ?? event.target;
      e2eState.clicks.push({ id: target.id, className: target.className, t: e2eNow() });
    },
    true,
  );
}

// --- Lecturas que la prueba pide con page.evaluate ---

function e2eReadVideo(selector) {
  const video = document.querySelector(selector);
  const quality = video.getVideoPlaybackQuality();
  return {
    width: video.videoWidth,
    height: video.videoHeight,
    currentTime: video.currentTime,
    readyState: video.readyState,
    hasStream: video.srcObject !== null,
    totalVideoFrames: quality.totalVideoFrames,
  };
}

function e2eDescribeTrack(track) {
  return { kind: track.kind, enabled: track.enabled, readyState: track.readyState };
}

function e2eReadMediaTracks() {
  return e2eState.mediaStreams.flatMap((stream) => stream.getTracks().map(e2eDescribeTrack));
}

function e2eReadSenderTracks() {
  const connection = e2eState.peerConnections.at(-1);
  if (!connection) {
    return [];
  }
  return connection
    .getSenders()
    .filter((sender) => sender.track)
    .map((sender) => e2eDescribeTrack(sender.track));
}

function e2eReadPeerStates() {
  return e2eState.peerConnections.map((connection) => connection.connectionState);
}

function e2eSelectedPair(stats) {
  const transport = [...stats.values()].find((entry) => entry.type === 'transport');
  const selected = transport && stats.get(transport.selectedCandidatePairId);
  return (
    selected ??
    [...stats.values()].find((entry) => entry.type === 'candidate-pair' && entry.nominated && entry.state === 'succeeded')
  );
}

function e2eDescribeCandidate(candidate) {
  return candidate ? { candidateType: candidate.candidateType, protocol: candidate.protocol } : null;
}

function e2eDescribePair(stats) {
  const pair = e2eSelectedPair(stats);
  if (!pair) {
    return null;
  }
  return {
    state: pair.state,
    currentRoundTripTimeMs: pair.currentRoundTripTime === undefined ? null : pair.currentRoundTripTime * 1000,
    totalRoundTripTimeMs: pair.totalRoundTripTime === undefined ? null : pair.totalRoundTripTime * 1000,
    responsesReceived: pair.responsesReceived,
    local: e2eDescribeCandidate(stats.get(pair.localCandidateId)),
    remote: e2eDescribeCandidate(stats.get(pair.remoteCandidateId)),
  };
}

function e2eDescribeInbound(entry) {
  return {
    jitterMs: entry.jitter === undefined ? null : entry.jitter * 1000,
    packetsLost: entry.packetsLost,
    packetsReceived: entry.packetsReceived,
    bytesReceived: entry.bytesReceived,
    framesDecoded: entry.framesDecoded,
    framesPerSecond: entry.framesPerSecond,
    frameWidth: entry.frameWidth,
    frameHeight: entry.frameHeight,
  };
}

function e2eDescribeOutbound(entry) {
  return {
    packetsSent: entry.packetsSent,
    bytesSent: entry.bytesSent,
    framesEncoded: entry.framesEncoded,
    framesPerSecond: entry.framesPerSecond,
  };
}

function e2eGroupRtp(stats, type, describe) {
  const groups = {};
  for (const entry of stats.values()) {
    if (entry.type === type) {
      groups[entry.kind] = describe(entry);
    }
  }
  return groups;
}

async function e2eCollectStats() {
  const connection = e2eState.peerConnections.at(-1);
  if (!connection) {
    return null;
  }
  const stats = await connection.getStats();
  return {
    takenAt: e2eNow(),
    connectionState: connection.connectionState,
    pair: e2eDescribePair(stats),
    inbound: e2eGroupRtp(stats, 'inbound-rtp', e2eDescribeInbound),
    outbound: e2eGroupRtp(stats, 'outbound-rtp', e2eDescribeOutbound),
  };
}

// Programa un clic a una hora exacta: sirve para que dos navegadores hagan clic a la vez.
// El temporizador despierta un poco antes y la espera activa final da precision de 1 ms.
const E2E_SPIN_LEAD_MS = 40;

function e2eClickAt(selector, epochMs) {
  return new Promise((resolve) => {
    setTimeout(() => {
      while (e2eNow() < epochMs) {
        // espera activa intencional
      }
      const clickedAt = e2eNow();
      document.querySelector(selector).click();
      resolve(clickedAt);
    }, Math.max(0, epochMs - E2E_SPIN_LEAD_MS - Date.now()));
  });
}

window.__e2e = e2eState;
// Simula un cliente manipulado: envia un mensaje propio por el WebSocket abierto de la app.
function e2eSendRaw(payload) {
  const socket = e2eState.sockets.findLast((candidate) => candidate.readyState === window.WebSocket.OPEN);
  if (!socket) {
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

// Map en vez de objeto: la prueba elige la lectura por nombre sin indexar propiedades.
window.__e2eApi = new Map([
  ['readVideo', e2eReadVideo],
  ['readMediaTracks', e2eReadMediaTracks],
  ['readSenderTracks', e2eReadSenderTracks],
  ['readPeerStates', e2eReadPeerStates],
  ['readUiLog', () => e2eState.uiLog],
  ['readSocketCloses', () => e2eState.socketCloses],
  ['sendRaw', e2eSendRaw],
  ['collectStats', e2eCollectStats],
  ['clickAt', e2eClickAt],
]);
e2eWrapPeerConnection();
e2eWrapGetUserMedia();
e2eWrapWebSocket();
e2eWatchClicks();
document.addEventListener('DOMContentLoaded', () => E2E_WATCHED_IDS.forEach(e2eWatchElement));
