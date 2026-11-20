import { SignalKind } from './events.js';
import { MAX_CANDIDATE_FIELD_LENGTH, MAX_CANDIDATE_LENGTH, MAX_SDP_LENGTH } from './limits.js';

function isBoundedText(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isOptionalCandidateField(value) {
  return value === null || isBoundedText(value, MAX_CANDIDATE_FIELD_LENGTH);
}

function isOptionalLineIndex(value) {
  return value === null || (Number.isInteger(value) && value >= 0);
}

function sanitizeDescription({ kind, sdp }) {
  return isBoundedText(sdp, MAX_SDP_LENGTH) ? { kind, sdp } : null;
}

function readCandidateFields(fields) {
  return {
    candidate: fields?.candidate,
    sdpMid: fields?.sdpMid ?? null,
    sdpMLineIndex: fields?.sdpMLineIndex ?? null,
    usernameFragment: fields?.usernameFragment ?? null,
  };
}

function isValidCandidate(candidate) {
  return (
    isBoundedText(candidate.candidate, MAX_CANDIDATE_LENGTH) &&
    isOptionalCandidateField(candidate.sdpMid) &&
    isOptionalLineIndex(candidate.sdpMLineIndex) &&
    isOptionalCandidateField(candidate.usernameFragment)
  );
}

function sanitizeCandidate({ kind, candidate: fields }) {
  const candidate = readCandidateFields(fields);
  return isValidCandidate(candidate) ? { kind, candidate } : null;
}

const SIGNAL_SANITIZERS = new Map([
  [SignalKind.OFFER, sanitizeDescription],
  [SignalKind.ANSWER, sanitizeDescription],
  [SignalKind.CANDIDATE, sanitizeCandidate],
]);

// Reconstruye la senal campo por campo: lo que no este en la lista nunca llega al otro cliente.
export function sanitizeSignal(signal) {
  const sanitize = SIGNAL_SANITIZERS.get(signal?.kind);
  return sanitize ? sanitize(signal) : null;
}
