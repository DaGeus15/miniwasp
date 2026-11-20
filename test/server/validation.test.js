import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError, requireName, requireText } from '../../src/server/validation.js';
import { MAX_NAME_LENGTH } from '../../src/shared/limits.js';

describe('requireText', () => {
  it('explica cada rechazo nombrando el campo', () => {
    assert.throws(() => requireText(5, 10, 'El mensaje'), { message: 'El mensaje debe ser texto' });
    assert.throws(() => requireText('   ', 10, 'El mensaje'), {
      message: 'El mensaje no puede estar vacio',
    });
    assert.throws(() => requireText('a'.repeat(11), 10, 'El mensaje'), {
      message: 'El mensaje supera 10 caracteres',
    });
  });

  it('sus errores se identifican como errores de validacion para mostrarlos al usuario', () => {
    const error = new ValidationError('detalle');

    assert.ok(error instanceof Error);
    assert.equal(error.name, 'ValidationError');
  });
});

describe('requireName: limites', () => {
  it('acepta un nombre justo en el limite y rechaza uno mas largo', () => {
    const longest = 'a'.repeat(MAX_NAME_LENGTH);

    assert.equal(requireName(longest), longest);
    assert.throws(() => requireName(`${longest}a`), {
      name: 'ValidationError',
      message: `El nombre supera ${MAX_NAME_LENGTH} caracteres`,
    });
  });

  it('explica por que rechaza caracteres invisibles', () => {
    assert.throws(() => requireName('Ana\u202E'), {
      name: 'ValidationError',
      message: 'El nombre contiene caracteres no permitidos',
    });
  });
});
