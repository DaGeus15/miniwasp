import { spawn } from 'node:child_process';

export const ZAP_IMAGE = 'ghcr.io/zaproxy/zaproxy:stable';
const DOCKER_COMMAND = 'docker';
const HOOKS_MOUNT = '/zap/hooks';
const WORK_MOUNT = '/zap/wrk';
// Codigos de los scripts empaquetados de ZAP: 0 sin avisos, 1 FAIL, 2 WARN, 3 error.
const ZAP_ERROR_EXIT = 3;

function bindMount(source, target, readOnly) {
  const mode = readOnly ? ',readonly' : '';
  return ['--mount', `type=bind,source=${source},target=${target}${mode}`];
}

// En Linux host.docker.internal no existe por defecto; Docker Desktop ya lo resuelve.
function hostGatewayArgs() {
  return process.platform === 'linux' ? ['--add-host=host.docker.internal:host-gateway'] : [];
}

function environmentArgs(names) {
  return names.flatMap((name) => ['-e', name]);
}

function reportArgs(runId) {
  return ['-r', `${runId}-report.html`, '-J', `${runId}-report.json`, '-w', `${runId}-report.md`];
}

// El pid evita choques de nombre si dos escaneos corren a la vez.
function containerName(runId) {
  return `miniwasp-zap-${runId}-${process.pid}`;
}

// Solo se pasan nombres de variables con -e: los valores (token de sesion) no quedan
// en la linea de comandos ni en el historial.
export function buildZapCommand({ run, target, hooksDir, workDir, envNames, hookFile }) {
  const hookArgs = hookFile ? [`--hook=${HOOKS_MOUNT}/${hookFile}`] : [];
  return [
    'run', '--rm', '--name', containerName(run.id),
    ...hostGatewayArgs(),
    ...bindMount(hooksDir, HOOKS_MOUNT, true),
    ...bindMount(workDir, WORK_MOUNT, false),
    ...environmentArgs(envNames),
    ZAP_IMAGE,
    run.script, '-t', target,
    ...run.args,
    ...reportArgs(run.id),
    ...hookArgs,
  ];
}

// Sin shell: los argumentos llegan intactos aunque la ruta del proyecto tenga espacios.
function runStreaming(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? ZAP_ERROR_EXIT));
  });
}

export function runDocker(args, env) {
  return runStreaming(DOCKER_COMMAND, args, env);
}

export function isZapError(exitCode) {
  return exitCode >= ZAP_ERROR_EXIT;
}

export function forceRemoveContainer(runId) {
  return runDocker(['rm', '-f', containerName(runId)], process.env).catch(() => null);
}
