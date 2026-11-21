import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IceServerSource, RENEW_INTERVAL_MS } from '../../src/client/calls/ice-server-source.js';

const WELCOME = [{ urls: 'stun:stun.test:3478' }];
const TURN = [{ urls: ['turn:turn.test:3478'], username: 'u', credential: 'c' }];

function sourceAnswering(respond) {
  const requested = [];
  const source = new IceServerSource(async (path) => {
    requested.push(path);
    return respond();
  });
  source.useWelcomeServers(WELCOME);
  return { source, requested };
}

describe('IceServerSource', () => {
  it('pide al servidor los servidores ICE de cada llamada', async () => {
    const { source, requested } = sourceAnswering(() => ({ ok: true, json: async () => ({ iceServers: TURN }) }));

    assert.deepEqual(await source.forCall(), TURN);
    assert.deepEqual(requested, ['/rooms/ice-servers']);
  });

  it('si el servidor no responde bien, usa los STUN de la bienvenida', async () => {
    const failures = [
      () => ({ ok: false, json: async () => ({}) }),
      () => ({ ok: true, json: async () => ({ iceServers: 'no es lista' }) }),
      () => {
        throw new TypeError('sin red');
      },
    ];
    for (const respond of failures) {
      assert.deepEqual(await sourceAnswering(respond).source.forCall(), WELCOME);
    }
  });

  it('antes de la bienvenida no hay servidores de respaldo', async () => {
    const source = new IceServerSource(async () => ({ ok: false }));

    assert.deepEqual(await source.forCall(), []);
  });
});

describe('IceServerSource: renovacion durante la llamada', () => {
  function renewingSource(responses) {
    const timers = [];
    const request = async () => responses.shift()();
    const source = new IceServerSource(request, (callback, delayMs) => timers.push({ callback, delayMs }));
    const link = { updates: [], updateIceServers: (iceServers) => link.updates.push(iceServers) };
    return { source, timers, link };
  }

  it('renueva antes de que venzan, conserva las anteriores si falla y se detiene al terminar la llamada', async () => {
    const ok = () => ({ ok: true, json: async () => ({ iceServers: TURN }) });
    const failure = () => ({ ok: false });
    const { source, timers, link } = renewingSource([ok, failure]);
    let isCurrent = true;

    source.keepRenewed(link, () => isCurrent);
    assert.equal(timers[0].delayMs, RENEW_INTERVAL_MS);
    await timers[0].callback();
    await timers[1].callback();
    isCurrent = false;
    await timers[2].callback();

    assert.deepEqual(link.updates, [TURN]);
    assert.equal(timers.length, 3);
  });

  it('si la llamada termina mientras pide credenciales, no las aplica', async () => {
    let isCurrent = true;
    const late = () => {
      isCurrent = false;
      return { ok: true, json: async () => ({ iceServers: TURN }) };
    };
    const { source, timers, link } = renewingSource([late]);

    source.keepRenewed(link, () => isCurrent);
    await timers[0].callback();

    assert.deepEqual(link.updates, []);
  });
});
