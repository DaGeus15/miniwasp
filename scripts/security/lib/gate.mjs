import { findAcceptance } from './allowlist.mjs';
import { isBlocking } from './severity.mjs';

function classifyBlocking(findings, allowlist) {
  const blocking = [];
  const accepted = [];
  for (const finding of findings.filter((item) => isBlocking(item.severity))) {
    const acceptance = findAcceptance(allowlist, finding);
    if (acceptance) {
      accepted.push({ finding, acceptance });
    } else {
      blocking.push(finding);
    }
  }
  return { blocking, accepted };
}

// Falla si hay HIGH/CRITICAL/UNRATED sin excepcion vigente, si una herramienta no corrio
// o si la lista de excepciones esta mal formada: sin evidencia completa no hay aprobacion.
export function evaluateGate(results, allowlist) {
  const { blocking, accepted } = classifyBlocking(results.flatMap((result) => result.findings), allowlist);
  const toolFailures = results.filter((result) => result.status !== 'ok');
  return {
    blocking,
    accepted,
    toolFailures,
    allowlistErrors: allowlist.errors,
    expiredAcceptances: allowlist.expired,
    passed: blocking.length === 0 && toolFailures.length === 0 && allowlist.errors.length === 0,
  };
}
