// Recordar algo en el navegador es una comodidad: si el almacenamiento esta bloqueado, la app
// sigue funcionando. Por eso se recibe una funcion: acceder a localStorage tambien puede lanzar
// una excepcion.
export function createStoredValue(getStorage, key) {
  return {
    load() {
      try {
        return getStorage().getItem(key) ?? '';
      } catch {
        return '';
      }
    },

    save(value) {
      try {
        getStorage().setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
  };
}
