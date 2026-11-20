// Control de acceso a la sala: renovar la invitacion y sacar a una persona.
import { setTimeout as delay } from 'node:timers/promises';
import {
  currentInviteLink,
  enterWithLink,
  inviteLink,
  isPost,
  NOT_FOUND_RESOURCE,
  RoomText,
  sessionStatus,
  UNAUTHORIZED_RESOURCE,
  waitForNewInvite,
} from '../lib/room-steps.mjs';

const QUIET_PERIOD_MS = 500;
const EXPELLED_CLOSE_CODE = 4403;

// Abre un enlace y devuelve el codigo de POST /rooms/join que provoca.
async function tryInvite(person, link) {
  const response = person.page.waitForResponse(isPost('/rooms/join'));
  await person.openInvite(link);
  return (await response).status();
}

async function forgedRotation({ ana, luis }, tokenBefore) {
  const isRotateHidden = await luis.isHidden('#rotate-invite');
  const wasSent = await luis.probe('sendRaw', { type: 'room-rotate-invite' });
  await luis.waitForText('#error', RoomText.OWNER_ONLY);
  await delay(QUIET_PERIOD_MS);
  return { isRotateHidden, wasSent, tokenAfterForgery: await ana.inviteToken(), unchanged: (await ana.inviteToken()) === tokenBefore };
}

export const inviteRotation = {
  id: 'E2E-13',
  type: 'Security',
  title: 'Renovar la invitacion invalida el enlace anterior',
  steps: [
    'Luis (no es dueno) no ve "Nuevo enlace"; su cliente envia a mano {type:"room-rotate-invite"} por el WebSocket',
    'Ana pulsa "Nuevo enlace"',
    'Verificar que Ana y Luis ven la nueva invitacion',
    'Un cuarto Chrome (Diego) abre el enlace anterior y luego el nuevo; despues pulsa "Salir de la sala"',
  ],
  expected: `El intento de Luis se rechaza con "${RoomText.OWNER_ONLY}" y la invitacion no cambia; tras el clic de Ana ambos ven otra invitacion; el enlace anterior da 404 y "${RoomText.ROOM_NOT_FOUND}"; el nuevo permite entrar.`,
  allowedConsole: [UNAUTHORIZED_RESOURCE, NOT_FOUND_RESOURCE],
  async run(world, context) {
    const { ana, luis, baseUrl } = world;
    const tokenBefore = await ana.inviteToken();
    const forgery = await forgedRotation(world, tokenBefore);
    await ana.page.click('#rotate-invite');
    const tokenAfter = await waitForNewInvite(ana, tokenBefore);
    const luisToken = await waitForNewInvite(luis, tokenBefore);
    const diego = await world.launchPerson({ label: 'diego', displayName: 'Diego' });
    try {
      const results = await probeLinks({ diego, ana, baseUrl, tokenBefore, tokenAfter }, context);
      verifyRotation({ forgery, tokenBefore, tokenAfter, luisToken, ...results }, context);
    } finally {
      await world.removePerson(diego);
    }
  },
};

async function probeLinks({ diego, ana, baseUrl, tokenBefore, tokenAfter }, context) {
  const oldLinkStatus = await tryInvite(diego, inviteLink(baseUrl, tokenBefore));
  await diego.waitForText('#home-error', RoomText.ROOM_NOT_FOUND);
  await context.screenshot(diego, 'enlace-anterior-rechazado');
  await enterWithLink(diego, inviteLink(baseUrl, tokenAfter));
  await ana.waitForPeer(diego.displayName);
  await diego.page.click('#logout');
  await diego.waitForHome();
  return { oldLinkStatus, newLinkWorked: true };
}

