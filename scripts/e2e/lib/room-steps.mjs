/* global document */
// Pasos de sala reutilizados por varios escenarios: crear, unirse con el enlace y leer
// la invitacion vigente.
export const RoomText = Object.freeze({
  ROOM_NOT_FOUND: 'La sala no existe o el enlace ya no es válido',
  INVALID_INVITE: 'Pega el ID de invitación o el enlace completo',
  SESSION_ENDED: 'Ya no estás en la sala: saliste, te sacaron o la sala se cerró.',
  INVITE_COPIED: 'Enlace copiado',
  OWNER_BADGE: 'Creó la sala',
  OWNER_ONLY: 'Solo quien creó la sala puede hacer esto',
});

export const UNAUTHORIZED_RESOURCE = /status of 401/;
export const NOT_FOUND_RESOURCE = /status of 404/;

export function inviteLink(baseUrl, inviteToken) {
  return `${new URL(baseUrl).origin}/#join=${inviteToken}`;
}

export function isPost(path) {
  return (response) => new URL(response.url()).pathname === path && response.request().method() === 'POST';
}

export async function enterAsOwner(person) {
  await person.createRoom();
  await person.waitForChatOnline();
  await person.setName(person.displayName);
}

export async function enterWithLink(person, link) {
  await person.openInvite(link);
  await person.waitForChatOnline();
  await person.setName(person.displayName);
}

// Enlace con la invitacion que muestra ahora quien creo la sala (cambia al renovarla).
export async function currentInviteLink({ ana, baseUrl }) {
  return inviteLink(baseUrl, await ana.inviteToken());
}

// Espera a que la invitacion mostrada deje de ser la anterior.
export async function waitForNewInvite(person, previousToken) {
  await person.page.waitForFunction(
    (previous) => {
      const shown = document.querySelector('#invite-code')?.textContent.trim();
      return Boolean(shown) && shown !== previous;
    },
    previousToken,
    { polling: 20 },
  );
  return person.inviteToken();
}

export async function sessionStatus(person) {
  return person.page.evaluate(async () => {
    const response = await fetch('/session');
    return { status: response.status, body: response.ok ? await response.json() : null };
  });
}
