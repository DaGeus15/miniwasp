import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AttachmentError, AttachmentRefusal } from './attachment-error.js';

// DeleteObjects admite como maximo 1000 claves por peticion.
const MAX_KEYS_PER_DELETE = 1000;

function chunk(items, size) {
  const chunks = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

// Almacenamiento en un bucket compatible con S3 (Railway Buckets). Solo recibe objetos ya
// cifrados por RoomCipher: el proveedor nunca ve un archivo en claro.
export class S3BlobStorage {
  #client;
  #bucket;

  constructor({ client, bucket }) {
    this.#client = client;
    this.#bucket = bucket;
  }

  async put(key, bytes) {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: bytes,
        ContentType: 'application/octet-stream',
      }),
    );
  }

  async get(key) {
    try {
      const { Body } = await this.#client.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key }));
      return Buffer.from(await Body.transformToByteArray());
    } catch (error) {
      if (error?.name === 'NoSuchKey') {
        throw new AttachmentError(AttachmentRefusal.NOT_FOUND);
      }
      throw error;
    }
  }

  async deleteMany(keys) {
    for (const keysChunk of chunk(keys, MAX_KEYS_PER_DELETE)) {
      await this.#client.send(
        new DeleteObjectsCommand({
          Bucket: this.#bucket,
          Delete: { Objects: keysChunk.map((key) => ({ Key: key })), Quiet: true },
        }),
      );
    }
  }
}

// Crea el almacenamiento a partir de la configuracion validada en loadConfig.
export function createS3BlobStorage({ endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle }) {
  const client = new S3Client({ endpoint, region, forcePathStyle, credentials: { accessKeyId, secretAccessKey } });
  return new S3BlobStorage({ client, bucket });
}
