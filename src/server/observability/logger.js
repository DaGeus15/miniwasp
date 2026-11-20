const Level = Object.freeze({ INFO: 'info', WARN: 'warn', ERROR: 'error' });

function writeToStandardOutput(line) {
  process.stdout.write(`${line}\n`);
}

function describeError(error) {
  return { errorName: error?.name, errorMessage: error?.message, errorStack: error?.stack };
}

// Registro estructurado en JSON. Los eventos describen lo ocurrido con identificadores
// opacos: nunca deben incluir nombres, mensajes, SDP, IP ni credenciales.
export class Logger {
  #write;
  #now;
  #context;

  constructor({ write = writeToStandardOutput, now = () => new Date(), context = {} } = {}) {
    this.#write = write;
    this.#now = now;
    this.#context = context;
  }

  child(context) {
    return new Logger({
      write: this.#write,
      now: this.#now,
      context: { ...this.#context, ...context },
    });
  }

  info(event, fields) {
    this.#log(Level.INFO, event, fields);
  }

  warn(event, fields) {
    this.#log(Level.WARN, event, fields);
  }

  error(event, error, fields) {
    this.#log(Level.ERROR, event, { ...fields, ...describeError(error) });
  }

  #log(level, event, fields) {
    const entry = {
      time: this.#now().toISOString(),
      level,
      event,
      ...this.#context,
      ...fields,
    };
    this.#write(JSON.stringify(entry));
  }
}
