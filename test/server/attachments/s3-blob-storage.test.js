import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { AttachmentRefusal } from '../../../src/server/attachments/attachment-error.js';
import { createS3BlobStorage, S3BlobStorage } from '../../../src/server/attachments/s3-blob-storage.js';

function createFakeClient() {
  const objects = new Map();
  const commands = [];
  return {
    objects,
    commands,
    async send(command) {
      commands.push(command);
      if (command instanceof PutObjectCommand) {
        objects.set(command.input.Key, Buffer.from(command.input.Body));
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const body = objects.get(command.input.Key);
        if (!body) {
          throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
        }
        return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
      }
      if (command instanceof DeleteObjectsCommand) {
        command.input.Delete.Objects.forEach(({ Key }) => objects.delete(Key));
        return {};
      }
      throw new Error('comando inesperado');
    },
  };
}

describe('S3BlobStorage', () => {
  it('guarda en el bucket configurado como binario opaco y lo lee de vuelta', async () => {
    const client = createFakeClient();
    const storage = new S3BlobStorage({ client, bucket: 'adjuntos' });

    await storage.put('rooms/a/1', Buffer.from('cifrado'));
    const read = await storage.get('rooms/a/1');

    assert.equal(read.toString(), 'cifrado');
    assert.equal(client.commands[0].input.Bucket, 'adjuntos');
    assert.equal(client.commands[0].input.ContentType, 'application/octet-stream');
  });

  it('un objeto que no existe se informa como adjunto no encontrado; otros errores se propagan', async () => {
    const storage = new S3BlobStorage({ client: createFakeClient(), bucket: 'b' });
    const failing = new S3BlobStorage({ client: { send: async () => Promise.reject(new Error('sin red')) }, bucket: 'b' });

    await assert.rejects(storage.get('nada'), (error) => error.refusal === AttachmentRefusal.NOT_FOUND);
    await assert.rejects(failing.get('x'), /sin red/);
  });

  it('borra en lotes de como maximo 1000 claves', async () => {
    const client = createFakeClient();
    const storage = new S3BlobStorage({ client, bucket: 'b' });
    const keys = Array.from({ length: 2001 }, (_, index) => `rooms/a/${index}`);

    await storage.deleteMany(keys);

    const batches = client.commands.map((command) => command.input.Delete.Objects.length);
    assert.deepEqual(batches, [1000, 1000, 1]);
    assert.ok(client.commands.every((command) => command.input.Delete.Quiet));
  });

  it('se crea a partir de la configuracion validada', () => {
    const storage = createS3BlobStorage({
      endpoint: 'https://storage.test',
      region: 'auto',
      bucket: 'b',
      accessKeyId: 'id',
      secretAccessKey: 'secreto',
      forcePathStyle: false,
    });

    assert.ok(storage instanceof S3BlobStorage);
  });
});
