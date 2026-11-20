import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AttachmentClient, attachmentUrl } from '../../src/client/attachments/attachment-client.js';
import { AttachmentRenderer, formatFileSize } from '../../src/client/attachments/attachment-renderer.js';
import { ImagePreparer } from '../../src/client/attachments/image-preparer.js';
import { formatDuration } from '../../src/client/attachments/voice-recorder-view.js';
import { VoiceRecorder, VoiceRecordingUnsupportedError } from '../../src/client/attachments/voice-recorder.js';
import { TEXTS } from '../../src/client/common/texts.js';
import { ClientEvent, ServerEvent } from '../../src/shared/events.js';
import { startTestApp } from '../support/app-harness.js';
import { createPage } from '../support/page.js';

const ATTACHMENT = {
  id: '11111111-2222-4333-8444-555555555555',
  kind: 'document',
  mimeType: 'application/pdf',
  fileName: 'informe.pdf',
  size: 2048,
};

function flushPromises() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function message(fields = {}) {
  return { id: 'm1', name: 'Luis', text: '', time: new Date().toISOString(), ...fields };
}

function chooseFile(app, file) {
  const input = app.document.querySelector('#file-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new app.window.Event('change'));
}

async function startInRoom(options) {
  const app = await startTestApp({ savedName: 'Ana', ...options });
  app.socket.simulateOpen();
  return app;
}

describe('AttachmentClient', () => {
  it('sube el archivo en binario con su nombre codificado', async () => {
    const calls = [];
    const client = new AttachmentClient(async (path, options) => {
      calls.push({ path, options });
      return { status: 201, json: async () => ATTACHMENT };
    });

    const result = await client.upload(new Blob(['%PDF-']), 'informe ñ.pdf');

    assert.deepEqual(result, { attachment: ATTACHMENT });
    assert.equal(calls[0].path, '/rooms/attachments');
    assert.equal(calls[0].options.headers['X-File-Name'], 'informe%20%C3%B1.pdf');
    assert.equal(attachmentUrl('a/b'), '/rooms/attachments/a%2Fb');
  });

  it('devuelve el mensaje del servidor, o null si no hubo respuesta util', async () => {
    const answering = (body) => new AttachmentClient(async () => ({ status: 422, json: async () => body }));

    assert.deepEqual(await answering({ error: 'Bloqueado' }).upload(new Blob([]), 'a'), { error: 'Bloqueado' });
    assert.deepEqual(await answering({ error: 5 }).upload(new Blob([]), 'a'), { error: null });
    const broken = new AttachmentClient(async () => ({ status: 500, json: async () => JSON.parse('{') }));
    assert.deepEqual(await broken.upload(new Blob([]), 'a'), { error: null });
    const offline = new AttachmentClient(async () => Promise.reject(new Error('sin red')));
    assert.deepEqual(await offline.upload(new Blob([]), 'a'), { error: null });
  });
});

describe('ImagePreparer', () => {
  function createCanvasFake(blob) {
    const canvas = {
      drawn: null,
      getContext: () => ({ drawImage: (...args) => (canvas.drawn = args) }),
      toBlob: (callback, type, quality) => {
        canvas.encoded = { type, quality };
        callback(blob);
      },
    };
    return canvas;
  }

  it('reduce la foto al lado maximo y la convierte a JPEG', async () => {
    const canvas = createCanvasFake(new Blob(['jpeg']));
    let closed = false;
    const preparer = new ImagePreparer({
      createImageBitmap: async () => ({ width: 3200, height: 1600, close: () => (closed = true) }),
      createCanvas: () => canvas,
    });

    const result = await preparer.prepare({ name: 'playa.png' });

    assert.equal(result.fileName, 'playa.jpg');
    assert.deepEqual([canvas.width, canvas.height], [1600, 800]);
    assert.deepEqual(canvas.encoded, { type: 'image/jpeg', quality: 0.85 });
    assert.equal(closed, true);
  });

  it('no agranda fotos pequeñas y falla si el navegador no puede codificar', async () => {
    const canvas = createCanvasFake(null);
    const preparer = new ImagePreparer({
      createImageBitmap: async () => ({ width: 40, height: 30 }),
      createCanvas: () => canvas,
    });

    await assert.rejects(preparer.prepare({ name: 'foto' }), /No se pudo preparar/);
    assert.deepEqual([canvas.width, canvas.height], [40, 30]);
  });
});

describe('VoiceRecorder', () => {
  function createRecorderFakes({ supported = ['audio/webm;codecs=opus'] } = {}) {
    const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
    const scheduled = [];
    const recorders = [];
    const recorder = new VoiceRecorder({
      getUserMedia: async () => ({ getTracks: () => tracks }),
      createMediaRecorder: (stream, options) => {
        const fake = new EventTarget();
        fake.options = options;
        fake.start = () => fake.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob(['voz']) }));
        fake.stop = () => fake.dispatchEvent(new Event('stop'));
        recorders.push(fake);
        return fake;
      },
      isTypeSupported: (type) => supported.includes(type),
      schedule: (callback, delayMs) => scheduled.push({ callback, delayMs }),
    });
    return { recorder, tracks, scheduled, recorders };
  }

  it('graba en el primer formato disponible y apaga el microfono al terminar', async () => {
    const { recorder, tracks, recorders } = createRecorderFakes({ supported: ['audio/mp4'] });
    await recorder.start();

    const { blob, fileName } = await recorder.stop();

    assert.equal(recorders[0].options.mimeType, 'audio/mp4');
    assert.equal(fileName, 'nota-de-voz.m4a');
    assert.equal(blob.type, 'audio/mp4');
    assert.equal(tracks[0].stopped, true);
    assert.equal(recorder.isRecording, false);
  });

  it('avisa al llegar al limite solo si sigue la misma grabacion, y cancelar descarta', async () => {
    const { recorder, scheduled, tracks } = createRecorderFakes();
    let limits = 0;
    await recorder.start({ onLimit: () => (limits += 1) });
    scheduled[0].callback();
    recorder.cancel();
    scheduled[0].callback();
    recorder.cancel();

    assert.equal(limits, 1);
    assert.equal(scheduled[0].delayMs, 120000);
    assert.equal(tracks[0].stopped, true);
  });

  it('informa si el navegador no puede grabar', async () => {
    const { recorder } = createRecorderFakes({ supported: [] });

    await assert.rejects(recorder.start(), VoiceRecordingUnsupportedError);
  });
});

