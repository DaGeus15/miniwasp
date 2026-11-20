// Solo se admite un rango simple ("bytes=inicio-fin", "bytes=inicio-" o "bytes=-sufijo"):
// es lo que piden los navegadores para reproducir audio. Rangos multiples se ignoran.
const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

export const UNSATISFIABLE_RANGE = Object.freeze({ isSatisfiable: false });

function suffixRange(suffixLength, size) {
  return suffixLength === 0 ? UNSATISFIABLE_RANGE : { isSatisfiable: true, start: Math.max(size - suffixLength, 0), end: size - 1 };
}

// Devuelve null si no hay rango valido (se responde el archivo completo), UNSATISFIABLE_RANGE
// si el rango queda fuera del archivo (416), o { start, end } con ambos extremos incluidos.
export function parseByteRange(header, size) {
  const match = typeof header === 'string' ? SINGLE_RANGE.exec(header.trim()) : null;
  if (!match || (match[1] === '' && match[2] === '')) {
    return null;
  }
  if (match[1] === '') {
    return suffixRange(Number(match[2]), size);
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  return start <= end && start < size ? { isSatisfiable: true, start, end } : UNSATISFIABLE_RANGE;
}
