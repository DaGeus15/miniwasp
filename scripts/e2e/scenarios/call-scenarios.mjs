// Escenarios de una videollamada completa: establecerla, silenciar, apagar camara y colgar.
import { setTimeout as delay } from 'node:timers/promises';
import {
  CallText,
  ensureIdle,
  establishCall,
  isFullyReleased,
  measureCallTimeline,
  pageNow,
  readSecurityCode,
  readTrace,
  sampleRemoteVideo,
  waitForMediaReleased,
  waitForRemoteFrames,
} from '../lib/call-steps.mjs';
import { sampleStats, summarizeStats } from '../lib/media-stats.mjs';

const STATS_WINDOW_MS = 5000;
const TOGGLE_SAMPLE_MS = 1500;

async function ensureActiveCall(caller, callee) {
  if ((await caller.textOf('#call-status')) === CallText.ACTIVE && !(await caller.isHidden('#call'))) {
    return;
  }
  await ensureIdle([caller, callee]);
  await establishCall(caller, callee);
  await waitForRemoteFrames(caller);
  await waitForRemoteFrames(callee);
}

function senderTrack(tracks, kind) {
  return tracks.find((track) => track.kind === kind) ?? null;
}

async function audioPacketsReceived(person) {
  const stats = await person.probe('collectStats');
  return stats?.inbound.audio?.packetsReceived ?? 0;
}

export const fullCall = {
  id: 'E2E-03',
  type: 'Happy',
  title: 'Videollamada completa A -> B con medicion',
  steps: [
    'Ana pulsa "Videollamar" junto a Luis',
    'Luis ve "Videollamada entrante" y pulsa "Contestar"',
    'Esperar "En llamada" en ambos lados',
    'Verificar que el video remoto tiene dimensiones y que currentTime y los cuadros avanzan en ambos sentidos',
    'Leer #call-security-code en ambos lados',
    `Tomar getStats() en ambos lados dos veces separadas ${STATS_WINDOW_MS} ms`,
  ],
  expected: 'Ambos llegan a "En llamada", ambos ven el mismo "Código de seguridad: NNN NNN NNN NNN", el video remoto avanza en los dos sentidos y getStats() reporta un par de candidatos seleccionado con RTT, jitter y perdida.',
  allowedConsole: [],
  async run({ ana, luis }, context) {
    await ensureIdle([ana, luis]);
    const since = await pageNow(ana);
    // Sin capturas entre el clic y "En llamada": no deben sumar al tiempo medido.
    await establishCall(ana, luis);
    await Promise.all([waitForRemoteFrames(ana), waitForRemoteFrames(luis)]);
    const [anaVideo, luisVideo] = await Promise.all([sampleRemoteVideo(ana), sampleRemoteVideo(luis)]);
    const timeline = measureCallTimeline(await readTrace(ana), await readTrace(luis), since);
    const securityCodes = await Promise.all([readSecurityCode(ana), readSecurityCode(luis)]);
    const [anaStats, luisStats] = await Promise.all([sampleStats(ana, STATS_WINDOW_MS), sampleStats(luis, STATS_WINDOW_MS)]);
    await context.screenshot(ana, 'en-llamada-ana');
    await context.screenshot(luis, 'en-llamada-luis');
    verifyFullCall({ timeline, securityCodes, anaVideo, luisVideo, anaStats: summarizeStats(anaStats), luisStats: summarizeStats(luisStats) }, context);
  },
};

