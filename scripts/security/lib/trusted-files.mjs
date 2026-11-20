// Unico punto de acceso a disco del escaneo. Solo acepta rutas dentro del repositorio o del
// directorio temporal del sistema; cualquier otra ruta se rechaza antes de tocar el disco.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TRUSTED_ROOTS = [PROJECT_ROOT, resolve(tmpdir())];

function isInside(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function trusted(path) {
  const candidate = resolve(path);
  if (!TRUSTED_ROOTS.some((root) => isInside(root, candidate))) {
    throw new Error(`Ruta fuera del repositorio y del directorio temporal: ${candidate}`);
  }
  return candidate;
}

// Las reglas detect-non-literal-fs-filename se desactivan solo aqui: toda ruta pasa por trusted().
export function pathExists(path) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta validada por trusted()
  return existsSync(trusted(path));
}

export function isDirectory(path) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta validada por trusted()
  return pathExists(path) && statSync(trusted(path)).isDirectory();
}

export function ensureDirectory(path) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta validada por trusted()
  mkdirSync(trusted(path), { recursive: true });
}

export function readText(path) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta validada por trusted()
  return readFileSync(trusted(path), 'utf8');
}

export function readJson(path) {
  return JSON.parse(readText(path));
}

export function writeText(path, text) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta validada por trusted()
  writeFileSync(trusted(path), text);
}

export function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}
