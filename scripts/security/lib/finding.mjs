// Forma unica de un hallazgo, sin importar la herramienta que lo produjo.
export function createFinding({ tool, ruleId, severity, file = '', line = null, message = '' }) {
  return Object.freeze({
    tool,
    ruleId: String(ruleId),
    severity,
    file: normalizeReportPath(file),
    line: Number.isInteger(line) ? line : null,
    message: String(message).replaceAll(/\s+/g, ' ').trim(),
  });
}

// Los contenedores ven el proyecto en /src: se reporta la ruta relativa al repositorio.
export function normalizeReportPath(rawPath) {
  return String(rawPath ?? '')
    .replaceAll('\\', '/')
    .replace(/^\/src\//, '')
    .replace(/^\.\//, '');
}

export function describeLocation(finding) {
  if (!finding.file) {
    return '-';
  }
  return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}
