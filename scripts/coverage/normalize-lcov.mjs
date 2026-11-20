// SonarQube espera rutas con "/" en lcov.info. En Windows el reporte trae "\": se normalizan
// aqui para que la cobertura cuente igual en cualquier sistema operativo.
import { readFileSync, writeFileSync } from 'node:fs';

const LCOV_FILE = 'coverage/lcov.info';
const WINDOWS_SEPARATOR = '\\';

writeFileSync(LCOV_FILE, readFileSync(LCOV_FILE, 'utf8').replaceAll(WINDOWS_SEPARATOR, '/'));
