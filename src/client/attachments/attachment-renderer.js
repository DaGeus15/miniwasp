import { AttachmentKind } from '../../shared/attachments.js';
import { createTextElement } from '../common/dom.js';
import { attachmentUrl } from './attachment-client.js';

const KILOBYTE = 1024;
const MEGABYTE = KILOBYTE * KILOBYTE;

export function formatFileSize(bytes) {
  if (bytes >= MEGABYTE) {
    return `${(bytes / MEGABYTE).toFixed(1).replace('.', ',')} MB`;
  }
  return `${Math.max(1, Math.round(bytes / KILOBYTE))} KB`;
}

// Dibuja el adjunto de un mensaje. Todo se crea con createElement y textContent: ningun dato
// de otra persona se interpreta como HTML. La URL sale del id validado por el protocolo.
export class AttachmentRenderer {
  #document;
  #renderers;

  constructor(document) {
    this.#document = document;
    this.#renderers = new Map([
      [AttachmentKind.IMAGE, (attachment, message) => this.#image(attachment, message)],
      [AttachmentKind.AUDIO, (attachment) => this.#audio(attachment)],
      [AttachmentKind.DOCUMENT, (attachment) => this.#fileLink(attachment)],
    ]);
  }

  render(message) {
    return this.#renderers.get(message.attachment.kind)(message.attachment, message);
  }

  #image(attachment, message) {
    const link = this.#element('a', 'message-image-link');
    link.href = attachmentUrl(attachment.id);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const image = this.#element('img', 'message-image');
    image.src = link.href;
    image.alt = `Foto enviada por ${message.name}`;
    image.loading = 'lazy';
    image.decoding = 'async';
    link.append(image);
    return link;
  }

  #audio(attachment) {
    const audio = this.#element('audio', 'message-audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = attachmentUrl(attachment.id);
    audio.setAttribute('aria-label', 'Nota de voz');
    return audio;
  }

  #fileLink(attachment) {
    const link = this.#element('a', 'message-file');
    link.href = attachmentUrl(attachment.id);
    link.download = attachment.fileName;
    link.append(
      createTextElement(this.#document, 'span', 'message-file-name', attachment.fileName),
      createTextElement(this.#document, 'span', 'message-file-size', formatFileSize(attachment.size)),
    );
    return link;
  }

  #element(tag, className) {
    const element = this.#document.createElement(tag);
    element.className = className;
    return element;
  }
}
