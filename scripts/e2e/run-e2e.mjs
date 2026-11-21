// Prueba E2E del ciclo de vida de una videollamada con dos Chrome reales e independientes.
// Uso: npm run e2e  (opcional: CHROME_PATH=ruta\a\chrome.exe)
// Arranca la app por HTTPS en localhost en un puerto libre, ejecuta los escenarios E2E-01..E2E-15
// (Ana crea la sala y Luis entra con el enlace) y escribe docs/evidence/e2e/report.{json,md}.
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppProcess, findFreePort } from './lib/app-process.mjs';
import { BrowserPerson, MediaAccess } from './lib/browser-person.mjs';
import { writeE2eReport } from './lib/e2e-report.mjs';
import { describeEnvironment } from './lib/environment.mjs';
import { ScenarioRunner } from './lib/scenario-runner.mjs';
import { cameraToggle, fullCall, hangUp, microphoneToggle } from './scenarios/call-scenarios.mjs';
import {
  callerCancelsWhileRinging,
  cameraPermissionDenied,
  logoutDuringCall,
  rejectIncomingCall,
  simultaneousHangUp,
} from './scenarios/interruption-scenarios.mjs';
import { expelMember, inviteRotation } from './scenarios/membership-scenarios.mjs';
import { chatDropDuringCall } from './scenarios/reconnect-scenarios.mjs';
import { serverRestartWhileIdle } from './scenarios/recovery-scenarios.mjs';
import { invalidInviteRejected, roomCreatedAndJoined } from './scenarios/room-scenarios.mjs';

const ROOT_DIRECTORY = resolve(import.meta.dirname, '..', '..');
const EVIDENCE_DIRECTORY = join(ROOT_DIRECTORY, 'docs', 'evidence', 'e2e');
const SCREENSHOT_DIRECTORY = join(EVIDENCE_DIRECTORY, 'screenshots');
const DEFAULT_CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// El orden importa: E2E-10 reinicia el servidor (se pierden las salas) y E2E-12 saca a Ana de la sala.
const SCENARIOS = [
  invalidInviteRejected,
  roomCreatedAndJoined,
  fullCall,
  microphoneToggle,
  cameraToggle,
  hangUp,
  cameraPermissionDenied,
  rejectIncomingCall,
  callerCancelsWhileRinging,
  simultaneousHangUp,
  chatDropDuringCall,
  inviteRotation,
  expelMember,
  serverRestartWhileIdle,
  logoutDuringCall,
];

function prepareEvidenceDirectory() {
  rmSync(SCREENSHOT_DIRECTORY, { recursive: true, force: true });
  mkdirSync(SCREENSHOT_DIRECTORY, { recursive: true });
}

async function createWorld({ app, baseUrl, executablePath }) {
  const people = new Map();
  const launchPerson = async ({ label, displayName, mediaAccess = MediaAccess.GRANTED }) => {
    const person = await BrowserPerson.launch({ label, executablePath, baseUrl, mediaAccess });
    person.displayName = displayName;
    people.set(label, person);
    return person;
  };
  const world = {
    app,
    baseUrl,
    launchPerson,
    people: () => [...people.values()],
    removePerson: async (person) => {
      people.delete(person.label);
      await person.close();
    },
    closeAll: () => Promise.all([...people.values()].map((person) => person.close())),
  };
  world.ana = await launchPerson({ label: 'ana', displayName: 'Ana' });
  world.luis = await launchPerson({ label: 'luis', displayName: 'Luis' });
  return world;
}

async function runScenarios(world) {
  const runner = new ScenarioRunner({ world, evidenceDirectory: SCREENSHOT_DIRECTORY, reportDirectory: EVIDENCE_DIRECTORY });
  for (const scenario of SCENARIOS) {
    await runner.run(scenario);
  }
  return runner.results;
}

async function main() {
  prepareEvidenceDirectory();
  const executablePath = process.env.CHROME_PATH ?? DEFAULT_CHROME_PATH;
  const port = await findFreePort();
  const baseUrl = `https://localhost:${port}/`;
  const app = new AppProcess({ rootDirectory: ROOT_DIRECTORY, port, logFile: join(EVIDENCE_DIRECTORY, 'server-log.jsonl') });
  await app.start();
  const world = await createWorld({ app, baseUrl, executablePath });
  const chromeVersion = world.ana.browser.version();
  let results;
  try {
    results = await runScenarios(world);
  } finally {
    await world.closeAll();
    await app.kill();
  }
  const environment = describeEnvironment({ chromeVersion: `Chrome ${chromeVersion} (headless)`, appUrl: `https://localhost:<puerto libre> (${port} en esta corrida)` });
  const commands = ['npm install', 'npm run e2e'];
  const summary = writeE2eReport({ directory: EVIDENCE_DIRECTORY, environment, commands, results });
  console.log(`E2E: ${summary.passed}/${summary.total} PASS. Reporte en docs/evidence/e2e/report.md`);
  process.exitCode = summary.failed > 0 ? 1 : 0;
}

await main();
