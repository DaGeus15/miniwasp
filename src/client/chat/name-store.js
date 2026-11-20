import { createStoredValue } from '../common/stored-value.js';

const NAME_STORAGE_KEY = 'miniwasp-name';

export function createNameStore(getStorage) {
  return createStoredValue(getStorage, NAME_STORAGE_KEY);
}
