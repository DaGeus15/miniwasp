/* global window, document */
// Pasos de videollamada reutilizados por varios escenarios y medicion de tiempos a partir
// de las marcas que dejan las sondas del navegador (reloj de pared del mismo equipo).
import { setTimeout as delay } from 'node:timers/promises';

const CONNECT_TIMEOUT_MS = 30000;
const VIDEO_SAMPLE_MS = 1500;
const RELEASE_TIMEOUT_MS = 10000;
// El codigo tiene 12 digitos en cuatro grupos de tres.
const SECURITY_CODE_PATTERN = /^Código de seguridad: (\d{3} \d{3} \d{3} \d{3})\. Compruébalo con la otra persona\.$/;

export const CallText = Object.freeze({
  INCOMING: 'Videollamada entrante',
  CALLING: 'Llamando…',
  CONNECTING: 'Conectando…',
  ACTIVE: 'En llamada',
});

export async function pageNow(person) {
  return person.page.evaluate(() => Date.now());
}

export async function readTrace(person) {
  return person.page.evaluate(() => ({
    clicks: window.__e2e.clicks,
    uiLog: window.__e2e.uiLog,
    sent: window.__e2e.sentEvents,
    received: window.__e2e.receivedEvents,
    mediaRequests: window.__e2e.mediaRequests,
  }));
}

export function firstAfter(list, since, predicate) {
  return list.find((entry) => entry.t >= since && predicate(entry)) ?? null;
}

function elapsed(from, to) {
  return from && to ? Number((to.t - from.t).toFixed(1)) : null;
}

export async function startCall(caller, callee) {
  await caller.callPeer(callee.displayName);
  await callee.page.locator('#call-accept').waitFor({ state: 'visible' });
  await callee.waitForText('#call-status', CallText.INCOMING);
}

export async function establishCall(caller, callee) {
  await startCall(caller, callee);
  await callee.page.click('#call-accept');
  await caller.waitForText('#call-status', CallText.ACTIVE, CONNECT_TIMEOUT_MS);
  await callee.waitForText('#call-status', CallText.ACTIVE, CONNECT_TIMEOUT_MS);
}

function isStatus(text) {
  return (entry) => entry.id === 'call-status' && entry.text === text;
}

function byType(type, kind) {
  return (entry) => entry.type === type && (kind === undefined || entry.kind === kind);
}

// Marcas de tiempo de una llamada que empezo despues de since, tomadas de ambas sondas.
function collectCallMarks(callerTrace, calleeTrace, since) {
  const first = (list, predicate) => firstAfter(list, since, predicate);
  return {
    click: first(callerTrace.clicks, (entry) => entry.className.includes('person-call')),
    invite: first(callerTrace.sent, byType('call-invite')),
    ringing: first(callerTrace.received, byType('call-ringing')),
    incoming: first(calleeTrace.received, byType('call-incoming')),
    incomingShown: first(calleeTrace.uiLog, isStatus(CallText.INCOMING)),
    acceptClick: first(calleeTrace.clicks, (entry) => entry.id === 'call-accept'),
    acceptSent: first(calleeTrace.sent, byType('call-accept')),
    accepted: first(callerTrace.received, byType('call-accepted')),
    offer: first(callerTrace.sent, byType('call-signal', 'offer')),
    answer: first(callerTrace.received, byType('call-signal', 'answer')),
    callerActive: first(callerTrace.uiLog, isStatus(CallText.ACTIVE)),
    calleeActive: first(calleeTrace.uiLog, isStatus(CallText.ACTIVE)),
  };
}

// Tiempos derivados. calleeAnswerDelayMs es lo que tarda la automatizacion en pulsar
// "Contestar"; se descuenta para obtener el tiempo atribuible al sistema.
export function measureCallTimeline(callerTrace, calleeTrace, since) {
  const marks = collectCallMarks(callerTrace, calleeTrace, since);
  const callSetupMs = elapsed(marks.click, marks.callerActive);
  const calleeAnswerDelayMs = elapsed(marks.incomingShown, marks.acceptClick);
  return {
    callSetupMs,
    calleeAnswerDelayMs,
    callSetupExcludingAnswerDelayMs: callSetupMs === null || calleeAnswerDelayMs === null ? null : Number((callSetupMs - calleeAnswerDelayMs).toFixed(1)),
    callerMediaAcquisitionMs: elapsed(marks.click, marks.invite),
    inviteToRingingRoundTripMs: elapsed(marks.invite, marks.ringing),
    inviteToIncomingMs: elapsed(marks.invite, marks.incoming),
    calleeMediaAcquisitionMs: elapsed(marks.acceptClick, marks.acceptSent),
    acceptToAcceptedMs: elapsed(marks.acceptSent, marks.accepted),
    acceptedToOfferSentMs: elapsed(marks.accepted, marks.offer),
    offerToAnswerMs: elapsed(marks.offer, marks.answer),
    answerToCallerActiveMs: elapsed(marks.answer, marks.callerActive),
    callerActiveToCalleeActiveMs: elapsed(marks.callerActive, marks.calleeActive),
    offerSdpLength: marks.offer?.sdpLength ?? null,
    answerSdpLength: marks.answer?.sdpLength ?? null,
  };
}

// Codigo de seguridad derivado de las huellas DTLS que la app muestra al conectar.
export async function readSecurityCode(person) {
  await person.page.locator('#call-security-code').waitFor({ state: 'visible' });
  const text = await person.textOf('#call-security-code');
  return { text, code: SECURITY_CODE_PATTERN.exec(text)?.[1] ?? null };
}

export async function sampleRemoteVideo(person) {
  const before = await person.probe('readVideo', '#remote-video');
  await delay(VIDEO_SAMPLE_MS);
  const after = await person.probe('readVideo', '#remote-video');
  return {
    before,
    after,
    isAdvancing: after.currentTime > before.currentTime && after.totalVideoFrames > before.totalVideoFrames,
  };
}

export async function waitForRemoteFrames(person) {
  await person.page.waitForFunction(() => document.querySelector('#remote-video').videoWidth > 0, undefined, {
    timeout: CONNECT_TIMEOUT_MS,
    polling: 50,
  });
}

// Espera a que todas las pistas de camara y microfono terminen y las conexiones se cierren.
export async function waitForMediaReleased(person) {
  await person.page
    .waitForFunction(
      () =>
        window.__e2e.mediaStreams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')) &&
        window.__e2e.peerConnections.every((connection) => connection.connectionState === 'closed'),
      undefined,
      { timeout: RELEASE_TIMEOUT_MS, polling: 50 },
    )
    .catch(() => {});
  return {
    tracks: await person.probe('readMediaTracks'),
    peerStates: await person.probe('readPeerStates'),
  };
}

export function isFullyReleased({ tracks, peerStates }) {
  return tracks.every((track) => track.readyState === 'ended') && peerStates.every((state) => state === 'closed');
}

// Deja a cada persona sin llamada para que un escenario no contamine al siguiente.
export async function ensureIdle(people) {
  for (const person of people) {
    if (await person.isHidden('#call')) {
      continue;
    }
    for (const selector of ['#call-hangup', '#call-reject']) {
      if (await person.page.locator(selector).isVisible()) {
        await person.page.click(selector);
      }
    }
    await person.waitForHidden('#call');
  }
}
