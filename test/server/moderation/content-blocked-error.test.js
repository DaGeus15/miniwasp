import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ContentBlockedError } from '../../../src/server/moderation/content-blocked-error.js';
import { ModerationCategory } from '../../../src/server/moderation/text-moderator.js';
import { ValidationError } from '../../../src/server/validation.js';

describe('ContentBlockedError', () => {
  it('es un error de validacion que explica el motivo y conserva la categoria', () => {
    const error = new ContentBlockedError(ModerationCategory.HATE);

    assert.ok(error instanceof ValidationError);
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'ContentBlockedError');
    assert.equal(error.category, ModerationCategory.HATE);
    assert.equal(error.message, 'No se envió: parece contener discurso de odio');
  });

  it('admite un mensaje propio', () => {
    const error = new ContentBlockedError(ModerationCategory.DRUG_SALES, 'Bloqueado');

    assert.equal(error.message, 'Bloqueado');
    assert.equal(error.category, ModerationCategory.DRUG_SALES);
  });
});
