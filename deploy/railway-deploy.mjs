// Redespliegue en un paso: `npm run deploy`.
// Sube el codigo con la CLI de Railway (filtrado por .railwayignore), espera a que termine el
// build y comprueba que la URL publica responde en /healthz.
// Requisito unico: haber ejecutado `railway login` una vez en esta maquina.
import { spawnSync } from 'node:child_process';

const RAILWAY = Object.freeze({
  projectId: '5e1896d1-2731-41e0-b6dd-d23f52ceedcf',
  environment: 'production',
  service: 'miniwasp',
});
const PUBLIC_URL = 'https://miniwasp.up.railway.app';
const HEALTH_ATTEMPTS = 30;
const HEALTH_DELAY_MS = 5000;

function uploadAndBuild() {
  // En Windows la CLI es railway.cmd y requiere shell. El comando solo contiene constantes de
  // este archivo (ningun dato externo), asi que se pasa como una sola cadena.
  const command = [
    'railway up --ci',
    `--project ${RAILWAY.projectId}`,
    `--environment ${RAILWAY.environment}`,
    `--service ${RAILWAY.service}`,
  ].join(' ');
  const result = spawnSync(command, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    throw new Error(`railway up termino con codigo ${result.status ?? 'desconocido'}`);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealthy() {
  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${PUBLIC_URL}/healthz`, { cache: 'no-store' });
      if (response.ok) return;
    } catch {
      // La instancia nueva puede tardar unos segundos en recibir trafico.
    }
    await wait(HEALTH_DELAY_MS);
  }
  throw new Error(`${PUBLIC_URL}/healthz no respondio 200 tras el despliegue`);
}

try {
  uploadAndBuild();
  await waitForHealthy();
  console.log(`Desplegado y sano: ${PUBLIC_URL}`);
} catch (error) {
  console.error(`Despliegue fallido: ${error.message}`);
  process.exit(1);
}
