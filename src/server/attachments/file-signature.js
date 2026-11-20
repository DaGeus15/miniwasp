import { findAttachmentType } from '../../shared/attachments.js';

const PLAIN_TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
// Controles permitidos en un texto plano: tabulador, salto de linea y retorno de carro.
const ALLOWED_CONTROL_CODES = new Set([0x09, 0x0a, 0x0d]);
const FIRST_PRINTABLE_CODE = 0x20;
const DELETE_CODE = 0x7f;

function isForbiddenControl(code) {
  return (code < FIRST_PRINTABLE_CODE && !ALLOWED_CONTROL_CODES.has(code)) || code === DELETE_CODE;
}

function hasBytesAt(bytes, offset, expected) {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(text) {
  return [...text].map((character) => character.codePointAt(0));
}

function isPlainText(bytes) {
  try {
    PLAIN_TEXT_DECODER.decode(bytes);
    return !bytes.some(isForbiddenControl);
  } catch {
    return false;
  }
}

// Firmas ("bytes magicos") de cada tipo aceptado, en orden de prueba. El texto plano va al
// final porque no tiene firma: se reconoce por ser UTF-8 valido sin caracteres de control.
const SIGNATURES = [
  ['image/jpeg', (bytes) => hasBytesAt(bytes, 0, [0xff, 0xd8, 0xff])],
  ['application/pdf', (bytes) => hasBytesAt(bytes, 0, ascii('%PDF-'))],
  ['audio/webm', (bytes) => hasBytesAt(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])],
  ['audio/ogg', (bytes) => hasBytesAt(bytes, 0, ascii('OggS'))],
  ['audio/mp4', (bytes) => hasBytesAt(bytes, 4, ascii('ftyp'))],
  ['text/plain', isPlainText],
];

// Identifica un archivo por su contenido. Devuelve su tipo aceptado o null si no es ninguno:
// un ejecutable renombrado como .jpg no tiene la firma de un JPEG y se rechaza.
export function detectFileType(bytes) {
  if (bytes.length === 0) {
    return null;
  }
  const signature = SIGNATURES.find(([, matches]) => matches(bytes));
  return signature ? findAttachmentType(signature[0]) : null;
}
