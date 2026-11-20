// Pruebas de mutacion solo sobre las reglas criticas de seguridad (umbral 95 %).
import { createMutationConfig } from './stryker.config.mjs';

export const CRITICAL_MUTATE = [
  'src/server/calls/**/*.js',
  'src/server/rooms/**/*.js',
  'src/server/security/**/*.js',
  'src/server/http/room-endpoint.js',
  'src/server/http/http-router.js',
  'src/server/http/read-body.js',
  'src/server/peers/**/*.js',
  'src/server/messaging/**/*.js',
  'src/server/api/**/*.js',
  'src/server/validation.js',
  'src/shared/**/*.js',
];

export default createMutationConfig({ name: 'critical', mutate: CRITICAL_MUTATE, breakAt: 95 });
