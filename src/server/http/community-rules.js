import { HttpError } from './http-error.js';

export const RULES_NOT_ACCEPTED_CODE = 'RULES_NOT_ACCEPTED';
const RULES_NOT_ACCEPTED_ERROR =
  'Para entrar debes confirmar que tienes 16 años o más y que aceptas las normas de la comunidad';

// Crear una sala o entrar a una exige aceptar las normas (edad minima y contenido permitido).
// Debe ser exactamente true: un texto, un 1 o un campo ausente no cuentan como aceptacion.
export function requireAcceptedRules(body) {
  if (body?.acceptedRules !== true) {
    throw new HttpError(400, RULES_NOT_ACCEPTED_ERROR, {}, RULES_NOT_ACCEPTED_CODE);
  }
}
