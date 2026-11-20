export const OPEN_STATE = 1;
const CONNECTING_STATE = 0;
const CLOSED_STATE = 3;

export class FakeSocket extends EventTarget {
  readyState = CONNECTING_STATE;
  sent = [];

  constructor(url) {
    super();
    this.url = url;
  }

  send(data) {
    this.sent.push(data);
  }

  simulateOpen() {
    this.readyState = OPEN_STATE;
    this.dispatchEvent(new Event('open'));
  }

  simulateData(data) {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }

  simulateError() {
    this.dispatchEvent(new Event('error'));
  }

  close() {
    this.simulateClose();
  }

  simulateClose() {
    this.readyState = CLOSED_STATE;
    this.dispatchEvent(new Event('close'));
  }
}
