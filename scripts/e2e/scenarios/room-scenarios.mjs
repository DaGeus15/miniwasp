/* global location */
// Escenarios de entrada a una sala: una invitacion invalida se rechaza; quien crea la sala
// comparte el enlace y la otra persona entra con el.
import { randomBytes } from 'node:crypto';
import {
  enterAsOwner,
  enterWithLink,
  inviteLink,
  isPost,
  NOT_FOUND_RESOURCE,
  RoomText,
  sessionStatus,
  UNAUTHORIZED_RESOURCE,
} from '../lib/room-steps.mjs';

const MALFORMED_INPUT = 'hola';

export const invalidInviteRejected = {
  id: 'E2E-01',
  type: 'Security',
  title: 'Unirse con una invitacion inexistente o mal formada se rechaza',
  steps: [
    `En la pantalla #home de Chrome A escribir "${MALFORMED_INPUT}" en #invite-token y pulsar "Unirme"`,
    'Escribir un ID con formato valido pero inexistente (22 caracteres base64url aleatorios) y pulsar "Unirme"',
  ],
  expected: `Texto mal formado: "${RoomText.INVALID_INVITE}" sin llamar al servidor. ID inexistente: POST /rooms/join responde 404, se muestra "${RoomText.ROOM_NOT_FOUND}" y el chat sigue oculto.`,
  allowedConsole: [UNAUTHORIZED_RESOURCE, NOT_FOUND_RESOURCE],
  async run({ ana }, context) {
    await ana.joinWithInput(MALFORMED_INPUT);
    await ana.waitForText('#home-error', RoomText.INVALID_INVITE);
    const responsePromise = ana.page.waitForResponse(isPost('/rooms/join'));
    await ana.joinWithInput(randomBytes(16).toString('base64url'));
    const response = await responsePromise;
    await ana.waitForText('#home-error', RoomText.ROOM_NOT_FOUND);
    const isChatHidden = await ana.isHidden('#chat');
    await context.screenshot(ana, 'invitacion-rechazada');

    context.check(response.status() === 404, 'POST /rooms/join responde 404', response.status());
    context.check(isChatHidden, 'El chat permanece oculto', isChatHidden);
    context.note(`Texto mal formado -> "${RoomText.INVALID_INVITE}"; ID inexistente -> POST /rooms/join ${response.status()} y "${await ana.textOf('#home-error')}"; chat oculto=${isChatHidden}.`);
  },
};

async function verifyRoles({ ana, luis }, context) {
  const luisSeesBadge = await luis.personEntry(ana.displayName).locator('.person-badge').textContent();
  const anaCanExpel = await ana.personEntry(luis.displayName).locator('.person-expel').isVisible();
  const luisExpelButtons = await luis.page.locator('.person-expel').count();
  const isLuisRotateHidden = await luis.isHidden('#rotate-invite');
  const [anaSession, luisSession] = [await sessionStatus(ana), await sessionStatus(luis)];
  context.metric('sessions', { ana: anaSession, luis: luisSession });
  context.check(luisSeesBadge.trim() === RoomText.OWNER_BADGE, 'Luis ve la insignia de quien creo la sala', luisSeesBadge);
  context.check(anaCanExpel && luisExpelButtons === 0, 'Solo Ana ve "Sacar"', { anaCanExpel, luisExpelButtons });
  context.check(isLuisRotateHidden, 'Luis no ve "Nuevo enlace"', isLuisRotateHidden);
  context.check(anaSession.body?.isOwner === true && luisSession.body?.isOwner === false, 'GET /session refleja los roles', { anaSession, luisSession });
  return { anaSession, luisSession };
}

async function copyInvite(ana) {
  await ana.page.click('#copy-invite');
  await ana.waitForText('#copy-status', RoomText.INVITE_COPIED);
  return ana.page.evaluate(() => navigator.clipboard.readText());
}

export const roomCreatedAndJoined = {
  id: 'E2E-02',
  type: 'Happy',
  title: 'Ana crea una sala y Luis entra con el enlace copiado',
  steps: [
    'Ana pulsa "Crear sala" (POST /rooms) y espera "En línea"',
    'Ana pulsa "Copiar enlace" y se lee el portapapeles',
    'Luis abre ese enlace (https://<host>/#join=<token>): entra solo, sin pulsar nada',
    'Ambos escriben su nombre y esperan verse en la lista de conectados',
    'Revisar insignia, botones de dueno y GET /session en ambos lados',
  ],
  expected: 'POST /rooms 204; el portapapeles contiene https://<host>/#join=<token mostrado>; Luis entra con el enlace y el fragmento se borra de la barra de direcciones; ambos se ven; solo Ana ve "Sacar" y "Nuevo enlace"; GET /session da isOwner true/false.',
  allowedConsole: [UNAUTHORIZED_RESOURCE],
  async run(world, context) {
    const { ana, luis, baseUrl } = world;
    const creation = ana.page.waitForResponse(isPost('/rooms'));
    await enterAsOwner(ana);
    const creationStatus = (await creation).status();
    const token = await ana.inviteToken();
    const copied = await copyInvite(ana);
    await enterWithLink(luis, copied);
    await ana.waitForPeer(luis.displayName);
    await luis.waitForPeer(ana.displayName);
    const luisHash = await luis.page.evaluate(() => location.hash);
    await context.screenshot(ana, 'sala-ana');
    await context.screenshot(luis, 'sala-luis');

    context.check(creationStatus === 204, 'POST /rooms responde 204', creationStatus);
    context.check(copied === inviteLink(baseUrl, token), 'El enlace copiado apunta a la invitacion mostrada', { copied, token });
    context.check(luisHash === '', 'La invitacion se borra de la barra de direcciones de Luis', luisHash);
    await verifyRoles(world, context);
    context.note(`POST /rooms -> ${creationStatus}; invitacion de ${token.length} caracteres; enlace copiado con formato https://<host>/#join=<token>; Luis entro con el enlace y su barra quedo sin fragmento; Ana ve "Sacar", Luis ve la insignia "${RoomText.OWNER_BADGE}"; GET /session isOwner Ana=true, Luis=false.`);
  },
};
