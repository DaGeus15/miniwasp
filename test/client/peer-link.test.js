import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PeerLink } from '../../src/client/calls/peer-link.js';
import { SignalKind } from '../../src/shared/events.js';
import { flushPromises } from '../support/async.js';
import { FakePeerConnection, FakeStream } from '../support/fake-webrtc.js';

const iceServers = [{ urls: 'stun:stun.test' }];
const candidateFields = { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 };

function setup() {
  const stream = new FakeStream();
  const log = { signals: [], remoteStreams: [], connected: 0, failed: 0 };
  let connection;

  const link = new PeerLink({
    createPeerConnection(configuration) {
      connection = new FakePeerConnection(configuration);
      return connection;
    },
    iceServers,
    stream,
    onSignal: (signal) => log.signals.push(signal),
    onRemoteStream: (remoteStream) => log.remoteStreams.push(remoteStream),
    onConnected: () => {
      log.connected += 1;
    },
    onFailed: () => {
      log.failed += 1;
    },
  });

  return { link, connection, stream, log };
}

describe('PeerLink', () => {
  it('configura los servidores ICE y agrega las pistas locales', () => {
    const { connection, stream } = setup();

    assert.deepEqual(connection.configuration, { iceServers });
    assert.deepEqual(
      connection.addedTracks.map(({ track }) => track),
      stream.getTracks(),
    );
  });

  it('publica una oferta', async () => {
    const { link, connection, log } = setup();

    link.startOffer();
    await flushPromises();

    assert.equal(connection.localDescription.type, 'offer');
    assert.deepEqual(log.signals, [{ kind: SignalKind.OFFER, sdp: 'sdp-oferta' }]);
  });

  it('responde a una oferta recibida', async () => {
    const { link, connection, log } = setup();

    link.receive({ kind: SignalKind.OFFER, sdp: 'sdp-remota' });
    await flushPromises();

    assert.deepEqual(connection.remoteDescription, { type: 'offer', sdp: 'sdp-remota' });
    assert.equal(connection.localDescription.type, 'answer');
    assert.deepEqual(log.signals, [{ kind: SignalKind.ANSWER, sdp: 'sdp-respuesta' }]);
  });

  it('aplica la respuesta recibida', async () => {
    const { link, connection } = setup();

    link.receive({ kind: SignalKind.ANSWER, sdp: 'sdp-remota' });
    await flushPromises();

    assert.deepEqual(connection.remoteDescription, { type: 'answer', sdp: 'sdp-remota' });
  });

  it('procesa un candidato despues de la descripcion aunque lleguen seguidos', async () => {
    const { link, connection } = setup();
    let hadDescriptionFirst = false;
    const addIceCandidate = connection.addIceCandidate.bind(connection);
    connection.addIceCandidate = async (candidate) => {
      hadDescriptionFirst = connection.remoteDescription !== null;
      await addIceCandidate(candidate);
    };

    link.receive({ kind: SignalKind.OFFER, sdp: 'sdp-remota' });
    link.receive({ kind: SignalKind.CANDIDATE, candidate: candidateFields });
    await flushPromises();

    assert.equal(hadDescriptionFirst, true);
    assert.deepEqual(connection.candidates, [candidateFields]);
  });

  it('publica los candidatos locales e ignora el aviso de fin', () => {
    const { connection, log } = setup();

    connection.simulateCandidate({ candidate: 'candidate:1', toJSON: () => candidateFields });
    connection.simulateCandidate({ candidate: '' });
    connection.simulateCandidate(null);

    assert.deepEqual(log.signals, [{ kind: SignalKind.CANDIDATE, candidate: candidateFields }]);
  });

  it('entrega el stream remoto una sola vez por pista repetida', () => {
    const { connection, log } = setup();
    const remoteStream = new FakeStream();

    connection.simulateTrack(remoteStream);
    connection.simulateTrack(remoteStream);

    assert.deepEqual(log.remoteStreams, [remoteStream]);
  });

  it('informa cuando la conexion se establece o falla', () => {
    const { connection, log } = setup();

    connection.simulateState('connecting');
    assert.deepEqual([log.connected, log.failed], [0, 0]);

    connection.simulateState('connected');
    assert.equal(log.connected, 1);

    connection.simulateState('failed');
    assert.equal(log.failed, 1);
  });

  it('informa el fallo si una senal no se puede aplicar', async () => {
    const { link, connection, log } = setup();
    connection.setRemoteDescription = async () => {
      throw new Error('SDP invalido');
    };

    link.receive({ kind: SignalKind.ANSWER, sdp: 'corrupto' });
    await flushPromises();

    assert.equal(log.failed, 1);
  });

  it('sigue procesando senales despues de un fallo', async () => {
    const { link, connection } = setup();
    connection.setRemoteDescription = async () => {
      throw new Error('SDP invalido');
    };

    link.receive({ kind: SignalKind.ANSWER, sdp: 'corrupto' });
    link.receive({ kind: SignalKind.CANDIDATE, candidate: candidateFields });
    await flushPromises();

    assert.deepEqual(connection.candidates, [candidateFields]);
  });

  it('cierra la conexion y deja de informar fallos', async () => {
    const { link, connection, log } = setup();
    connection.setRemoteDescription = async () => {
      throw new Error('cerrada');
    };

    link.close();
    link.receive({ kind: SignalKind.ANSWER, sdp: 'tarde' });
    await flushPromises();

    assert.equal(connection.isClosed, true);
    assert.equal(log.failed, 0);
  });
});

describe('PeerLink: codigo de seguridad', () => {
  function withFingerprints(connection) {
    connection.localDescription = { sdp: 'a=fingerprint:sha-256 AA:BB\r\n' };
    connection.remoteDescription = { sdp: 'a=fingerprint:sha-256 CC:DD\r\n' };
  }

  it('calcula el codigo con las huellas de ambas descripciones', async () => {
    const { link, connection } = setup();
    withFingerprints(connection);

    assert.match(await link.securityCode(), /^\d{3} \d{3} \d{3} \d{3}$/);
  });

  it('devuelve null sin descripciones en vez de fallar', async () => {
    const { link } = setup();

    assert.equal(await link.securityCode(), null);
  });

  it('devuelve null si el calculo falla', async (context) => {
    const { link, connection } = setup();
    withFingerprints(connection);
    context.mock.method(globalThis.crypto.subtle, 'digest', async () => {
      throw new Error('contexto inseguro');
    });

    assert.equal(await link.securityCode(), null);
  });
});
