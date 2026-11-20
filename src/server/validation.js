import { MAX_NAME_LENGTH, MAX_ROOM_TITLE_LENGTH } from '../shared/limits.js';

// Incluye controles y marcas invisibles de direccion, usadas para falsificar nombres.
const FORBIDDEN_NAME_CHARACTERS = /\p{C}/u;

// Solo estos errores tienen mensajes pensados para mostrarse al usuario.
export class ValidationError extends Error {
  name = 'ValidationError';
}

export function requireText(value, maxLength, fieldName) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} debe ser texto`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`${fieldName} no puede estar vacio`);
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${fieldName} supera ${maxLength} caracteres`);
  }
  return trimmed;
}

// NFKC unifica variantes visuales de un caracter para que no se usen como otro nombre.
function requireDisplayText(value, maxLength, fieldName) {
  const text = requireText(value, maxLength, fieldName).normalize('NFKC');
  if (FORBIDDEN_NAME_CHARACTERS.test(text)) {
    throw new ValidationError(`${fieldName} contiene caracteres no permitidos`);
  }
  return text;
}

export function requireName(value) {
  return requireDisplayText(value, MAX_NAME_LENGTH, 'El nombre');
}

// El titulo de una sala publica lo ve cualquiera en la portada.
export function requireRoomTitle(value) {
  return requireDisplayText(value, MAX_ROOM_TITLE_LENGTH, 'El título');
}
