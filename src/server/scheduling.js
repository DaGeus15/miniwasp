// Programa una tarea unica y devuelve la funcion que la cancela. El temporizador no impide
// que el proceso termine: una sala vacia o una llamada sonando no deben mantenerlo vivo.
export function scheduleOnce(callback, delayMs) {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return () => clearTimeout(timer);
}