function verifyRotation({ forgery, tokenBefore, tokenAfter, luisToken, oldLinkStatus, newLinkWorked }, context) {
  context.metric('forgedRotationByNonOwner', forgery);
  context.metric('oldLinkJoinStatus', oldLinkStatus);
  context.check(forgery.isRotateHidden, 'Luis no ve "Nuevo enlace"', forgery.isRotateHidden);
  context.check(forgery.wasSent && forgery.unchanged, 'El servidor ignora la renovacion pedida por quien no es dueno', forgery);
  context.check(tokenAfter !== tokenBefore && luisToken === tokenAfter, 'Ana y Luis ven la nueva invitacion', { tokenBefore, tokenAfter, luisToken });
  context.check(oldLinkStatus === 404, 'El enlace anterior responde 404', oldLinkStatus);
  context.check(newLinkWorked, 'El enlace nuevo permite entrar', newLinkWorked);
  context.note(`Renovacion enviada a mano por Luis -> "${RoomText.OWNER_ONLY}", invitacion sin cambios. Tras "Nuevo enlace" ambos ven otra invitacion; enlace anterior -> POST /rooms/join ${oldLinkStatus}; con el nuevo Diego entro y salio.`);
}

async function expelLuis({ ana, luis }) {
  const tokenBefore = await ana.inviteToken();
  await ana.personEntry(luis.displayName).locator('.person-expel').click();
  await luis.waitForHome();
  await luis.waitForText('#home-error', RoomText.SESSION_ENDED);
  const closes = await luis.probe('readSocketCloses');
  const sessionAfter = await sessionStatus(luis);
  const tokenAfter = await waitForNewInvite(ana, tokenBefore);
  await ana.personEntry(luis.displayName).waitFor({ state: 'detached' });
  return { tokenBefore, tokenAfter, closeCodes: closes.map((close) => close.code), sessionAfter };
}

export const expelMember = {
  id: 'E2E-14',
  type: 'Security',
  title: 'Sacar a una persona: no puede volver con el enlace viejo, si con el nuevo',
  steps: [
    'Ana pulsa "Sacar" junto a Luis',
    'Verificar en Luis: cierre del WebSocket con codigo 4403, pantalla de inicio con el aviso y GET /session 401',
    'Verificar en Ana: Luis desaparece de la lista y la invitacion se renueva',
    'Luis abre el enlace anterior',
    'Luis abre el enlace nuevo y vuelve a escribir su nombre',
  ],
  expected: `Luis vuelve al inicio con "${RoomText.SESSION_ENDED}" (cierre 4403, sesion revocada); la invitacion cambia; el enlace viejo da 404 y "${RoomText.ROOM_NOT_FOUND}"; con el nuevo Luis entra otra vez y Ana lo ve.`,
  allowedConsole: [UNAUTHORIZED_RESOURCE, NOT_FOUND_RESOURCE],
  async run(world, context) {
    const { ana, luis, baseUrl } = world;
    const expulsion = await expelLuis(world);
    await context.screenshot(luis, 'expulsado');
    await context.screenshot(ana, 'tras-expulsar');
    const oldLinkStatus = await tryInvite(luis, inviteLink(baseUrl, expulsion.tokenBefore));
    await luis.waitForText('#home-error', RoomText.ROOM_NOT_FOUND);
    await enterWithLink(luis, await currentInviteLink(world));
    await ana.waitForPeer(luis.displayName);
    verifyExpulsion({ ...expulsion, oldLinkStatus }, context);
  },
};

function verifyExpulsion({ tokenBefore, tokenAfter, closeCodes, sessionAfter, oldLinkStatus }, context) {
  context.metric('closeCodesLuis', closeCodes);
  context.metric('sessionAfterExpulsion', sessionAfter);
  context.metric('oldLinkJoinStatus', oldLinkStatus);
  context.check(closeCodes.includes(EXPELLED_CLOSE_CODE), 'El WebSocket de Luis se cierra con 4403', closeCodes);
  context.check(sessionAfter.status === 401, 'La sesion de Luis queda revocada (GET /session 401)', sessionAfter);
  context.check(tokenAfter !== tokenBefore, 'La invitacion se renueva al sacar a alguien', { tokenBefore, tokenAfter });
  context.check(oldLinkStatus === 404, 'El enlace viejo ya no sirve (404)', oldLinkStatus);
  context.note(`Luis: cierre ${closeCodes.join(',')}, aviso "${RoomText.SESSION_ENDED}", GET /session ${sessionAfter.status}. Invitacion renovada. Enlace viejo -> ${oldLinkStatus}; con el nuevo Luis volvio a la sala y Ana lo ve.`);
}
