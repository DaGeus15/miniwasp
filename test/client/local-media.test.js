import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LocalMedia, mediaErrorKey } from '../../src/client/calls/local-media.js';
import { FakeStream } from '../support/fake-webrtc.js';

function allTracksStopped(stream) {
  return stream.getTracks().every((track) => track.isStopped);
}

describe('mediaErrorKey', () => {
  it('traduce cada error del navegador a su texto', () => {
    assert.equal(mediaErrorKey({ name: 'NotAllowedError' }), 'mediaDenied');
    assert.equal(mediaErrorKey({ name: 'NotFoundError' }), 'mediaMissing');
    assert.equal(mediaErrorKey({ name: 'NotReadableError' }), 'mediaInUse');
  });

  it('usa un texto general para cualquier otro error', () => {
    assert.equal(mediaErrorKey(new TypeError('sin mediaDevices')), 'mediaUnavailable');
    assert.equal(mediaErrorKey(undefined), 'mediaUnavailable');
  });
});

describe('LocalMedia', () => {
  it('pide camara y microfono y expone el stream', async () => {
    const stream = new FakeStream();
    const requests = [];
    const media = new LocalMedia(async (constraints) => {
      requests.push(constraints);
      return stream;
    });

    assert.equal(await media.acquire(), stream);
    assert.equal(media.stream, stream);
    assert.equal(requests[0].audio, true);
    assert.ok(requests[0].video);
  });

  it('apaga la camara al liberarla', async () => {
    const stream = new FakeStream();
    const media = new LocalMedia(async () => stream);
    await media.acquire();

    media.release();

    assert.equal(allTracksStopped(stream), true);
    assert.equal(media.stream, null);
  });

  it('apaga la camara si la llamada termino mientras se pedia el permiso', async () => {
    const stream = new FakeStream();
    let grantPermission;
    const media = new LocalMedia(
      () =>
        new Promise((resolve) => {
          grantPermission = resolve;
        }),
    );

    const acquisition = media.acquire();
    media.release();
    grantPermission(stream);

    assert.equal(await acquisition, null);
    assert.equal(allTracksStopped(stream), true);
  });

  it('liberar sin haber adquirido no falla', () => {
    const media = new LocalMedia(async () => new FakeStream());

    assert.doesNotThrow(() => media.release());
  });

  it('alterna el microfono y la camara por separado', async () => {
    const stream = new FakeStream();
    const media = new LocalMedia(async () => stream);
    await media.acquire();
    const [audioTrack] = stream.getAudioTracks();
    const [videoTrack] = stream.getVideoTracks();

    assert.equal(media.toggleMicrophone(), false);
    assert.equal(audioTrack.enabled, false);
    assert.equal(videoTrack.enabled, true);

    assert.equal(media.toggleCamera(), false);
    assert.equal(videoTrack.enabled, false);

    assert.equal(media.toggleMicrophone(), true);
    assert.equal(audioTrack.enabled, true);
  });
});
