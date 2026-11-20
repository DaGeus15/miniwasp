import { createS3BlobStorage } from './attachments/s3-blob-storage.js';
import { loadConfig } from './config.js';
import { createChatServer } from './create-chat-server.js';
import { installProcessHandlers } from './graceful-shutdown.js';
import { listLanAddresses } from './lan-addresses.js';
import { Logger } from './observability/logger.js';

const { port, host, objectStorage, ...serverOptions } = loadConfig();
const logger = new Logger();
const storageOptions = objectStorage ? { blobStorage: createS3BlobStorage(objectStorage) } : {};
const server = createChatServer({ ...serverOptions, ...storageOptions, logger });

installProcessHandlers({ server, logger });
const boundPort = await server.listen(port, host);

const scheme = serverOptions.tls ? 'https' : 'http';
const reachableHosts = host === '0.0.0.0' ? ['localhost', ...listLanAddresses()] : [host];
logger.info('server.started', {
  urls: reachableHosts.map((reachableHost) => `${scheme}://${reachableHost}:${boundPort}`),
});
