// Mide CPU y memoria del proceso del servidor desde afuera, sin agregar nada a src.
// En Windows usa un solo PowerShell que imprime una muestra por intervalo; en otros
// sistemas consulta ps en cada intervalo.
import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const SAMPLE_INTERVAL_MS = 250;
const BYTES_PER_MIB = 1024 ** 2;
const KIB = 1024;
const run = promisify(execFile);
// Rutas absolutas: no se busca el ejecutable en PATH.
const POWERSHELL_PATH = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const PS_PATH = '/bin/ps';

function windowsScript(pid) {
  return [
    `$p = Get-Process -Id ${pid}`,
    '$c = [Globalization.CultureInfo]::InvariantCulture',
    'while (-not $p.HasExited) {',
    '  $p.Refresh()',
    "  [Console]::Out.WriteLine([string]::Format($c, '{0} {1} {2} {3}', [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(), $p.TotalProcessorTime.TotalMilliseconds, $p.WorkingSet64, $p.PrivateMemorySize64))",
    `  Start-Sleep -Milliseconds ${SAMPLE_INTERVAL_MS}`,
    '}',
  ].join('\n');
}

function parseCpuTime(text) {
  const [clock, days] = text.trim().split('-').reverse();
  const seconds = clock.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  return (seconds + Number(days ?? 0) * 86400) * 1000;
}

function round(value, digits = 1) {
  return Number(value.toFixed(digits));
}

export class ProcessSampler {
  #samples = [];
  #stopper = null;

  get samples() {
    return [...this.#samples];
  }

  start(pid) {
    this.#stopper = process.platform === 'win32' ? this.#startWindows(pid) : this.#startPosix(pid);
  }

  stop() {
    this.#stopper?.();
    this.#stopper = null;
  }

  latest() {
    return this.#samples.at(-1) ?? null;
  }

  // Muestras dentro del intervalo mas la anterior y la posterior, para que un intervalo
  // mas corto que el periodo de muestreo tambien tenga una medicion de CPU.
  #bracket(fromMs, toMs) {
    const inside = this.#samples.filter((sample) => sample.t >= fromMs && sample.t <= toMs);
    const before = this.#samples.findLast((sample) => sample.t < fromMs);
    const after = this.#samples.find((sample) => sample.t > toMs);
    return [before, ...inside, after].filter(Boolean);
  }

  // Resume las muestras entre dos instantes (ms de reloj de pared).
  summarize(fromMs, toMs) {
    const window = this.#bracket(fromMs, toMs);
    const cpuPercents = window.slice(1).map((sample, index) => {
      const previous = window.at(index);
      return ((sample.cpuMs - previous.cpuMs) / (sample.t - previous.t)) * 100;
    });
    if (cpuPercents.length === 0) {
      return { samples: window.length, avgCpuPercentOneCore: null, peakCpuPercentOneCore: null, peakWorkingSetMiB: null, endWorkingSetMiB: null };
    }
    const elapsedCpu = window.at(-1).cpuMs - window[0].cpuMs;
    return {
      samples: window.length,
      avgCpuPercentOneCore: round((elapsedCpu / (window.at(-1).t - window[0].t)) * 100),
      peakCpuPercentOneCore: round(Math.max(...cpuPercents)),
      peakWorkingSetMiB: round(Math.max(...window.map((sample) => sample.workingSetBytes)) / BYTES_PER_MIB),
      endWorkingSetMiB: round(window.at(-1).workingSetBytes / BYTES_PER_MIB),
      endPrivateMiB: window.at(-1).privateBytes === null ? null : round(window.at(-1).privateBytes / BYTES_PER_MIB),
    };
  }

  #startWindows(pid) {
    const child = spawn(POWERSHELL_PATH, ['-NoProfile', '-NonInteractive', '-Command', windowsScript(pid)], { stdio: ['ignore', 'pipe', 'ignore'] });
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const lines = (pending + chunk).split(/\r?\n/);
      pending = lines.pop();
      lines.filter(Boolean).forEach((line) => this.#recordWindows(line));
    });
    return () => child.kill();
  }

  #recordWindows(line) {
    const [t, cpuMs, workingSetBytes, privateBytes] = line.trim().split(' ').map(Number);
    if (Number.isFinite(t) && Number.isFinite(cpuMs)) {
      this.#samples.push({ t, cpuMs, workingSetBytes, privateBytes });
    }
  }

  #startPosix(pid) {
    const timer = setInterval(async () => {
      const { stdout } = await run(PS_PATH, ['-o', 'rss=,time=', '-p', String(pid)]).catch(() => ({ stdout: '' }));
      const [rssKib, cpuTime] = stdout.trim().split(/\s+/);
      if (cpuTime) {
        this.#samples.push({ t: Date.now(), cpuMs: parseCpuTime(cpuTime), workingSetBytes: Number(rssKib) * KIB, privateBytes: null });
      }
    }, SAMPLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }
}
