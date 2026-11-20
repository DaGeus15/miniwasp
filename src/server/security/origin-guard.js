// Evita que otra pagina web abra un WebSocket desde el navegador de un visitante.
// Los clientes fuera del navegador no envian Origin y podrian falsificarlo, asi que
// esta regla no los frena: para ellos existen el limite de mensajes y la validacion.
export function isSameOrigin(origin, host) {
  if (origin === undefined) {
    return true;
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
