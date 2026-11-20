import { validateDraft } from '../../shared/draft.js';
import { ClientEvent, ServerEvent } from '../../shared/events.js';
import { parseServerEvent } from '../../shared/server-event.js';
import { createAttachmentFeature } from '../attachments/attachment-app.js';
import { AttachmentRenderer } from '../attachments/attachment-renderer.js';
import { createCallFeature } from '../calls/call-app.js';
import { createStoredValue } from '../common/stored-value.js';
import { TEXTS, textFor } from '../common/texts.js';
import { HomeView } from '../rooms/home-view.js';
import { readInviteFromHash } from '../rooms/invite-link.js';
import { RoomAccess } from '../rooms/room-access.js';
import { PublicRoomsView } from '../rooms/public-rooms-view.js';
import { createRoomFeature } from '../rooms/room-app.js';
import { RoomClient } from '../rooms/room-client.js';
import { createWhisperFeature } from '../whispers/whisper-app.js';
import { ChatView, MessageAction } from './chat-view.js';
import { ServerConnection, socketUrl } from './connection.js';
import { createNameStore } from './name-store.js';

// Varias funciones pueden reaccionar al mismo evento (por ejemplo, la bienvenida).
function mergeEventHandlers(...handlerMaps) {
  const merged = new Map();
  for (const [type, handler] of handlerMaps.flatMap((handlers) => [...handlers])) {
    const previous = merged.get(type);
    merged.set(type, previous ? (event) => (previous(event), handler(event)) : handler);
  }
  return merged;
}

const RULES_STORAGE_KEY = 'miniwasp-rules-accepted';
const RULES_ACCEPTED = 'si';
const MESSAGE_ACTION_EVENTS = new Map([
  [MessageAction.DELETE, ClientEvent.MESSAGE_DELETE],
  [MessageAction.REPORT, ClientEvent.MESSAGE_REPORT],
]);

function createChatHandlers(view, attachments) {
  return new Map([
    [ServerEvent.HISTORY, (event) => view.showHistory(event.messages)],
    [ServerEvent.MESSAGE, (event) => view.addMessage(event.message)],
    [ServerEvent.MESSAGE_DELETED, (event) => view.removeMessage(event.messageId)],
    [ServerEvent.MESSAGE_REPORTED, (event) => view.markReported(event.messageId, event.reports)],
    [
      ServerEvent.WELCOME,
      (event) => {
        view.setOwner(event.isOwner);
        view.setRoomKind(event.visibility);
        attachments.restrictToReviewable(event.visibility !== 'private');
      },
    ],
    [ServerEvent.ERROR, (event) => view.showError(event.error)],
  ]);
}

function createChatView(document) {
  return new ChatView(document, {
    attachmentRenderer: new AttachmentRenderer(document),
    actionLabels: new Map([
      [MessageAction.DELETE, TEXTS.deleteAction],
      [MessageAction.REPORT, TEXTS.reportAction],
    ]),
  });
}

function createNotices(view) {
  return {
    show: (key) => view.showError(textFor(key)),
    showText: (text) => view.showError(text ?? TEXTS.attachmentFailed),
    clear: () => view.clearError(),
  };
}

function createEventDispatcher(view, eventHandlers) {
  return (data) => {
    const event = parseServerEvent(data);
    if (event) {
      eventHandlers.get(event.type)(event);
    } else {
      view.showError(TEXTS.invalidServerEvent);
    }
  };
}

function sendDraft({ view, connection, names }, draft, attachment) {
  const attachmentField = attachment ? { attachmentId: attachment.id } : {};
  if (connection.send({ type: ClientEvent.CHAT_MESSAGE, ...draft, ...attachmentField })) {
    names.save(draft.name);
    view.clearText();
  } else {
    view.showError(TEXTS.offline);
  }
}

// Con un archivo elegido, primero se sube y despues se envia el mensaje que lo comparte.
function bindComposer(chat, attachments) {
  chat.view.onSubmit(async (input) => {
    const { draft, errorKey } = validateDraft(input, { isTextOptional: attachments.hasPending });
    if (errorKey) {
      chat.view.showError(textFor(errorKey));
      return;
    }
    const attachment = attachments.hasPending ? await attachments.uploadPending() : null;
    if (attachment || !attachments.hasPending) {
      sendDraft(chat, draft, attachment);
    }
  });
}

function bindMessageActions({ view, send, notices }) {
  view.onMessageAction((action, messageId) => {
    send({ type: MESSAGE_ACTION_EVENTS.get(action), messageId });
    if (action === MessageAction.REPORT) {
      notices.show('reportSent');
    }
  });
}