function verifyFullCall({ timeline, securityCodes, anaVideo, luisVideo, anaStats, luisStats }, context) {
  const [anaCode, luisCode] = securityCodes;
  context.metric('timeline', timeline);
  context.metric('securityCodes', { ana: anaCode.text, luis: luisCode.text });
  context.metric('remoteVideoAna', anaVideo);
  context.metric('remoteVideoLuis', luisVideo);
  context.metric('statsAna', anaStats);
  context.metric('statsLuis', luisStats);
  context.check(timeline.callSetupMs !== null, 'Se midio el tiempo de establecimiento', timeline);
  context.check(anaCode.code !== null && anaCode.code === luisCode.code, 'Ambos ven el mismo codigo de seguridad', securityCodes);
  context.check(anaVideo.isAdvancing, 'El video de Luis avanza en Ana', anaVideo);
  context.check(luisVideo.isAdvancing, 'El video de Ana avanza en Luis', luisVideo);
  context.check(anaStats.selectedPair?.state === 'succeeded', 'Par ICE seleccionado en Ana', anaStats.selectedPair);
  context.check(luisStats.selectedPair?.state === 'succeeded', 'Par ICE seleccionado en Luis', luisStats.selectedPair);
  context.check(anaStats.videoFramesDecoded > 0 && luisStats.videoFramesDecoded > 0, 'Ambos decodifican cuadros de video', [anaStats.videoFramesDecoded, luisStats.videoFramesDecoded]);
  context.note(
    `Codigo de seguridad Ana "${anaCode.code}" / Luis "${luisCode.code}". ` +
      `Establecimiento ${timeline.callSetupMs} ms del clic a "En llamada" (${timeline.callSetupExcludingAnswerDelayMs} ms sin contar la demora en contestar). ` +
      `Video remoto Ana ${anaVideo.after.width}x${anaVideo.after.height}, Luis ${luisVideo.after.width}x${luisVideo.after.height}; ambos avanzan. ` +
      `RTT ${anaStats.currentRoundTripTimeMs}/${luisStats.currentRoundTripTimeMs} ms, jitter video ${anaStats.videoJitterMs}/${luisStats.videoJitterMs} ms, ` +
      `perdidos video ${anaStats.videoPacketsLost}/${luisStats.videoPacketsLost} (Ana/Luis).`,
  );
}

export const microphoneToggle = {
  id: 'E2E-04',
  type: 'Happy',
  title: 'Silenciar y reactivar el microfono durante la llamada',
  steps: [
    'Con la llamada activa, Ana pulsa #call-microphone',
    'Leer la pista de audio del sender de la RTCPeerConnection de Ana',
    'Verificar que Luis sigue recibiendo video',
    'Ana pulsa #call-microphone otra vez',
  ],
  expected: 'Tras el primer clic la pista de audio local tiene enabled=false y el boton dice "Activar micrófono"; el video sigue llegando a Luis; tras el segundo clic enabled=true.',
  allowedConsole: [],
  async run({ ana, luis }, context) {
    await ensureActiveCall(ana, luis);
    await ana.page.click('#call-microphone');
    const mutedAudio = senderTrack(await ana.probe('readSenderTracks'), 'audio');
    const mutedLabel = await ana.textOf('#call-microphone');
    const mutedPressed = await ana.page.getAttribute('#call-microphone', 'aria-pressed');
    const luisVideo = await sampleRemoteVideo(luis);
    await context.screenshot(ana, 'microfono-silenciado');
    await ana.page.click('#call-microphone');
    const restoredAudio = senderTrack(await ana.probe('readSenderTracks'), 'audio');

    context.metric('mutedAudioTrack', mutedAudio);
    context.metric('restoredAudioTrack', restoredAudio);
    context.metric('remoteVideoLuisWhileMuted', luisVideo);
    context.check(mutedAudio?.enabled === false, 'Audio local deshabilitado', mutedAudio);
    context.check(mutedLabel === 'Activar micrófono' && mutedPressed === 'true', 'Boton refleja el silencio', { mutedLabel, mutedPressed });
    context.check(luisVideo.isAdvancing, 'Luis sigue recibiendo video', luisVideo);
    context.check(restoredAudio?.enabled === true, 'Audio local reactivado', restoredAudio);
    context.note(`Silenciado: audio enabled=${mutedAudio?.enabled}, boton "${mutedLabel}" aria-pressed=${mutedPressed}; video en Luis avanza; reactivado: enabled=${restoredAudio?.enabled}.`);
  },
};

