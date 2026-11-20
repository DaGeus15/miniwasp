import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const pageHtml = await readFile(new URL('../../src/client/index.html', import.meta.url), 'utf8');

export function createPage() {
  return new JSDOM(pageHtml).window;
}
