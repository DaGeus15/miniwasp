import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveSecurityCode, extractFingerprint } from '../../src/client/calls/security-code.js';

const ANA_FINGERPRINT = 'sha-256 AA:BB:CC:DD';
const LUIS_FINGERPRINT = 'sha-256 11:22:33:44';
const ATTACKER_FINGERPRINT = 'sha-256 EE:EE:EE:EE';

function sdpWith(fingerprint) {
  return ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', `a=fingerprint:${fingerprint}`, 'a=setup:actpass', ''].join(
    '\r\n',
  );
}

describe('extractFingerprint', () => {
  it('lee la huella DTLS de la descripcion', () => {
    assert.equal(extractFingerprint(sdpWith(ANA_FINGERPRINT)), ANA_FINGERPRINT);
  });

  it('devuelve null si no hay huella o no hay descripcion', () => {
    assert.equal(extractFingerprint('v=0\r\n'), null);
    assert.equal(extractFingerprint(undefined), null);
  });
});

describe('deriveSecurityCode', () => {
  it('produce doce digitos en cuatro grupos', async () => {
    const code = await deriveSecurityCode(sdpWith(ANA_FINGERPRINT), sdpWith(LUIS_FINGERPRINT));

    assert.match(code, /^\d{3} \d{3} \d{3} \d{3}$/);
  });

  it('ambas personas calculan el mismo codigo', async () => {
    const anaCode = await deriveSecurityCode(sdpWith(ANA_FINGERPRINT), sdpWith(LUIS_FINGERPRINT));
    const luisCode = await deriveSecurityCode(sdpWith(LUIS_FINGERPRINT), sdpWith(ANA_FINGERPRINT));

    assert.equal(anaCode, luisCode);
  });

  it('los codigos no coinciden si el servidor sustituye una huella', async () => {
    const anaCode = await deriveSecurityCode(sdpWith(ANA_FINGERPRINT), sdpWith(ATTACKER_FINGERPRINT));
    const luisCode = await deriveSecurityCode(
      sdpWith(LUIS_FINGERPRINT),
      sdpWith(ATTACKER_FINGERPRINT),
    );

    assert.notEqual(anaCode, luisCode);
  });

  it('no inventa un codigo si falta alguna huella', async () => {
    assert.equal(await deriveSecurityCode(sdpWith(ANA_FINGERPRINT), 'v=0\r\n'), null);
    assert.equal(await deriveSecurityCode(undefined, sdpWith(ANA_FINGERPRINT)), null);
  });

  it('completa con ceros los codigos pequenos', async () => {
    const zeroDigest = { digest: async () => new ArrayBuffer(32) };

    const code = await deriveSecurityCode(
      sdpWith(ANA_FINGERPRINT),
      sdpWith(LUIS_FINGERPRINT),
      zeroDigest,
    );

    assert.equal(code, '000 000 000 000');
  });
});