function rememberRules(homeView, getStorage) {
  const rules = createStoredValue(getStorage, RULES_STORAGE_KEY);
  homeView.setRulesAccepted(rules.load() === RULES_ACCEPTED);
  homeView.onRulesChange((isAccepted) => rules.save(isAccepted ? RULES_ACCEPTED : ''));
}

// Lista de salas publicas de la portada: se carga al mostrar el inicio y al pedirlo.
function bindPublicRooms(document, client, access) {
  const view = new PublicRoomsView(document, {
    empty: TEXTS.publicRoomsEmpty,
    unavailable: TEXTS.publicRoomsUnavailable,
    members: TEXTS.publicRoomMembers,
    join: TEXTS.publicRoomJoin,
    joinLabel: TEXTS.publicRoomJoinLabel,
  });
  const refresh = async () => view.render(await client.listPublicRooms());
  view.onRefresh(refresh);
  view.onJoin((listingId) => access.joinPublic(listingId));
  view.onCreate((title) => access.createPublic(title));
  return refresh;
}

function createAccess({ document, request, connection, location, getStorage }) {
  const homeView = new HomeView(document);
  const client = new RoomClient(request);
  let refreshPublicRooms = async () => {};
  rememberRules(homeView, getStorage);
  const access = new RoomAccess({
    client,
    view: homeView,
    textFor,
    onEnter: () => connection.open(),
    onExit() {
      connection.stop();
      void refreshPublicRooms();
    },
    // Mudarse de sala (un susurro) reabre la conexion con la nueva sesion.
    onRoomChange() {
      connection.stop();
      connection.open();
    },
    takeInviteFromLink() {
      const inviteToken = readInviteFromHash(location.readHash());
      location.clearHash();
      return inviteToken;
    },
  });
  homeView.onCreate(() => access.create());
  homeView.onJoin((input) => access.join(input));
  refreshPublicRooms = bindPublicRooms(document, client, access);
  return { access, refreshPublicRooms };
}

function createFeatures({ document, view, notices, send, copyText, origin, media, whispers }) {
  const calls = createCallFeature({ document, send, notices, ...media });
  const room = createRoomFeature({
    document,
    send,
    notices,
    textFor,
    getName: () => view.getName(),
    copyText,
    origin,
    onCallApproved: (peer) => calls.startCall(peer),
    onWhisperRequested: (peer) => whispers.invite(peer),
  });
  return { calls, room };
}

function createConnection({ location, createSocket, schedule, view, eventHandlers, onReconnecting }) {
  return new ServerConnection({
    url: socketUrl(location),
    createSocket,
    schedule,
    onData: createEventDispatcher(view, eventHandlers),
    onStatus(statusKey) {
      view.showStatus(textFor(statusKey));
      if (statusKey === 'reconnecting') {
        onReconnecting();
      }
    },
  });
}

// Todas las funciones de la sala y como reaccionan juntas a los eventos del servidor.
function createRoomFeatures(context) {
  const { view, media, location } = context;
  const whispers = createWhisperFeature({
    ...context,
    getName: () => view.getName(),
    transfer: (token) => context.getAccess().transfer(token),
  });
  const attachments = createAttachmentFeature({ ...context, browser: media });
  const { calls, room } = createFeatures({ ...context, origin: location.origin, whispers });
  const eventHandlers = mergeEventHandlers(
    createChatHandlers(view, attachments),
    calls.eventHandlers,
    room.eventHandlers,
    whispers.eventHandlers,
  );
  return { attachments, calls, room, eventHandlers };
}

// Recibe sus dependencias del navegador como parametros para poder probarlo sin uno.
export async function startChat({ document, location, createSocket, schedule, getStorage, request, copyText, ...media }) {
  const view = createChatView(document);
  const notices = createNotices(view);
  const names = createNameStore(getStorage);
  const send = (payload) => connection.send(payload);
  const browser = { document, getStorage, request, schedule, copyText, location, media };
  const features = createRoomFeatures({ ...browser, view, notices, send, getAccess: () => access });
  const { eventHandlers } = features;
  const connection = createConnection({
    location,
    createSocket,
    schedule,
    view,
    eventHandlers,
    onReconnecting() {
      features.calls.handleConnectionLost();
      features.room.handleConnectionLost();
      // No se espera: la reconexion sigue en paralelo y verifySession nunca rechaza.
      void access.verifySession();
    },
  });
  const { access, refreshPublicRooms } = createAccess({ document, request, connection, location, getStorage });

  bindComposer({ view, connection, names }, features.attachments);
  bindMessageActions({ view, send, notices });
  view.onNameChange(() => features.room.announceName());
  view.onLogout(() => access.leave());
  view.setName(names.load());
  await Promise.all([access.start(), refreshPublicRooms()]);
}
