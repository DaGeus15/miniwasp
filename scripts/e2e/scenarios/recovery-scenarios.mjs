// Recuperacion ante la caida del servidor de senalizacion mientras nadie esta en llamada.
// Las salas viven en memoria: tras el reinicio la sala ya no existe y hay que crear otra.
import { ensureIdle, pageNow } from '../lib/call-steps.mjs';
import { enterAsOwner, enterWithLink, inviteLink, RoomText, UNAUTHORIZED_RESOURCE } from '../lib/room-steps.mjs';

const RECONNECTING_TEXT = 'Reconectando…';
const ONLINE_TEXT = 'En línea';
const RECOVERY_TIMEOUT_MS = 45000;
const WATCHED_IDS = new Set(['status', 'home', 'home-error', 'chat']);

// Resume lo que vio la persona desde la marca: textos de estado y pantallas mostradas.
function describeUiSequence(uiLog, since) {
  return uiLog
    .filter((entry) => entry.t >= since && WATCHED_IDS.has(entry.id))
    .map((entry) => ({
      atMs: Number((entry.t - since).toFixed(0)),
      element: entry.id,
      shown: entry.hidden ? 'oculto' : entry.text || 'visible',
    }));
}

function firstShown(uiLog, since, id, text) {
  const entry = uiLog.find((item) => item.t >= since && item.id === id && !item.hidden && (text === undefined || item.text === text));
  return entry ? Number((entry.t - since).toFixed(0)) : null;
}

async function waitForRoomClosedNotice(person) {
  await person.page.locator('#home').waitFor({ state: 'visible', timeout: RECOVERY_TIMEOUT_MS });
  await person.waitForText('#home-error', RoomText.SESSION_ENDED, RECOVERY_TIMEOUT_MS);
}

async function restartServer({ app, ana }, context) {
  await app.kill();
  const killedAt = await pageNow(ana);
  await ana.waitForText('#status', RECONNECTING_TEXT, RECOVERY_TIMEOUT_MS);
  await context.screenshot(ana, 'reconectando');
  await app.start();
  return { killedAt, restartedAt: await pageNow(ana) };
}

async function openNewRoom({ ana, luis, baseUrl }) {
  await enterAsOwner(ana);
  await enterWithLink(luis, inviteLink(baseUrl, await ana.inviteToken()));
  await ana.waitForPeer(luis.displayName);
  await luis.waitForPeer(ana.displayName);
}

export const serverRestartWhileIdle = {
  id: 'E2E-10',
  type: 'Recovery',
  title: 'Reinicio del servidor de senalizacion sin llamada activa',
  steps: [
    'Con Ana y Luis en la sala y sin llamada, matar el proceso del servidor',
    'Verificar que el chat muestra "Reconectando…"',
    'Arrancar de nuevo el servidor en el mismo puerto (salas y sesiones viven en memoria y se pierden)',
    'Esperar a que el cliente reintente y vuelva al inicio con el aviso',
    'Ana crea una sala nueva y Luis entra con el enlace nuevo; esperar "En línea" y la lista de conectados',
  ],
  expected: `"${RECONNECTING_TEXT}" al caer el servidor; tras el reinicio, pantalla de inicio con "${RoomText.SESSION_ENDED}" en ambos; en una sala nueva, "${ONLINE_TEXT}" y ambos se ven otra vez.`,
  allowedConsole: [UNAUTHORIZED_RESOURCE, /ERR_CONNECTION_REFUSED/, /WebSocket connection to .* failed/],
  async run(world, context) {
    const { ana, luis } = world;
    await ensureIdle([ana, luis]);
    const since = await pageNow(ana);
    const { killedAt, restartedAt } = await restartServer(world, context);
    await Promise.all([waitForRoomClosedNotice(ana), waitForRoomClosedNotice(luis)]);
    await context.screenshot(ana, 'sala-cerrada');
    const reenteredAt = await pageNow(ana);
    await openNewRoom(world);
    await context.screenshot(ana, 'en-linea-otra-vez');
    recordRecovery({ uiLog: await ana.probe('readUiLog'), since, killedAt, restartedAt, reenteredAt }, context);
  },
};

function recordRecovery({ uiLog, since, killedAt, restartedAt, reenteredAt }, context) {
  const sequence = describeUiSequence(uiLog, since);
  const reconnectingAt = firstShown(uiLog, killedAt, 'status', RECONNECTING_TEXT);
  const homeShownAt = firstShown(uiLog, restartedAt, 'home');
  const onlineAt = firstShown(uiLog, reenteredAt, 'status', ONLINE_TEXT);
  context.metric('uiSequenceAna', sequence);
  context.metric('killToReconnectingMs', reconnectingAt);
  context.metric('serverDowntimeMs', Number((restartedAt - killedAt).toFixed(0)));
  context.metric('restartToHomeShownMs', homeShownAt);
  context.metric('newRoomToOnlineMs', onlineAt);
  context.check(reconnectingAt !== null, `Se mostro "${RECONNECTING_TEXT}"`, sequence);
  context.check(homeShownAt !== null, 'Se volvio al inicio tras el reinicio', sequence);
  context.check(onlineAt !== null, `En la sala nueva se muestra "${ONLINE_TEXT}"`, sequence);
  const readableSequence = sequence.map((item) => `${item.atMs}ms ${item.element}=${item.shown}`).join(' | ');
  context.note(
    `Secuencia en Ana: ${readableSequence}. ` +
      `Servidor caido ${context.metrics.get('serverDowntimeMs')} ms; inicio visible ${homeShownAt} ms despues del reinicio; "${ONLINE_TEXT}" ${onlineAt} ms despues de crear la sala nueva.`,
  );
}
