import { MAX_FILE_NAME_LENGTH } from '../../shared/attachments.js';

const DEFAULT_BASE_NAME = 'archivo';
// Controles, formato (incluye las marcas bidi como U+202E) y caracteres reservados en sistemas
// de archivos. Una marca bidi (U+202E) permite disfrazar un ".exe" como si fuera un ".jpg".
const UNSAFE_CHARACTERS = /[\p{C}<>:"/\\|?*]/gu;
const EDGE_CHARACTERS = new Set(['.', ' ', '\t']);

function lastPathSegment(rawName) {
  return rawName.split(/[/\\]/).pop();
}

// Quita puntos y espacios de los extremos (".." o "  " no son nombres validos).
function trimEdges(name) {
  const characters = [...name];
  while (characters.length > 0 && EDGE_CHARACTERS.has(characters[0])) {
    characters.shift();
  }
  while (characters.length > 0 && EDGE_CHARACTERS.has(characters.at(-1))) {
    characters.pop();
  }
  return characters.join('');
}

function withoutExtension(name) {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
}

// Nombre seguro para mostrar y descargar. La extension siempre es la del tipo detectado por
// contenido, nunca la que trae el nombre original.
export function sanitizeFileName(rawName, extension) {
  const text = typeof rawName === 'string' ? rawName : '';
  const baseName = trimEdges(withoutExtension(lastPathSegment(text).normalize('NFKC')).replaceAll(UNSAFE_CHARACTERS, ''));
  const maxBaseLength = MAX_FILE_NAME_LENGTH - extension.length - 1;
  const safeBase = [...(baseName || DEFAULT_BASE_NAME)].slice(0, maxBaseLength).join('').trim();
  return `${safeBase || DEFAULT_BASE_NAME}.${extension}`;
}
