// Escenarios donde la llamada no sigue el camino feliz: permiso negado, rechazo,
// cancelacion, colgado simultaneo y cierre de sesion durante la llamada.
import { setTimeout as delay } from 'node:timers/promises';
import { MediaAccess } from '../lib/browser-person.mjs';
import {
  CallText,
  ensureIdle,
  establishCall,
  firstAfter,
  isFullyReleased,
  pageNow,
  readTrace,
  startCall,
  waitForMediaReleased,
} from '../lib/call-steps.mjs';
import { currentInviteLink, enterWithLink, RoomText, UNAUTHORIZED_RESOURCE } from '../lib/room-steps.mjs';

const MEDIA_DENIED_TEXT = 'Permite el acceso a la cámara y al micrófono para hacer videollamadas';
const QUIET_PERIOD_MS = 1500;
const CLICK_LEAD_MS = 300;

function sentAfter(trace, since, type) {
  return trace.sent.filter((entry) => entry.t >= since && entry.type === type);
}

async function serverCallsActive(person) {
  const metrics = await person.fetchJson('/metrics');
  return metrics.body?.callsActive ?? null;
}

export const cameraPermissionDenied = {
  id: 'E2E-07',
  type: 'Sad',
  title: 'Permiso de camara negado: aviso y ninguna invitacion enviada',
  steps: [
    'Abrir un tercer Chrome (Carla) sin --use-fake-ui-for-media-stream y sin conceder camera/microphone al contexto',
    'Entrar a la sala con el enlace de invitacion vigente y escribir el nombre',
    'Carla pulsa "Videollamar" junto a Ana',
    `Esperar ${QUIET_PERIOD_MS} ms y revisar los eventos WebSocket enviados por Carla y recibidos por Ana`,
  ],
  expected: `Carla ve "${MEDIA_DENIED_TEXT}", getUserMedia falla con NotAllowedError, no se envia call-invite y Ana no recibe ninguna llamada.`,
  allowedConsole: [UNAUTHORIZED_RESOURCE],
  async run(world, context) {
    const { ana } = world;
    const carla = await world.launchPerson({ label: 'carla', displayName: 'Carla', mediaAccess: MediaAccess.DENIED });
    try {
      await enterWithLink(carla, await currentInviteLink(world));
      await carla.waitForPeer(ana.displayName);
      const since = await pageNow(carla);
      await carla.callPeer(ana.displayName);
      await carla.waitForText('#error', MEDIA_DENIED_TEXT);
      await delay(QUIET_PERIOD_MS);
      await context.screenshot(carla, 'permiso-negado');
      await verifyNoInvitation({ carla, ana, since, context });
    } finally {
      await world.removePerson(carla);
    }
  },
};

async function verifyNoInvitation({ carla, ana, since, context }) {
  const carlaTrace = await readTrace(carla);
  const anaTrace = await readTrace(ana);
  const invites = sentAfter(carlaTrace, since, 'call-invite');
  const mediaRequest = firstAfter(carlaTrace.mediaRequests, since, () => true);
  const incoming = firstAfter(anaTrace.received, since, (entry) => entry.type === 'call-incoming');
  const isCarlaPanelHidden = await carla.isHidden('#call');
  const isAnaPanelHidden = await ana.isHidden('#call');

  context.metric('mediaRequest', mediaRequest);
  context.metric('invitesSent', invites.length);
  context.check(mediaRequest?.errorName === 'NotAllowedError', 'getUserMedia falla con NotAllowedError', mediaRequest);
  context.check(invites.length === 0, 'No se envia call-invite', invites.length);
  context.check(incoming === null && isAnaPanelHidden, 'Ana no recibe la llamada', { incoming, isAnaPanelHidden });
  context.check(isCarlaPanelHidden, 'El panel de llamada de Carla se cierra', isCarlaPanelHidden);
  context.note(`Carla ve "${await carla.textOf('#error')}"; getUserMedia -> ${mediaRequest?.errorName}; call-invite enviados: ${invites.length}; Ana recibio call-incoming: ${incoming !== null}.`);
}

