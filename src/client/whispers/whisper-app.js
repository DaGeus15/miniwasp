import { ServerEvent } from '../../shared/events.js';
import { createStoredValue } from '../common/stored-value.js';
import { TEXTS } from '../common/texts.js';
import { WhisperController } from './whisper-controller.js';
import { WhisperView } from './whisper-view.js';

const PREFERENCE_STORAGE_KEY = 'miniwasp-accepts-whispers';

// Arma la funcion de susurros y devuelve como reacciona a los eventos del servidor.
export function createWhisperFeature({ document, send, notices, getName, getStorage, transfer }) {
  const view = new WhisperView(document, { incoming: TEXTS.whisperIncoming });
  const whispers = new WhisperController({
    send,
    view,
    notices,
    getName,
    preference: createStoredValue(getStorage, PREFERENCE_STORAGE_KEY),
    transfer,
  });
  view.onAccept(() => whispers.accept());
  view.onReject(() => whispers.reject());
  view.onPreferenceChange((acceptsWhispers) => whispers.setAcceptsWhispers(acceptsWhispers));

  return {
    invite: (peer) => whispers.invite(peer),
    eventHandlers: new Map([
      [ServerEvent.WELCOME, (event) => whispers.handleWelcome(event)],
      [ServerEvent.WHISPER_INCOMING, (event) => whispers.handleIncoming(event)],
      [ServerEvent.WHISPER_READY, (event) => whispers.handleReady(event)],
      [ServerEvent.WHISPER_ENDED, (event) => whispers.handleEnded(event)],
    ]),
  };
}
