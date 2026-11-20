const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'];
const SHUTDOWN_TIMEOUT_MS = 10000;
const EXIT_FAILURE = 1;
const EXIT_SUCCESS = 0;

// Detiene el servidor al recibir una senal y termina el proceso ante un error no previsto,
// porque despues de uno el estado en memoria ya no es confiable.
export function installProcessHandlers({ server, logger, runtime = process }) {
  let isStopping = false;

  async function stop(exitCode) {
    if (isStopping) {
      return;
    }
    isStopping = true;
    setTimeout(() => runtime.exit(EXIT_FAILURE), SHUTDOWN_TIMEOUT_MS).unref();

    await server.close();
    logger.info('server.stopped');
    runtime.exit(exitCode);
  }

  function handleFatalError(error) {
    logger.error('server.fatal', error);
    return stop(EXIT_FAILURE);
  }

  for (const signal of SHUTDOWN_SIGNALS) {
    runtime.on(signal, () => stop(EXIT_SUCCESS));
  }
  runtime.on('uncaughtException', handleFatalError);
  runtime.on('unhandledRejection', handleFatalError);
}