export const rejectIncomingCall = {
  id: 'E2E-08',
  type: 'Sad',
  title: 'Rechazar una llamada entrante',
  steps: ['Ana llama a Luis', 'Luis ve "Videollamada entrante" y pulsa "Rechazar"', 'Revisar paneles, avisos y la camara de Ana'],
  expected: 'Ambos paneles se cierran, Ana ve "La persona rechazó la llamada", recibe call-ended con reason=rejected y su camara queda liberada.',
  allowedConsole: [],
  async run({ ana, luis }, context) {
    await ensureIdle([ana, luis]);
    const since = await pageNow(ana);
    await startCall(ana, luis);
    await context.screenshot(luis, 'entrante-vista-luis');
    await luis.page.click('#call-reject');
    await ana.waitForHidden('#call');
    const anaNotice = await ana.textOf('#error');
    const ended = firstAfter((await readTrace(ana)).received, since, (entry) => entry.type === 'call-ended');
    const anaRelease = await waitForMediaReleased(ana);
    await context.screenshot(ana, 'rechazada-vista-ana');

    context.metric('callEnded', ended);
    context.metric('releaseAna', anaRelease);
    context.check(await luis.isHidden('#call'), 'Panel de Luis cerrado', 'visible');
    context.check(anaNotice === 'La persona rechazó la llamada', 'Ana ve el aviso de rechazo', anaNotice);
    context.check(ended?.reason === 'rejected', 'call-ended con reason=rejected', ended);
    context.check(isFullyReleased(anaRelease), 'Camara de Ana liberada', anaRelease);
    context.note(`Ana ve "${anaNotice}", call-ended reason=${ended?.reason}; pistas de Ana: ${anaRelease.tracks.map((track) => track.readyState).join(',')}.`);
  },
};

export const callerCancelsWhileRinging = {
  id: 'E2E-09',
  type: 'Sad',
  title: 'La persona que llama cancela mientras suena',
  steps: ['Ana llama a Luis', 'Con Ana en "Llamando…" y Luis en "Videollamada entrante", Ana pulsa "Colgar"', 'Revisar el panel de Luis y /metrics'],
  expected: 'El panel de Luis se cierra con "La llamada terminó", la camara de Ana se libera y callsActive=0.',
  allowedConsole: [],
  async run({ ana, luis }, context) {
    await ensureIdle([ana, luis]);
    await startCall(ana, luis);
    const anaStatus = await ana.textOf('#call-status');
    await context.screenshot(ana, 'llamando-vista-ana');
    await ana.page.click('#call-hangup');
    await luis.waitForHidden('#call');
    const luisNotice = await luis.textOf('#error');
    const anaRelease = await waitForMediaReleased(ana);
    const callsActive = await serverCallsActive(ana);
    await context.screenshot(luis, 'cancelada-vista-luis');

    context.metric('releaseAna', anaRelease);
    context.check(anaStatus === CallText.CALLING, 'Ana estaba en "Llamando…"', anaStatus);
    context.check(luisNotice === 'La llamada terminó', 'Luis ve el aviso de fin', luisNotice);
    context.check(isFullyReleased(anaRelease), 'Camara de Ana liberada', anaRelease);
    context.check(callsActive === 0, 'callsActive vuelve a 0', callsActive);
    context.note(`Ana estaba en "${anaStatus}"; Luis ve "${luisNotice}"; pistas de Ana liberadas; callsActive=${callsActive}.`);
  },
};

export const simultaneousHangUp = {
  id: 'E2E-11',
  type: 'Concurrency',
  title: 'Ambos cuelgan al mismo tiempo',
  steps: ['Establecer una llamada Ana-Luis', `Programar en ambos navegadores un clic en "Colgar" a la misma hora (ahora + ${CLICK_LEAD_MS} ms)`, 'Revisar paneles, consola, recursos, /metrics y registro del servidor'],
  expected: 'Ambos paneles se cierran, no hay errores de consola ni del servidor, todo se libera y callsActive=0.',
  allowedConsole: [],
  async run({ ana, luis, app }, context) {
    await ensureIdle([ana, luis]);
    await establishCall(ana, luis);
    const since = await pageNow(ana);
    const serverErrorsBefore = app.errorLogEntries().length;
    const clickAt = Date.now() + CLICK_LEAD_MS;
    const clicks = await Promise.all([ana.probe('clickAt', '#call-hangup', clickAt), luis.probe('clickAt', '#call-hangup', clickAt)]);
    await Promise.all([ana.waitForHidden('#call'), luis.waitForHidden('#call')]);
    const [anaRelease, luisRelease] = await Promise.all([waitForMediaReleased(ana), waitForMediaReleased(luis)]);
    const hangUpsSent = [sentAfter(await readTrace(ana), since, 'call-hangup').length, sentAfter(await readTrace(luis), since, 'call-hangup').length];
    const outcome = { clicks, hangUpsSent, anaRelease, luisRelease, callsActive: await serverCallsActive(ana), serverErrors: app.errorLogEntries().slice(serverErrorsBefore) };
    await context.screenshot(ana, 'colgado-simultaneo-ana');
    verifySimultaneousHangUp(outcome, context);
  },
};

