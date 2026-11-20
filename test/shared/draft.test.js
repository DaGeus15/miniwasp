import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateDraft, validateName } from '../../src/shared/draft.js';
import { MAX_NAME_LENGTH, MAX_TEXT_LENGTH } from '../../src/shared/limits.js';

describe('validateDraft', () => {
  it('quita los espacios sobrantes', () => {
    assert.deepEqual(validateDraft({ name: ' Ana ', text: ' hola ' }), {
      draft: { name: 'Ana', text: 'hola' },
    });
  });

  it('rechaza campos vacios', () => {
    assert.equal(validateDraft({ name: '  ', text: 'hola' }).errorKey, 'nameRequired');
    assert.equal(validateDraft({ name: 'Ana', text: '  ' }).errorKey, 'textRequired');
  });

  it('con un adjunto el texto puede quedar vacio pero no superar el limite', () => {
    const options = { isTextOptional: true };

    assert.deepEqual(validateDraft({ name: 'Ana', text: '  ' }, options), { draft: { name: 'Ana', text: '' } });
    assert.equal(validateDraft({ name: ' ', text: '' }, options).errorKey, 'nameRequired');
    assert.equal(validateDraft({ name: 'Ana', text: 'a'.repeat(MAX_TEXT_LENGTH + 1) }, options).errorKey, 'textTooLong');
  });

  it('rechaza textos que superan el limite', () => {
    const longName = 'a'.repeat(MAX_NAME_LENGTH + 1);
    const longText = 'a'.repeat(MAX_TEXT_LENGTH + 1);

    assert.equal(validateDraft({ name: longName, text: 'hola' }).errorKey, 'nameTooLong');
    assert.equal(validateDraft({ name: 'Ana', text: longText }).errorKey, 'textTooLong');
  });

  it('acepta textos justo en el limite', () => {
    const result = validateDraft({
      name: 'a'.repeat(MAX_NAME_LENGTH),
      text: 'a'.repeat(MAX_TEXT_LENGTH),
    });

    assert.equal(result.errorKey, undefined);
  });
});

describe('validateName', () => {
  it('devuelve el nombre sin espacios sobrantes', () => {
    assert.deepEqual(validateName('  Ana '), { name: 'Ana' });
  });

  it('rechaza nombres vacios o demasiado largos', () => {
    assert.deepEqual(validateName('   '), { errorKey: 'nameRequired' });
    assert.deepEqual(validateName('a'.repeat(MAX_NAME_LENGTH + 1)), { errorKey: 'nameTooLong' });
  });
});
