import js from '@eslint/js';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

// Umbrales de mantenibilidad exigidos por la auditoria para el codigo de produccion.
const MAX_COMPLEXITY = 10;
const MAX_FUNCTION_LINES = 30;
const MAX_FILE_LINES = 250;

export default [
  {
    ignores: ['node_modules/', 'coverage/', 'reports/', 'docs/evidence/', '.stryker-tmp/', 'certs/'],
  },
  js.configs.recommended,
  sonarjs.configs.recommended,
  security.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      eqeqeq: 'error',
      'no-console': 'error',
      'no-implicit-coercion': 'error',
      'no-param-reassign': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'sonarjs/todo-tag': 'error',
    },
  },
  {
    files: ['src/**/*.js'],
    rules: {
      complexity: ['error', MAX_COMPLEXITY],
      'sonarjs/cognitive-complexity': ['error', MAX_COMPLEXITY],
      'max-depth': ['error', 3],
      'max-lines-per-function': [
        'error',
        { max: MAX_FUNCTION_LINES, skipBlankLines: true, skipComments: true },
      ],
      'max-lines': ['error', { max: MAX_FILE_LINES, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['src/client/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/server/**/*.js', 'scripts/**/*.{js,mjs}', 'eslint.config.js', 'stryker.config.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/shared/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['scripts/**/*.{js,mjs}'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // Las pruebas usan valores fijos y rutas de archivo propias del repositorio a proposito.
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
      'sonarjs/no-hardcoded-passwords': 'off',
      'sonarjs/no-hardcoded-ip': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
    },
  },
];
