import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from './http-error.js';

const READ_METHODS = new Set(['GET', 'HEAD']);

export class StaticAssetHandler {
  #rootDirectory;
  #assets;
  #responder;

  constructor({ rootDirectory, assets, responder }) {
    this.#rootDirectory = rootDirectory;
    this.#assets = assets;
    this.#responder = responder;
  }

  async handle(request, response, pathname) {
    const asset = this.#assets.get(pathname);
    if (!asset) {
      throw new HttpError(404, 'No encontrado');
    }
    if (!READ_METHODS.has(request.method)) {
      this.#responder.error(response, 405, 'Método no permitido', { Allow: 'GET, HEAD' });
      return;
    }

    // La ruta sale de la lista cerrada PUBLIC_ASSETS, nunca de la URL recibida.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta de la lista cerrada
    const body = await readFile(join(this.#rootDirectory, asset.file));
    this.#responder.asset(response, asset.type, body);
  }
}
