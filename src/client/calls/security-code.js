const FINGERPRINT_LINE = /^a=fingerprint:(\S+ \S+)$/m;
// 12 digitos (unos 40 bits): quien intercepte tendria que generar del orden de un billon
// de certificados para que ambos codigos coincidan, inviable durante una llamada.
const CODE_DIGITS = 12;
const CODE_MODULUS = 10n ** BigInt(CODE_DIGITS);
const GROUP_PATTERN = /\d{3}/g;

// Comparacion por unidades de codigo, igual en todos los navegadores e idiomas: ambos
// lados deben ordenar las huellas exactamente de la misma forma.
function compareCodeUnits(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export function extractFingerprint(sdp) {
  return sdp?.match(FINGERPRINT_LINE)?.[1] ?? null;
}

function formatCode(value) {
  const digits = (value % CODE_MODULUS).toString().padStart(CODE_DIGITS, '0');
  return digits.match(GROUP_PATTERN).join(' ');
}

// Las dos personas ven el mismo codigo solo si cada una recibio la huella DTLS real de la
// otra. Si el servidor de senalizacion sustituyera una huella para interceptar el video,
// los codigos no coincidirian. Las huellas se ordenan para que ambos lados calculen igual.
export async function deriveSecurityCode(localSdp, remoteSdp, subtle = globalThis.crypto.subtle) {
  const fingerprints = [extractFingerprint(localSdp), extractFingerprint(remoteSdp)];
  if (fingerprints.includes(null)) {
    return null;
  }

  const material = new TextEncoder().encode(fingerprints.sort(compareCodeUnits).join('|'));
  const digest = await subtle.digest('SHA-256', material);
  return formatCode(new DataView(digest).getBigUint64(0));
}