describe('AttachmentRenderer', () => {
  it('dibuja fotos, audios y documentos sin interpretar HTML', () => {
    const { document } = createPage();
    const renderer = new AttachmentRenderer(document);
    const url = `/rooms/attachments/${ATTACHMENT.id}`;

    const image = renderer.render(message({ name: '<b>Luis</b>', attachment: { ...ATTACHMENT, kind: 'image' } }));
    const audio = renderer.render(message({ attachment: { ...ATTACHMENT, kind: 'audio' } }));
    const file = renderer.render(message({ attachment: { ...ATTACHMENT, fileName: '<img src=x>.pdf' } }));

    assert.equal(image.querySelector('img').getAttribute('src'), url);
    assert.equal(image.querySelector('img').alt, 'Foto enviada por <b>Luis</b>');
    assert.equal(image.rel, 'noopener noreferrer');
    assert.equal(audio.getAttribute('src'), url);
    assert.equal(audio.controls, true);
    assert.equal(file.querySelector('.message-file-name').textContent, '<img src=x>.pdf');
    assert.equal(file.querySelector('img'), null);
    assert.equal(file.getAttribute('download'), '<img src=x>.pdf');
  });

  it('formatea tamaños y duraciones', () => {
    assert.equal(formatFileSize(10), '1 KB');
    assert.equal(formatFileSize(2048), '2 KB');
    assert.equal(formatFileSize(1.5 * 1024 * 1024), '1,5 MB');
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(125), '2:05');
  });
});

