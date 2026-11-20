/* global window, document */
// Una persona que usa la app desde su propio Chrome headless, independiente de las demas.
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PROBES_PATH = join(import.meta.dirname, 'browser-probes.js');
const VIEWPORT = { width: 1000, height: 700 };
const DEFAULT_TIMEOUT_MS = 20000;
const BASE_ARGS = ['--use-fake-device-for-media-stream', '--ignore-certificate-errors'];

export const MediaAccess = Object.freeze({ GRANTED: 'granted', DENIED: 'denied' });

function launchArguments(mediaAccess) {
  // Sin la UI falsa y sin permiso concedido al contexto, Chrome niega la camara (NotAllowedError).
  return mediaAccess === MediaAccess.GRANTED
    ? [...BASE_ARGS, '--use-fake-ui-for-media-stream']
    : BASE_ARGS;
}

export class BrowserPerson {
  #problems = [];

  constructor({ label, browser, context, page }) {
    this.label = label;
    this.browser = browser;
    this.context = context;
    this.page = page;
    this.#listen(page);
  }

  static async launch({ label, executablePath, baseUrl, mediaAccess = MediaAccess.GRANTED }) {
    const browser = await chromium.launch({ executablePath, headless: true, args: launchArguments(mediaAccess) });
    const isGranted = mediaAccess === MediaAccess.GRANTED;
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: VIEWPORT,
      permissions: isGranted ? ['camera', 'microphone', 'clipboard-read', 'clipboard-write'] : [],
    });
    await context.addInitScript({ path: PROBES_PATH });
    context.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    const page = await context.newPage();
    const person = new BrowserPerson({ label, browser, context, page });
    await page.goto(baseUrl);
    return person;
  }

  // Devuelve y vacia los errores de consola y de pagina acumulados.
  drainProblems() {
    return this.#problems.splice(0);
  }

  async waitForHome() {
    await this.page.locator('#home').waitFor({ state: 'visible' });
  }

  async createRoom() {
    await this.waitForHome();
    await this.page.getByRole('button', { name: 'Crear sala' }).click();
  }

  async joinWithInput(text) {
    await this.waitForHome();
    await this.page.fill('#invite-token', text);
    await this.page.getByRole('button', { name: 'Unirme' }).click();
  }

  // Abre un enlace #join=... como documento nuevo: cambiar solo el fragmento no recarga la app.
  async openInvite(link) {
    await this.page.goto('about:blank');
    await this.page.goto(link);
  }

  async inviteToken() {
    return this.textOf('#invite-code');
  }

  async waitForChatOnline() {
    await this.page.locator('#chat').waitFor({ state: 'visible' });
    await this.waitForText('#status', 'En línea');
  }

  async setName(name) {
    await this.page.fill('#name', name);
    await this.page.press('#name', 'Tab');
  }

  personEntry(name) {
    return this.page.locator('.person').filter({ has: this.page.locator('.person-name', { hasText: name }) });
  }

  async waitForPeer(name) {
    await this.personEntry(name).waitFor({ state: 'visible' });
  }

  async callPeer(name) {
    await this.personEntry(name).locator('.person-call').click();
  }

  async waitForText(selector, text, timeout = DEFAULT_TIMEOUT_MS) {
    await this.page.waitForFunction(
      ([target, expected]) => document.querySelector(target)?.textContent.trim() === expected,
      [selector, text],
      { timeout, polling: 20 },
    );
  }

  async waitForHidden(selector, timeout = DEFAULT_TIMEOUT_MS) {
    await this.page.waitForFunction((target) => document.querySelector(target)?.hidden === true, selector, {
      timeout,
      polling: 20,
    });
  }

  async isHidden(selector) {
    return this.page.evaluate((target) => document.querySelector(target).hidden, selector);
  }

  async textOf(selector) {
    return this.page.evaluate((target) => document.querySelector(target).textContent.trim(), selector);
  }

  async probe(name, ...args) {
    return this.page.evaluate(([method, parameters]) => window.__e2eApi.get(method)(...parameters), [name, args]);
  }

  async fetchJson(path) {
    return this.page.evaluate(async (target) => {
      const response = await fetch(target);
      return { status: response.status, body: response.ok ? await response.json() : null };
    }, path);
  }

  // Abre otra pestana con la misma sesion (mismo contexto y cookies).
  async openTab(url) {
    const tab = await this.context.newPage();
    this.#listen(tab, 'pestana-2');
    await tab.goto(url);
    return tab;
  }

  async screenshot(path) {
    await this.page.screenshot({ path });
  }

  async close() {
    await this.browser.close();
  }

  #listen(page, tabLabel = 'pestana-1') {
    page.on('console', (message) => {
      if (message.type() === 'error') {
        this.#problems.push({ source: `console:${tabLabel}`, text: message.text(), at: new Date().toISOString() });
      }
    });
    page.on('pageerror', (error) => {
      this.#problems.push({ source: `pageerror:${tabLabel}`, text: error.message, at: new Date().toISOString() });
    });
  }
}
