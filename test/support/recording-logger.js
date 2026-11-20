import { Logger } from '../../src/server/observability/logger.js';

// Logger real que guarda cada registro para que las pruebas verifiquen la auditoria.
export function createRecordingLogger() {
  const entries = [];
  const logger = new Logger({ write: (line) => entries.push(JSON.parse(line)) });
  const events = () => entries.map(({ level, event }) => `${level}:${event}`);
  return { logger, entries, events };
}
