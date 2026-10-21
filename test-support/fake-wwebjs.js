'use strict';

/**
 * Sustituye a `whatsapp-web.js` SOLO en pruebas (se carga con `node -r`).
 * Simula: QR → autenticado → listo → un mensaje entrante "hola", e imprime lo que el bot responde.
 */
const Module = require('node:module');
const { EventEmitter } = require('node:events');

class Client extends EventEmitter {
  constructor(opts) {
    super();
    console.log(`FAKE_OPTS ${JSON.stringify({ args: opts.puppeteer?.args?.length, exe: opts.puppeteer?.executablePath ?? null })}`);
    this.info = { wid: { user: '584129998877' } };
  }
  async initialize() {
    setTimeout(() => this.emit('qr', '2@fake,qr,data'), 100);
    setTimeout(() => this.emit('authenticated'), 400);
    setTimeout(() => {
      this.emit('ready');
      this.emit('message', {
        from: '58412@c.us',
        body: 'hola',
        type: 'chat',
        fromMe: false,
        hasMedia: false,
        getContact: async () => ({ pushname: 'Tester', number: '58412' }),
      });
    }, 700);
  }
  async sendMessage(chatId, text) {
    console.log(`FAKE_SENT ${JSON.stringify({ chatId, text })}`);
  }
  async destroy() {
    console.log('FAKE_DESTROYED');
  }
}
class LocalAuth { constructor(o) { console.log(`FAKE_LOCALAUTH ${JSON.stringify(o ?? null)}`); } }
class RemoteAuth {}

const original = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'whatsapp-web.js') return { Client, LocalAuth, RemoteAuth };
  return original.call(this, request, ...rest);
};
