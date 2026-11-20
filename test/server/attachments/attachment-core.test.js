import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, MAX_FILE_NAME_LENGTH } from '../../../src/shared/attachments.js';
import { AttachmentError, AttachmentRefusal } from '../../../src/server/attachments/attachment-error.js';
import { Attachment } from '../../../src/server/attachments/attachment.js';
import { sanitizeFileName } from '../../../src/server/attachments/file-name.js';
import { detectFileType } from '../../../src/server/attachments/file-signature.js';
import { MemoryBlobStorage } from '../../../src/server/attachments/memory-blob-storage.js';
import { RoomCipher } from '../../../src/server/attachments/room-cipher.js';
import { UploadGate } from '../../../src/server/attachments/upload-gate.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF = Buffer.from('%PDF-1.7\n...');
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]);
const OGG = Buffer.from('OggS\u0000\u0002');
const M4A = Buffer.from([0, 0, 0, 0x20, ...Buffer.from('ftypM4A ')]);
const WINDOWS_EXECUTABLE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);

describe('detectFileType', () => {
  it('reconoce cada tipo aceptado por su contenido', () => {
    assert.equal(detectFileType(JPEG).mimeType, 'image/jpeg');
    assert.equal(detectFileType(PDF).mimeType, 'application/pdf');
    assert.equal(detectFileType(WEBM).mimeType, 'audio/webm');
    assert.equal(detectFileType(OGG).mimeType, 'audio/ogg');
    assert.equal(detectFileType(M4A).mimeType, 'audio/mp4');
    assert.equal(detectFileType(Buffer.from('hola\tmundo\r\nñandú')).mimeType, 'text/plain');
  });

  it('rechaza un ejecutable aunque venga renombrado y lo que no es texto valido', () => {
    assert.equal(detectFileType(WINDOWS_EXECUTABLE), null);
    assert.equal(detectFileType(Buffer.from([0x68, 0x00, 0x69])), null);
    assert.equal(detectFileType(Buffer.from([0x68, 0x7f])), null);
    assert.equal(detectFileType(Buffer.from([0xc3, 0x28])), null);
    assert.equal(detectFileType(Buffer.alloc(0)), null);
  });

  it('un PNG o un GIF no se aceptan: el cliente convierte las fotos a JPEG', () => {
    assert.equal(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), null);
    assert.equal(detectFileType(Buffer.from('GIF89a\u0001\u0000')), null);
  });

  it('el tope general cubre al tipo mas grande', () => {
    assert.equal(MAX_ATTACHMENT_BYTES, Math.max(...ATTACHMENT_TYPES.map((type) => type.maxBytes)));
  });
});

describe('sanitizeFileName', () => {
  it('fuerza la extension del tipo detectado y quita la ruta', () => {
    assert.equal(sanitizeFileName('C:\\fotos\\viaje.exe', 'jpg'), 'viaje.jpg');
    assert.equal(sanitizeFileName('../../etc/passwd', 'txt'), 'passwd.txt');
    assert.equal(sanitizeFileName('informe.final.pdf', 'pdf'), 'informe.final.pdf');
  });

  it('elimina marcas bidi, controles y caracteres reservados', () => {
    assert.equal(sanitizeFileName('factura\u202Egpj.exe', 'pdf'), 'facturagpj.pdf');
    assert.equal(sanitizeFileName('a<b>:"c|d?*\u0000.txt', 'txt'), 'abcd.txt');
  });

  it('usa un nombre por defecto si no queda nada y limita la longitud', () => {
    assert.equal(sanitizeFileName('...', 'pdf'), 'archivo.pdf');
    assert.equal(sanitizeFileName(undefined, 'jpg'), 'archivo.jpg');
    assert.equal(sanitizeFileName(' . nota . ', 'txt'), 'nota.txt');
    const longName = sanitizeFileName(`${'x'.repeat(200)}.pdf`, 'pdf');
    assert.equal(longName.length, MAX_FILE_NAME_LENGTH);
    assert.ok(longName.endsWith('.pdf'));
  });
});

describe('RoomCipher', () => {
  it('descifra lo que cifro con el mismo contexto', () => {
    const cipher = new RoomCipher();
    const sealed = cipher.seal(Buffer.from('foto'), 'sala:adjunto');

    assert.notDeepEqual(sealed.subarray(12, 16), Buffer.from('foto'));
    assert.equal(cipher.open(sealed, 'sala:adjunto').toString(), 'foto');
  });

  it('rechaza otra clave, otro contexto, un objeto alterado o una clave destruida', () => {
    const cipher = new RoomCipher();
    const sealed = cipher.seal(Buffer.from('foto'), 'sala:adjunto');
    const tampered = Buffer.from(sealed);
    tampered[14] ^= 1;

    assert.throws(() => new RoomCipher().open(sealed, 'sala:adjunto'));
    assert.throws(() => cipher.open(sealed, 'otra-sala:adjunto'));
    assert.throws(() => cipher.open(tampered, 'sala:adjunto'));
    cipher.destroy();
    assert.throws(() => cipher.open(sealed, 'sala:adjunto'));
  });
});

describe('MemoryBlobStorage', () => {
  it('guarda, lee, reemplaza y borra respetando su tope', async () => {
    const storage = new MemoryBlobStorage({ maxBytes: 10 });
    await storage.put('a', Buffer.from('12345'));
    await storage.put('a', Buffer.from('1234567'));

    assert.equal(storage.usedBytes, 7);
    assert.equal((await storage.get('a')).toString(), '1234567');
    await assert.rejects(storage.put('b', Buffer.from('1234')), AttachmentError);
    await storage.deleteMany(['a', 'no-existe']);
    assert.equal(storage.usedBytes, 0);
    await assert.rejects(storage.get('a'), (error) => error.refusal === AttachmentRefusal.NOT_FOUND);
  });
});

describe('UploadGate', () => {
  it('admite hasta el tope y liberar dos veces no descuadra la cuenta', () => {
    const gate = new UploadGate({ maxConcurrent: 2 });
    const first = gate.tryAcquire();
    const second = gate.tryAcquire();

    assert.equal(gate.tryAcquire(), null);
    first();
    first();
    assert.equal(gate.active, 1);
    assert.ok(gate.tryAcquire());
    second();
  });
});

describe('Attachment', () => {
  it('expone solo datos publicos y agrupa su clave por sala', () => {
    const attachment = new Attachment({
      roomId: 'sala',
      uploaderSessionId: 'sesion',
      type: ATTACHMENT_TYPES[0],
      fileName: 'foto.jpg',
      size: 3,
    });

    assert.deepEqual(Object.keys(attachment.toPublic()), ['id', 'kind', 'mimeType', 'fileName', 'size']);
    assert.equal(attachment.storageKey, `rooms/sala/${attachment.id}`);
    assert.equal(attachment.cipherContext, `sala:${attachment.id}`);
    assert.ok(Object.isFrozen(attachment));
  });
});