describe('adjuntos en la app', () => {
  it('sube el archivo elegido y envia el mensaje con el adjunto y su pie', async () => {
    const app = await startInRoom();
    app.server.upload.body = ATTACHMENT;
    chooseFile(app, new app.window.File(['%PDF-'], 'informe.pdf', { type: 'application/pdf' }));

    assert.equal(app.document.querySelector('#attachment-chip').hidden, false);
    app.textInput.value = 'mira esto';
    app.document.querySelector('#composer').requestSubmit();
    await flushPromises();
    await flushPromises();

    assert.equal(app.requests.at(-1).path, '/rooms/attachments');
    assert.deepEqual(JSON.parse(app.socket.sent.at(-1)), {
      type: ClientEvent.CHAT_MESSAGE,
      name: 'Ana',
      text: 'mira esto',
      attachmentId: ATTACHMENT.id,
    });
    assert.equal(app.document.querySelector('#attachment-chip').hidden, true);
  });

  it('si el servidor rechaza el archivo muestra su motivo y no envia nada', async () => {
    const app = await startInRoom();
    app.server.upload = { status: 422, body: { error: 'No se envió: contenido no permitido' } };
    chooseFile(app, new app.window.File(['texto'], 'nota.txt', { type: 'text/plain' }));
    const sentBefore = app.socket.sent.length;

    app.document.querySelector('#composer').requestSubmit();
    await flushPromises();
    await flushPromises();

    assert.equal(app.errorLabel.textContent, 'No se envió: contenido no permitido');
    assert.equal(app.socket.sent.length, sentBefore);
    assert.equal(app.document.querySelector('#attachment-chip').hidden, false);
  });

  it('rechaza archivos demasiado grandes sin subirlos y permite quitar el elegido', async () => {
    const app = await startInRoom();
    const huge = new app.window.File(['x'], 'grande.pdf', { type: 'application/pdf' });
    Object.defineProperty(huge, 'size', { value: 50 * 1024 * 1024 });

    chooseFile(app, huge);
    assert.equal(app.errorLabel.textContent, TEXTS.attachmentTooLarge);
    chooseFile(app, new app.window.File(['%PDF-'], 'ok.pdf', { type: 'application/pdf' }));
    app.document.querySelector('#attachment-remove').click();

    assert.equal(app.document.querySelector('#attachment-chip').hidden, true);
  });

  it('muestra los adjuntos recibidos, borra y reporta mensajes', async () => {
    const app = await startInRoom();
    app.socket.simulateData(JSON.stringify({ type: ServerEvent.MESSAGE, message: message({ attachment: ATTACHMENT }) }));
    const item = app.document.querySelector('[data-message-id="m1"]');

    assert.equal(item.querySelector('.message-file-name').textContent, 'informe.pdf');
    item.querySelector('[data-action="report"]').click();
    assert.deepEqual(JSON.parse(app.socket.sent.at(-1)), { type: ClientEvent.MESSAGE_REPORT, messageId: 'm1' });
    assert.equal(app.errorLabel.textContent, TEXTS.reportSent);
    item.querySelector('[data-action="delete"]').click();
    assert.deepEqual(JSON.parse(app.socket.sent.at(-1)), { type: ClientEvent.MESSAGE_DELETE, messageId: 'm1' });

    app.socket.simulateData(JSON.stringify({ type: ServerEvent.MESSAGE_REPORTED, messageId: 'm1', reports: 2 }));
    assert.equal(item.dataset.reports, '2');
    assert.ok(item.classList.contains('message-reported'));
    app.socket.simulateData(JSON.stringify({ type: ServerEvent.MESSAGE_DELETED, messageId: 'm1' }));
    assert.equal(app.document.querySelector('[data-message-id="m1"]'), null);
  });

  it('quien creo la sala puede borrar cualquier mensaje', async () => {
    const app = await startInRoom();
    app.socket.simulateData(
      JSON.stringify({ type: ServerEvent.WELCOME, peerId: 'yo', peers: [], iceServers: [], inviteToken: 'x'.repeat(22), isOwner: true, visibility: 'private', title: null }),
    );

    assert.ok(app.document.querySelector('#messages').classList.contains('messages-owner'));
  });
});
