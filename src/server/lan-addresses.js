import { networkInterfaces } from 'node:os';

// Direcciones con las que otras computadoras de la misma red pueden llegar a esta.
export function listLanAddresses(interfaces = networkInterfaces()) {
  return Object.values(interfaces)
    .flat()
    .filter(({ family, internal }) => family === 'IPv4' && !internal)
    .map(({ address }) => address);
}
