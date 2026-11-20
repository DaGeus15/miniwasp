// Ejecuta escenarios E2E y deja un registro auditable de cada uno: pasos, resultado
// esperado, lo observado, verificaciones, evidencia y PASS/FAIL.
import { join, relative } from 'node:path';

const SCENARIO_TIMEOUT_MS = 120000;

export class CheckFailure extends Error {
  name = 'CheckFailure';
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function withTimeout(promise, timeoutMs, id) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${id} supero ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Lo que un escenario puede usar para verificar y guardar evidencia.
export class ScenarioContext {
  #id;
  #evidenceDirectory;
  #reportDirectory;
  checks = [];
  evidence = [];
  metrics = new Map();
  notes = [];

  constructor({ id, evidenceDirectory, reportDirectory }) {
    this.#id = id;
    this.#evidenceDirectory = evidenceDirectory;
    this.#reportDirectory = reportDirectory;
  }

  check(isPassing, description, actual) {
    this.checks.push({ description, passed: Boolean(isPassing), actual });
    if (!isPassing) {
      throw new CheckFailure(`${description} (observado: ${JSON.stringify(actual)})`);
    }
  }

  metric(name, value) {
    this.metrics.set(name, value);
  }

  note(text) {
    this.notes.push(text);
  }

  async screenshot(person, label) {
    const path = join(this.#evidenceDirectory, `${this.#id}-${label}.png`);
    await person.screenshot(path);
    this.evidence.push(relative(this.#reportDirectory, path).replaceAll('\\', '/'));
  }
}

export class ScenarioRunner {
  #world;
  #evidenceDirectory;
  #reportDirectory;
  results = [];

  constructor({ world, evidenceDirectory, reportDirectory }) {
    this.#world = world;
    this.#evidenceDirectory = evidenceDirectory;
    this.#reportDirectory = reportDirectory;
  }

  async run(scenario) {
    const context = new ScenarioContext({
      id: scenario.id,
      evidenceDirectory: this.#evidenceDirectory,
      reportDirectory: this.#reportDirectory,
    });
    this.#world.people().forEach((person) => person.drainProblems());
    const startedAt = Date.now();
    const failure = await this.#execute(scenario, context);
    const consoleReview = this.#reviewConsole(scenario);
    const result = this.#buildResult({ scenario, context, failure, consoleReview, startedAt });
    this.results.push(result);
    const reason = failure ? ` -> ${failure}` : '';
    console.log(`${result.status} ${scenario.id} ${scenario.title}${reason}`);
    return result;
  }

  async #execute(scenario, context) {
    try {
      await withTimeout(scenario.run(this.#world, context), SCENARIO_TIMEOUT_MS, scenario.id);
      return null;
    } catch (error) {
      await this.#captureFailure(scenario, context);
      return error.message;
    }
  }

  async #captureFailure(scenario, context) {
    for (const person of this.#world.people()) {
      await context.screenshot(person, `failure-${person.label}`).catch(() => {});
    }
  }

  #reviewConsole(scenario) {
    const allowed = scenario.allowedConsole ?? [];
    const review = { expected: [], unexpected: [] };
    for (const person of this.#world.people()) {
      for (const problem of person.drainProblems()) {
        const entry = { person: person.label, ...problem };
        const bucket = matchesAny(problem.text, allowed) ? review.expected : review.unexpected;
        bucket.push(entry);
      }
    }
    return review;
  }

  #buildResult({ scenario, context, failure, consoleReview, startedAt }) {
    const hasUnexpectedErrors = consoleReview.unexpected.length > 0;
    return {
      id: scenario.id,
      type: scenario.type,
      title: scenario.title,
      steps: scenario.steps,
      expected: scenario.expected,
      observed: context.notes.join(' '),
      checks: context.checks,
      metrics: Object.fromEntries(context.metrics),
      evidence: context.evidence,
      console: consoleReview,
      failure: failure ?? (hasUnexpectedErrors ? 'Errores de consola no esperados' : null),
      status: failure || hasUnexpectedErrors ? 'FAIL' : 'PASS',
      durationMs: Date.now() - startedAt,
    };
  }
}
