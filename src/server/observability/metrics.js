export const Metric = Object.freeze({
  CONNECTIONS_ACTIVE: 'connectionsActive',
  CONNECTIONS_REJECTED: 'connectionsRejected',
  MESSAGES_RATE_LIMITED: 'messagesRateLimited',
  MESSAGES_FAILED: 'messagesFailed',
  CALLS_STARTED: 'callsStarted',
  CALLS_ACTIVE: 'callsActive',
  CALLS_ENDED: 'callsEnded',
  ROOMS_CREATED: 'roomsCreated',
  ROOMS_CLOSED: 'roomsClosed',
  JOINS_FAILED: 'joinsFailed',
  HTTP_ERRORS: 'httpErrors',
  API_LOGINS: 'apiLogins',
  VIDEOCALLS_STARTED: 'videocallsStarted',
  VIDEOCALL_JOINS_DENIED: 'videocallJoinsDenied',
  ATTACHMENTS_UPLOADED: 'attachmentsUploaded',
  CONTENT_BLOCKED: 'contentBlocked',
  MESSAGES_DELETED: 'messagesDeleted',
  MESSAGES_REPORTED: 'messagesReported',
});

// Contadores en memoria para diagnosticar el servicio mientras esta en ejecucion.
export class Metrics {
  #values = new Map();

  increment(metric) {
    this.#add(metric, 1);
  }

  decrement(metric) {
    this.#add(metric, -1);
  }

  snapshot() {
    return Object.fromEntries(this.#values);
  }

  #add(metric, amount) {
    this.#values.set(metric, (this.#values.get(metric) ?? 0) + amount);
  }
}
