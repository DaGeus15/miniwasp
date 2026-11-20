// Percentiles por el metodo del rango mas cercano sobre las muestras reales.
function percentile(sorted, fraction) {
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

function round(value) {
  return Number(value.toFixed(2));
}

export function summarize(values) {
  if (values.length === 0) {
    return { count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    min: round(sorted[0]),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted.at(-1)),
    mean: round(total / sorted.length),
  };
}

// Junta las muestras de varios ciclos agrupadas por nombre de medicion.
export class LatencyRecorder {
  #samples = new Map();

  add(name, value) {
    if (value === null || value === undefined) {
      return;
    }
    const list = this.#samples.get(name) ?? [];
    list.push(value);
    this.#samples.set(name, list);
  }

  addAll(name, values) {
    values.forEach((value) => this.add(name, value));
  }

  summary() {
    return Object.fromEntries([...this.#samples].map(([name, values]) => [name, summarize(values)]));
  }
}
