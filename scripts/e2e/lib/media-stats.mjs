// Resume RTCPeerConnection.getStats() en las metricas que pide la auditoria.
import { setTimeout as delay } from 'node:timers/promises';

const BITS_PER_BYTE = 8;
const MS_PER_SECOND = 1000;

function rate(first, last, read, elapsedMs) {
  if (!first || !last || elapsedMs <= 0) {
    return null;
  }
  const start = read(first);
  const end = read(last);
  return start === undefined || end === undefined ? null : ((end - start) * MS_PER_SECOND) / elapsedMs;
}

function round(value, digits = 2) {
  return value === null || value === undefined ? null : Number(value.toFixed(digits));
}

const readBytes = (entry) => entry.bytesReceived;
const readFrames = (entry) => entry.framesDecoded;
const readPackets = (entry) => entry.packetsReceived;

function toKbps(bytesPerSecond) {
  return bytesPerSecond === null ? null : round((bytesPerSecond * BITS_PER_BYTE) / MS_PER_SECOND);
}

function deriveRates(first, last) {
  const elapsedMs = last.takenAt - first.takenAt;
  const { video: firstVideo, audio: firstAudio } = first.inbound;
  const { video: lastVideo, audio: lastAudio } = last.inbound;
  return {
    windowMs: round(elapsedMs, 0),
    inboundVideoKbps: toKbps(rate(firstVideo, lastVideo, readBytes, elapsedMs)),
    inboundAudioKbps: toKbps(rate(firstAudio, lastAudio, readBytes, elapsedMs)),
    decodedFramesPerSecond: round(rate(firstVideo, lastVideo, readFrames, elapsedMs)),
    audioPacketsPerSecond: round(rate(firstAudio, lastAudio, readPackets, elapsedMs)),
  };
}

// Toma dos muestras separadas por windowMs para calcular tasas ademas de los totales.
export async function sampleStats(person, windowMs) {
  const first = await person.probe('collectStats');
  await delay(windowMs);
  const last = await person.probe('collectStats');
  return { first, last, rates: first && last ? deriveRates(first, last) : null };
}

function totalOf(groups, read) {
  return Object.values(groups ?? {}).reduce((total, entry) => total + (read(entry) ?? 0), 0);
}

function frameSize(video) {
  return video.frameWidth ? `${video.frameWidth}x${video.frameHeight}` : null;
}

// Los campos que getStats() no reporto quedan en null en vez de undefined.
function nullifyMissing(summary) {
  return Object.fromEntries(Object.entries(summary).map(([name, value]) => [name, value ?? null]));
}

function inboundSummary(audio, video) {
  return {
    audioJitterMs: round(audio.jitterMs, 3),
    videoJitterMs: round(video.jitterMs, 3),
    audioPacketsLost: audio.packetsLost,
    videoPacketsLost: video.packetsLost,
    audioPacketsReceived: audio.packetsReceived,
    videoPacketsReceived: video.packetsReceived,
    videoFramesDecoded: video.framesDecoded,
    videoFrameSize: frameSize(video),
  };
}

export function summarizeStats({ last, rates }) {
  const snapshot = last ?? { inbound: {}, outbound: {}, pair: null, connectionState: null };
  return nullifyMissing({
    connectionState: snapshot.connectionState,
    selectedPair: snapshot.pair,
    currentRoundTripTimeMs: round(snapshot.pair?.currentRoundTripTimeMs, 3),
    ...inboundSummary(snapshot.inbound.audio ?? {}, snapshot.inbound.video ?? {}),
    bytesReceived: totalOf(snapshot.inbound, readBytes),
    bytesSent: totalOf(snapshot.outbound, (entry) => entry.bytesSent),
    ...rates,
  });
}
