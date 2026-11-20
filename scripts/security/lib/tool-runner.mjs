import { join } from 'node:path';
import { dockerRunArgs, ensureImage, imageReference, removeContainer, runDocker } from './docker.mjs';
import { lastLines } from './process-runner.mjs';
import { readJson, writeText } from './trusted-files.mjs';

function readReport(context, tool) {
  return readJson(join(context.outputDirectory, tool.reportFile));
}

// El comando se publica en la evidencia sin rutas locales del equipo que lo ejecuto.
function displayCommand(args, context) {
  const quoted = args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ');
  return `docker ${quoted}`.replaceAll(context.root, '<repo>').replaceAll(context.workDirectory, '<tmp>');
}

function toolVersion(image, versionCommand) {
  const run = runDocker(['run', '--rm', image, ...versionCommand]);
  const output = `${run.stdout}\n${run.stderr}`.trim();
  return output.split(/\r?\n/).find((line) => line.trim()) ?? 'desconocida';
}

function baseResult(tool) {
  return { id: tool.id, name: tool.name, reportFile: tool.reportFile, extraReports: tool.extraReports ?? [] };
}

export function failedResult(tool, error) {
  return { ...baseResult(tool), status: 'error', error, findings: [], toolErrors: [] };
}

function completedResult(tool, report, details, run = null) {
  return {
    ...baseResult(tool),
    ...details,
    status: 'ok',
    findings: tool.parse(report),
    notes: tool.describe?.(report, run) ?? '',
    toolErrors: tool.errors?.(report) ?? [],
  };
}

function executeContainer(tool, context, image) {
  const name = `miniwasp-scan-${tool.id}-${process.pid}`;
  const args = dockerRunArgs({
    name,
    image,
    mounts: tool.mounts(context),
    command: tool.command(context),
    environment: tool.environment,
  });
  const run = runDocker(args);
  if (run.timedOut) {
    removeContainer(name);
  }
  return { args, run };
}

function describeRunError(tool, run) {
  if (run.timedOut) {
    return `tiempo limite agotado tras ${Math.round(run.durationMs / 1000)} s`;
  }
  if (!tool.okExitCodes.includes(run.status)) {
    return `codigo de salida ${run.status}: ${lastLines(run.stderr || run.stdout)}`;
  }
  return null;
}

function runContainerTool(tool, context, images) {
  const pin = images[tool.imageKey];
  const image = imageReference(pin);
  const pulled = ensureImage(image);
  if (pulled.status !== 0) {
    return failedResult(tool, `no se pudo obtener ${image}: ${lastLines(pulled.stderr)}`);
  }
  const preparationError = tool.prepare?.(context);
  if (preparationError) {
    return failedResult(tool, preparationError);
  }
  const { args, run } = executeContainer(tool, context, image);
  const runError = describeRunError(tool, run);
  if (runError) {
    return failedResult(tool, runError);
  }
  if (tool.stdoutReport) {
    writeText(join(context.outputDirectory, tool.reportFile), run.stdout);
  }
  return completedResult(tool, readReport(context, tool), {
    image,
    version: toolVersion(image, tool.versionCommand),
    command: displayCommand(args, context),
    exitCode: run.status,
    durationMs: run.durationMs,
  }, run);
}

function runLocalTool(tool, context) {
  const startedAt = Date.now();
  const report = tool.runLocal(context);
  return completedResult(tool, report, {
    image: 'ninguna (Node.js local, sin dependencias)',
    version: `node ${process.version}`,
    command: 'node scripts/security/run-security-scans.mjs (paso interno)',
    exitCode: 0,
    durationMs: Date.now() - startedAt,
  });
}

export function runTool(tool, context, images) {
  try {
    return tool.runLocal ? runLocalTool(tool, context) : runContainerTool(tool, context, images);
  } catch (error) {
    return failedResult(tool, error.message);
  }
}
