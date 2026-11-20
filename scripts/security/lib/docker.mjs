import { runCommand } from './process-runner.mjs';

export const ContainerPath = Object.freeze({
  SOURCE: '/src',
  OUTPUT: '/out',
  WORK: '/work',
  CACHE: '/cache',
});

// Referencia inmutable: el tag es solo legible, el digest decide que imagen se ejecuta.
export function imageReference({ repository, tag, digest }) {
  return `${repository}:${tag}@${digest}`;
}

export function bindMount(source, target, { readonly = true } = {}) {
  const base = `type=bind,source=${source},target=${target}`;
  return readonly ? `${base},readonly` : base;
}

export function tmpfsMount(target) {
  return `type=tmpfs,target=${target}`;
}

export function volumeMount(name, target) {
  return `type=volume,source=${name},target=${target}`;
}

// Los escaneres no necesitan privilegios: se les quitan todas las capacidades del kernel.
// El nombre fijo permite eliminar el contenedor si la herramienta excede su tiempo limite.
export function dockerRunArgs({ name, image, mounts, workdir = ContainerPath.SOURCE, command, environment = {} }) {
  return [
    'run',
    '--rm',
    '--name',
    name,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    ...mounts.flatMap((mount) => ['--mount', mount]),
    ...Object.entries(environment).flatMap(([name, value]) => ['--env', `${name}=${value}`]),
    '--workdir',
    workdir,
    image,
    ...command,
  ];
}

export function runDocker(args) {
  return runCommand('docker', args);
}

// Matar el cliente docker no detiene el contenedor: se elimina explicitamente por nombre.
export function removeContainer(name) {
  return runDocker(['rm', '--force', name]);
}

export function ensureImage(image) {
  const inspected = runDocker(['image', 'inspect', '--format', '{{.Id}}', image]);
  if (inspected.status === 0) {
    return { status: 0, stderr: '' };
  }
  return runDocker(['pull', '--quiet', image]);
}
