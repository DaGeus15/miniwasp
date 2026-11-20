// Configuracion de pruebas de mutacion (StrykerJS) para todo el codigo de src/.
// Las pruebas usan node:test, que emite TAP; por eso se usa el tap-runner de Stryker.
import { availableParallelism } from 'node:os';

const REPORT_DIR = 'docs/evidence/mutation';

// Raices de composicion y recursos estaticos quedan fuera del alcance global.
export const GLOBAL_MUTATE = [
  'src/**/*.js',
  '!src/server/index.js',
  '!src/client/app.js',
];

export function createMutationConfig({ name, mutate, breakAt }) {
  return {
    $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
    packageManager: 'npm',
    testRunner: 'tap',
    tap: {
      testFiles: ['test/**/*.test.js'],
      nodeArgs: [
        '--test-reporter=tap',
        '--test-timeout=4000',
        '--test-force-exit',
        '-r',
        '{{hookFile}}',
        '{{testFile}}',
      ],
      forceBail: true,
    },
    // test-timeout convierte en fallo rapido las pruebas que un mutante deja esperando, y
    // test-force-exit termina el proceso aunque un mutante deje sockets o timers abiertos
    // (en Windows el tap-runner no puede matar el proceso al primer fallo).
    // perTest con el tap-runner significa "por archivo de prueba": cada mutante
    // solo ejecuta los archivos que alcanzan su codigo.
    coverageAnalysis: 'perTest',
    mutate,
    ignorePatterns: ['coverage', 'docs', 'reports', 'certs', '.scannerwork'],
    concurrency: Math.max(1, availableParallelism() - 2),
    timeoutMS: 10000,
    incremental: true,
    incrementalFile: `reports/stryker-incremental-${name}.json`,
    reporters: ['html', 'json', 'clear-text', 'progress'],
    htmlReporter: { fileName: `${REPORT_DIR}/${name}.html` },
    jsonReporter: { fileName: `${REPORT_DIR}/${name}.json` },
    clearTextReporter: { allowColor: false, logTests: false, reportScoreTable: true },
    thresholds: { high: 95, low: breakAt, break: breakAt },
    tempDirName: '.stryker-tmp',
    cleanTempDir: 'always',
  };
}

export default createMutationConfig({ name: 'global', mutate: GLOBAL_MUTATE, breakAt: 85 });
