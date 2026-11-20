import { validateName } from '../../shared/draft.js';
import { ClientEvent } from '../../shared/events.js';
import { TEXTS, textFor } from '../common/texts.js';
import { AttachmentClient } from './attachment-client.js';
import { AttachmentComposer } from './attachment-composer.js';
import { AttachmentPickerView } from './attachment-picker-view.js';
import { ImagePreparer } from './image-preparer.js';
import { VoiceRecorder } from './voice-recorder.js';
import { VoiceRecorderView } from './voice-recorder-view.js';

function requireName(view) {
  const { name, errorKey } = validateName(view.getName());
  if (errorKey) {
    view.showError(textFor(errorKey));
  }
  return name ?? null;
}

// Arma la funcion de adjuntos: elegir archivos, grabar notas de voz y enviarlas.
export function createAttachmentFeature({ document, view, notices, request, schedule, send, browser }) {
  const voiceView = new VoiceRecorderView(document, { start: TEXTS.recordVoice, stop: TEXTS.stopVoice });
  const attachments = new AttachmentComposer({
    client: new AttachmentClient(request),
    preparer: new ImagePreparer(browser),
    recorder: new VoiceRecorder({
      getUserMedia: browser.getUserMedia,
      createMediaRecorder: browser.createMediaRecorder,
      isTypeSupported: browser.isRecordingTypeSupported,
      schedule,
    }),
    picker: new AttachmentPickerView(document),
    voiceView,
    notices,
    schedule,
    onVoiceNote: (attachment) => sendVoiceNote(view, send, attachment),
  });
  voiceView.onToggle(() => {
    if (attachments.isRecording || requireName(view)) {
      void attachments.toggleRecording();
    }
  });
  return attachments;
}

function sendVoiceNote(view, send, attachment) {
  const name = requireName(view);
  if (name) {
    send({ type: ClientEvent.CHAT_MESSAGE, name, text: '', attachmentId: attachment.id });
  }
}
