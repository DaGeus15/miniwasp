// Deja correr las promesas pendientes antes de revisar el resultado de una accion asincrona.
export function flushPromises() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
