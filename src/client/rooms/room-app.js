import { ServerEvent } from '../../shared/events.js';
import { TEXTS } from '../common/texts.js';
import { PresenceController } from '../presence/presence-controller.js';
import { PresenceView } from '../presence/presence-view.js';
import { RoomBarView } from './room-bar-view.js';
import { RoomController } from './room-controller.js';
import { RoomSignaling } from './room-signaling.js';

// Punto de composicion de la sala: participantes, invitacion y expulsiones.
export function createRoomFeature({ document, send, notices, textFor, getName, copyText, origin, onCallApproved, onWhisperRequested }) {
  const signaling = new RoomSignaling(send);
  const presenceView = new PresenceView(document);
  const roomBarView = new RoomBarView(document, { roomKind: TEXTS.roomKind });
  const presence = new PresenceController({ signaling, view: presenceView, notices, getName, onCallApproved });
  const room = new RoomController({ view: roomBarView, signaling, copyText, origin, textFor });

  presenceView.onCallRequest((peer) => presence.requestCall(peer));
  presenceView.onExpelRequest((peer) => presence.requestExpel(peer));
  presenceView.onWhisperRequest(onWhisperRequested);
  roomBarView.onCopy(() => room.copyInvite());
  roomBarView.onRotate(() => room.rotateInvite());

  return {
    eventHandlers: new Map([
      [
        ServerEvent.WELCOME,
        (event) => {
          room.handleWelcome(event);
          presence.handleWelcome(event);
        },
      ],
      [ServerEvent.PRESENCE, (event) => presence.handlePresence(event)],
      [ServerEvent.ROOM_INVITE, (event) => room.handleInvite(event)],
    ]),
    announceName: () => presence.announceName(),
    handleConnectionLost: () => presence.handleConnectionLost(),
  };
}