function verifySimultaneousHangUp({ clicks, hangUpsSent, anaRelease, luisRelease, callsActive, serverErrors }, context) {
  context.metric('clickSkewMs', Number(Math.abs(clicks[0] - clicks[1]).toFixed(2)));
  context.metric('hangUpsSent', { ana: hangUpsSent[0], luis: hangUpsSent[1] });
  context.check(hangUpsSent[0] === 1 && hangUpsSent[1] === 1, 'Ambos navegadores enviaron call-hangup (la carrera ocurrio de verdad)', hangUpsSent);
  context.check(isFullyReleased(anaRelease) && isFullyReleased(luisRelease), 'Recursos liberados en ambos lados', { anaRelease, luisRelease });
  context.check(callsActive === 0, 'callsActive vuelve a 0', callsActive);
  context.check(serverErrors.length === 0, 'Sin errores en el registro del servidor', serverErrors);
  context.note(`Clics separados por ${context.metrics.get('clickSkewMs')} ms; call-hangup enviados Ana=${hangUpsSent[0]}, Luis=${hangUpsSent[1]}; ambos paneles cerrados; recursos liberados; callsActive=${callsActive}; errores del servidor: ${serverErrors.length}.`);
}

export const logoutDuringCall = {
  id: 'E2E-12',
  type: 'Security',
  title: 'Cerrar sesion durante la llamada termina la llamada del otro participante',
  steps: [
    'Establecer una llamada Ana-Luis',
    'Comprobar si el boton "Salir de la sala" de la pestana en llamada es clicable (el panel de llamada lo cubre)',
    'Ana abre una segunda pestana con la misma sesion y pulsa "Salir de la sala" (DELETE /session)',
    'Revisar el panel y el aviso de Luis, la pantalla de la pestana en llamada de Ana y los recursos de ambos',
  ],
  expected: 'El servidor revoca la sesion y cierra sus conexiones: Luis ve el panel cerrado con "Se perdió la conexión de la llamada"; la pestana de Ana vuelve a #home con "Ya no estás en la sala: saliste, te sacaron o la sala se cerró."; todo se libera.',
  allowedConsole: [UNAUTHORIZED_RESOURCE],
  async run({ ana, luis, baseUrl }, context) {
    await ensureIdle([ana, luis]);
    await establishCall(ana, luis);
    const isLogoutReachable = await ana.page.locator('#logout').click({ trial: true, timeout: 1000 }).then(() => true, () => false);
    const tab = await ana.openTab(baseUrl);
    await tab.locator('#chat').waitFor({ state: 'visible' });
    await tab.click('#logout');
    await luis.waitForHidden('#call');
    const luisNotice = await luis.textOf('#error');
    await ana.waitForText('#home-error', RoomText.SESSION_ENDED);
    const [anaRelease, luisRelease] = await Promise.all([waitForMediaReleased(ana), waitForMediaReleased(luis)]);
    const callsActive = await serverCallsActive(luis);
    await context.screenshot(luis, 'logout-vista-luis');
    await context.screenshot(ana, 'logout-vista-ana');
    await tab.close();

    context.metric('logoutButtonReachableDuringCall', isLogoutReachable);
    context.check(luisNotice === 'Se perdió la conexión de la llamada', 'Luis ve que la llamada se corto', luisNotice);
    context.check(isFullyReleased(anaRelease) && isFullyReleased(luisRelease), 'Recursos liberados en ambos lados', { anaRelease, luisRelease });
    context.check(callsActive === 0, 'callsActive vuelve a 0', callsActive);
    context.note(`"Salir de la sala" clicable durante la llamada en la misma pestana: ${isLogoutReachable}. Tras salir desde otra pestana, Luis ve "${luisNotice}"; Ana ve "${RoomText.SESSION_ENDED}"; recursos liberados; callsActive=${callsActive}.`);
  },
};