export const cameraToggle = {
  id: 'E2E-05',
  type: 'Happy',
  title: 'Apagar y encender la camara durante la llamada',
  steps: [
    'Con la llamada activa, Ana pulsa #call-camera',
    'Leer la pista de video del sender de Ana',
    `Verificar durante ${TOGGLE_SAMPLE_MS} ms que Luis sigue recibiendo paquetes de audio`,
    'Ana pulsa #call-camera otra vez y se verifica que el video vuelve a avanzar en Luis',
  ],
  expected: 'Tras el primer clic la pista de video local tiene enabled=false y el boton dice "Encender cámara"; el audio sigue llegando; tras el segundo clic enabled=true y el video avanza en Luis.',
  allowedConsole: [],
  async run({ ana, luis }, context) {
    await ensureActiveCall(ana, luis);
    await ana.page.click('#call-camera');
    const disabledVideo = senderTrack(await ana.probe('readSenderTracks'), 'video');
    const disabledLabel = await ana.textOf('#call-camera');
    const audioBefore = await audioPacketsReceived(luis);
    await delay(TOGGLE_SAMPLE_MS);
    const audioAfter = await audioPacketsReceived(luis);
    await context.screenshot(luis, 'camara-apagada-vista-luis');
    await ana.page.click('#call-camera');
    const restoredVideo = senderTrack(await ana.probe('readSenderTracks'), 'video');
    const luisVideo = await sampleRemoteVideo(luis);

    context.metric('disabledVideoTrack', disabledVideo);
    context.metric('luisAudioPacketsWhileCameraOff', { before: audioBefore, after: audioAfter });
    context.metric('remoteVideoLuisAfterRestore', luisVideo);
    context.check(disabledVideo?.enabled === false, 'Video local deshabilitado', disabledVideo);
    context.check(disabledLabel === 'Encender cámara', 'Boton refleja la camara apagada', disabledLabel);
    context.check(audioAfter > audioBefore, 'Luis sigue recibiendo audio', { audioBefore, audioAfter });
    context.check(restoredVideo?.enabled === true, 'Video local reactivado', restoredVideo);
    context.check(luisVideo.isAdvancing, 'El video vuelve a avanzar en Luis', luisVideo);
    context.note(`Camara apagada: video enabled=${disabledVideo?.enabled}, boton "${disabledLabel}"; paquetes de audio en Luis ${audioBefore} -> ${audioAfter}; encendida: enabled=${restoredVideo?.enabled}, video en Luis avanza.`);
  },
};

export const hangUp = {
  id: 'E2E-06',
  type: 'Happy',
  title: 'Colgar libera la camara, el microfono y la conexion en ambos lados',
  steps: [
    'Con la llamada activa, Ana pulsa "Colgar"',
    'Esperar que el panel de Luis se cierre',
    'Leer readyState de todas las pistas de getUserMedia y connectionState de cada RTCPeerConnection en ambos lados',
    'Consultar /metrics',
  ],
  expected: 'Luis ve el panel cerrado y "La llamada terminó"; todas las pistas quedan "ended" y las conexiones "closed" en ambos lados; callsActive=0.',
  allowedConsole: [],
  async run({ ana, luis }, context) {
    await ensureActiveCall(ana, luis);
    await ana.page.click('#call-hangup');
    await luis.waitForHidden('#call');
    const luisNotice = await luis.textOf('#error');
    const [anaRelease, luisRelease] = await Promise.all([waitForMediaReleased(ana), waitForMediaReleased(luis)]);
    const metrics = await ana.fetchJson('/metrics');
    await context.screenshot(luis, 'colgado-vista-luis');

    context.metric('releaseAna', anaRelease);
    context.metric('releaseLuis', luisRelease);
    context.metric('serverMetrics', metrics.body);
    const isAnaPanelHidden = await ana.isHidden('#call');
    context.check(isAnaPanelHidden, 'Panel de Ana cerrado', isAnaPanelHidden);
    context.check(luisNotice === 'La llamada terminó', 'Luis ve el aviso de fin', luisNotice);
    context.check(isFullyReleased(anaRelease), 'Ana libero pistas y conexion', anaRelease);
    context.check(isFullyReleased(luisRelease), 'Luis libero pistas y conexion', luisRelease);
    context.check(metrics.body?.callsActive === 0, 'callsActive vuelve a 0', metrics.body);
    context.note(`Luis ve "${luisNotice}". Pistas Ana: ${anaRelease.tracks.length} ended; Luis: ${luisRelease.tracks.length} ended. Conexiones: Ana ${anaRelease.peerStates.join(',')}, Luis ${luisRelease.peerStates.join(',')}. /metrics callsActive=${metrics.body?.callsActive}.`);
  },
};
