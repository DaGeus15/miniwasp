// Crea un certificado autofirmado para usar la app por HTTPS dentro de la red local.
import { mkdirSync, writeFileSync } from 'node:fs';
import selfsigned from 'selfsigned';
import { listLanAddresses } from '../src/server/lan-addresses.js';

const CERTS_DIRECTORY = 'certs';
const VALIDITY_DAYS = 30;
const DNS_NAME = 2;
const IP_ADDRESS = 7;

const lanAddresses = listLanAddresses();
const { cert, private: privateKey } = await selfsigned.generate(
  [{ name: 'commonName', value: 'MiniWasp' }],
  {
    days: VALIDITY_DAYS,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: DNS_NAME, value: 'localhost' },
          { type: IP_ADDRESS, ip: '127.0.0.1' },
          ...lanAddresses.map((ip) => ({ type: IP_ADDRESS, ip })),
        ],
      },
    ],
  },
);

mkdirSync(CERTS_DIRECTORY, { recursive: true });
writeFileSync(`${CERTS_DIRECTORY}/dev-cert.pem`, cert);
writeFileSync(`${CERTS_DIRECTORY}/dev-key.pem`, privateKey, { mode: 0o600 });

console.log(`Certificado valido por ${VALIDITY_DAYS} dias para: ${lanAddresses.join(', ')}`);
