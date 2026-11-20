import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTerm, normalizeText } from '../../../src/server/moderation/text-normalizer.js';

// Se construyen con su codigo para que el archivo no contenga caracteres invisibles.
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);
const COMBINING_TILDE = String.fromCodePoint(0x303);

describe('normalizeText: evasiones', () => {
  it('ignora mayusculas, acentos y variantes de ancho completo', () => {
    assert.deepEqual(normalizeText('PORNOGRAFÍA Ｐｏｒｎｏ').tokens, ['pornografia', 'porno']);
  });

  it('quita caracteres invisibles de ancho cero y de direccion', () => {
    assert.deepEqual(normalizeText(`por${ZERO_WIDTH_SPACE}no se${RIGHT_TO_LEFT_OVERRIDE}xo${BYTE_ORDER_MARK}`).tokens, ['porno', 'sexo']);
  });

  it('traduce leetspeak en palabras que mezclan letras y simbolos', () => {
    assert.deepEqual(normalizeText('p0rn0 $3x0 4n@l 7e1a').tokens, ['porno', 'sexo', 'anal', 'teia']);
  });

  it('respeta los numeros puros para poder leer edades', () => {
    const normalized = normalizeText('tengo 13 años');

    assert.deepEqual(normalized.tokens, ['tengo', '13', 'años']);
    assert.deepEqual(normalized.rawTokens, ['tengo', '13', 'años']);
  });

  it('reduce letras repetidas tres o mas veces pero respeta las dobles', () => {
    assert.deepEqual(normalizeText('poooorrrrnooo lluvia').tokens, ['porno', 'lluvia']);
  });

  it('recompone palabras deletreadas letra a letra con cualquier separador', () => {
    assert.deepEqual(normalizeText('p.o.r.n.o').spelled, ['porno']);
    assert.deepEqual(normalizeText('mira s e x o ya').spelled, ['sexo']);
    assert.deepEqual(normalizeText('y o').spelled, []);
  });

  it('el compacto junta solo letras y vuelve a reducir repeticiones', () => {
    assert.equal(normalizeText('p-o-r-n-o-g-r-a-f-í-a 33').compact, 'pornografia');
    assert.equal(normalizeText('ab  b b').compact, 'ab');
  });
});

describe('normalizeText: formas sin leetspeak', () => {
  it('conserva los terminos con digitos como "ak47"', () => {
    const normalized = normalizeText('vendo AK47');

    assert.deepEqual(normalized.rawTokens, ['vendo', 'ak47']);
    assert.deepEqual(normalized.tokens, ['vendo', 'akat']);
  });

  it('conserva la enie para no confundir "niña" con el nombre "Nina"', () => {
    assert.deepEqual(normalizeText(`NIÑA Nina nin${COMBINING_TILDE}a`).tokens, ['niña', 'nina', 'niña']);
  });
});

describe('normalizeText: frases exentas', () => {
  it('retira frases exentas de las palabras, de las formas crudas y del compacto', () => {
    const normalized = normalizeText('Vendo COCA-COLA fría', { exemptPhrases: ['coca cola'] });

    assert.deepEqual(normalized.tokens, ['vendo', 'fria']);
    assert.deepEqual(normalized.rawTokens, ['vendo', 'fria']);
    assert.equal(normalized.compact, 'vendofria');
  });

  it('solo retira frases completas, no fragmentos de palabras', () => {
    const normalized = normalizeText('cocacolas', { exemptPhrases: ['coca cola'] });

    assert.deepEqual(normalized.tokens, ['cocacolas']);
  });

  it('sin opciones no retira nada y acepta valores que no son texto', () => {
    assert.deepEqual(normalizeText(42).tokens, ['42']);
    assert.deepEqual(normalizeText('').tokens, []);
  });

  it('devuelve resultados inmutables', () => {
    const normalized = normalizeText('hola');

    assert.ok(Object.isFrozen(normalized));
    assert.ok(Object.isFrozen(normalized.tokens));
    assert.ok(Object.isFrozen(normalized.spelled));
    assert.ok(Object.isFrozen(normalized.rawTokens));
  });
});

describe('normalizeTerm', () => {
  it('normaliza terminos del diccionario sin aplicar leetspeak', () => {
    assert.equal(normalizeTerm('Pornografía  Infantil'), 'pornografia infantil');
    assert.equal(normalizeTerm('ak47'), 'ak47');
    assert.equal(normalizeTerm('Niña'), 'niña');
  });
});
