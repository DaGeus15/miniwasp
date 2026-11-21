// Una llamada en curso sobrevive a un corte breve del chat (red inestable, pestaña en
// segundo plano): el video va directo entre los navegadores y la conexion nueva la retoma.
import { setTimeout as delay } from 'node:timers/promises';
import { CallText, ensureIdle, establishCall, pageNow, readTrace, sampleRemoteVideo, waitForRemoteFrames } from '../lib/call-steps.mjs';

const ONLINE_TEXT = 'En línea';
const RECONNECT_TIMEOUT_MS = 30000;
// Mas que la espera del servidor (20 s): si no la hubiera retomado, ya la habria terminado.
const BEYOND_SERVER_GRACE_MS = 22000;

async function isInActiveCall(person) {
  return !(await person.isHidden('#call')) && (await person.textOf('#call-status')) === CallText.ACTIVE;
}

export const chatDropDuringCall = {
  id: 'E2E-15',
  type: 'Recovery',
  title: 'Corte breve del chat durante la llamada: aviso de reconexion y la llamada sigue',
  steps: [
    'Ana llama a Luis, Luis contesta y ambos ven el video del otro',
    'Se cierra el WebSocket de Luis sin que la app lo pida (corte de red simulado)',
    'Luis ve el aviso "Reconectando…" con el indicador de carga sobre el video',
    'El chat de Luis reconecta solo y envia call-resume; el aviso desaparece',
    `Esperar hasta ${BEYOND_SERVER_GRACE_MS / 1000} s despues del corte (mas que la espera del servidor)`,
    'Verificar que ambos siguen "En llamada" y que el video avanza en los dos sentidos',
  ],
  expected: 'El aviso de reconexion aparece y se va solo; Luis envia call-resume; pasada la espera del servidor la llamada sigue activa en ambos lados y el video remoto avanza.',
  allowedConsole: [],
  async run({ ana, luis }, context) {
    await ensureIdle([ana, luis]);
    await establishCall(ana, luis);
    await Promise.all([waitForRemoteFrames(ana), waitForRemoteFrames(luis)]);
    const droppedAt = await pageNow(luis);
    const isDropped = await luis.probe('dropSocket');

    await luis.page.locator('#call-reconnecting').waitFor({ state: 'visible' });
    await context.screenshot(luis, 'reconectando-en-llamada');
    await luis.waitForText('#status', ONLINE_TEXT, RECONNECT_TIMEOUT_MS);
    await luis.waitForHidden('#call-reconnecting', RECONNECT_TIMEOUT_MS);
    await delay(Math.max(0, BEYOND_SERVER_GRACE_MS - ((await pageNow(luis)) - droppedAt)));

    const [anaVideo, luisVideo] = await Promise.all([sampleRemoteVideo(ana), sampleRemoteVideo(luis)]);
    const resumes = (await readTrace(luis)).sent.filter((entry) => entry.t >= droppedAt && entry.type === 'call-resume');
    await context.screenshot(luis, 'llamada-retomada');

    context.check(isDropped, 'Se cerro el WebSocket de Luis', isDropped);
    context.check(resumes.length === 1, 'Luis pide retomar la llamada una vez al reconectar', resumes.length);
    context.check(await isInActiveCall(ana), 'Ana sigue en llamada', await ana.textOf('#call-status'));
    context.check(await isInActiveCall(luis), 'Luis sigue en llamada', await luis.textOf('#call-status'));
    context.check(anaVideo.isAdvancing && luisVideo.isAdvancing, 'El video avanza en los dos sentidos', { anaVideo, luisVideo });
    context.note(`Corte simulado del WebSocket de Luis; aviso "Reconectando…" visible y luego oculto; call-resume enviado ${resumes.length} vez; a los ${BEYOND_SERVER_GRACE_MS / 1000} s ambos siguen en llamada con video avanzando.`);
    await ensureIdle([ana, luis]);
  },
};
