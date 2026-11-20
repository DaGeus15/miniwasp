// Reduce un texto a formas comparables para que las evasiones tipicas no escondan un termino:
// mayusculas, acentos, caracteres invisibles, leetspeak, letras repetidas y separadores.

// Sustituciones leetspeak; solo se aplican a palabras que mezclan letras y simbolos.
const LEET_MAP = new Map([
  ['4', 'a'],
  ['3', 'e'],
  ['1', 'i'],
  ['0', 'o'],
  ['5', 's'],
  ['7', 't'],
  ['@', 'a'],
  ['$', 's'],
]);
const LEET_CHARACTERS = /[431057@$]/g;
const DIGITS_ONLY = /^\d+$/;
const WHITESPACE = /\s+/u;
const NON_WORD = /[^\p{L}\d]+/u;
const NON_LETTER = /[^\p{L}]/gu;
// Formatos invisibles (ancho cero, marcas de direccion) y marcas diacriticas.
const FORMAT_CHARACTERS = /\p{Cf}/gu;
const COMBINING_MARKS = /\p{M}/gu;
const REPEATED_LETTER = /(\p{L})\1{2,}/gu;
// La enie distingue palabras ("niña" frente al nombre "Nina"), por eso sobrevive al quitar acentos.
const ENIE = 'ñ';
const ENIE_PLACEHOLDER = String.fromCodePoint(0xe000);
const MIN_SPELLED_RUN = 3;

function stripMarks(text) {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replaceAll(ENIE, ENIE_PLACEHOLDER)
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(FORMAT_CHARACTERS, '')
    .replaceAll(ENIE_PLACEHOLDER, ENIE);
}

function collapseRepeats(word) {
  return word.replace(REPEATED_LETTER, '$1');
}

function decodeLeet(chunk) {
  if (DIGITS_ONLY.test(chunk)) {
    return chunk;
  }
  return chunk.replace(LEET_CHARACTERS, (character) => LEET_MAP.get(character));
}

function splitWords(text) {
  return text.split(NON_WORD).filter(Boolean).map(collapseRepeats);
}

// "p o r n o" deletreado letra a letra se recompone en una palabra adicional.
function joinSpelledRuns(tokens) {
  const joined = [];
  let run = [];
  for (const token of [...tokens, '']) {
    if (token.length === 1) {
      run.push(token);
      continue;
    }
    if (run.length >= MIN_SPELLED_RUN) {
      joined.push(run.join(''));
    }
    run = [];
  }
  return joined;
}

function maskPhrases(tokens, exemptPhrases) {
  let text = ` ${tokens.join(' ')} `;
  for (const phrase of exemptPhrases) {
    text = text.replaceAll(` ${phrase} `, ' ');
  }
  return text.split(' ').filter(Boolean);
}

// Normaliza un termino del diccionario igual que el texto, sin leetspeak (los terminos ya son limpios).
export function normalizeTerm(term) {
  return splitWords(stripMarks(term)).join(' ');
}

/**
 * Devuelve las formas que compara el moderador:
 * - tokens: palabras tras leetspeak, sin las frases exentas.
 * - spelled: palabras deletreadas letra a letra ya recompuestas.
 * - rawTokens: palabras sin leetspeak (conservan numeros como "ak47" o "13").
 * - compact: solo letras, todo junto; solo se compara con terminos largos e inequivocos.
 */
export function normalizeText(text, { exemptPhrases = [] } = {}) {
  const stripped = stripMarks(String(text));
  const rawTokens = maskPhrases(splitWords(stripped), exemptPhrases);
  const decoded = stripped.split(WHITESPACE).map(decodeLeet).join(' ');
  const tokens = maskPhrases(splitWords(decoded), exemptPhrases);
  const compact = collapseRepeats(tokens.join('').replace(NON_LETTER, ''));
  return Object.freeze({
    tokens: Object.freeze(tokens),
    spelled: Object.freeze(joinSpelledRuns(tokens)),
    rawTokens: Object.freeze(rawTokens),
    compact,
  });
}
