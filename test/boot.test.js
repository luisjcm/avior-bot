'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > end) throw new Error('timeout esperando condición');
    await sleep(50);
  }
}

test('bot.js arranca de punta a punta (WhatsApp simulado): QR → listo → responde → apaga limpio', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['-r', path.join(ROOT, 'test-support/fake-wwebjs.js'), 'bot.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, PORT: String(port), ADMIN_KEY: 'k-test', IDLE_TIMEOUT_MIN: '5', PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium' },
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1) El puerto responde enseguida (la plataforma lo necesita) y aparece el QR
    await waitFor(async () => (await fetch(`${base}/health`)).status === 200);
    await waitFor(async () => (await (await fetch(`${base}/health`)).json()).whatsapp === 'qr');
    const qrPage = await fetch(`${base}/qr?key=k-test`);
    assert.equal(qrPage.status, 200);
    assert.match(await qrPage.text(), /data:image\/png;base64,/);
    assert.equal((await fetch(`${base}/qr?key=otra`)).status, 403);

    // 2) Vinculado: landing pública con el número real del cliente
    await waitFor(async () => (await (await fetch(`${base}/health`)).json()).whatsapp === 'ready');
    const landing = await (await fetch(`${base}/`)).text();
    assert.match(landing, /wa\.me\/584129998877\?text=menu/);

    // 3) El mensaje entrante "hola" recibió el menú
    await waitFor(() => out.includes('FAKE_SENT'));
    assert.match(out, /Selecciona tu requerimiento/);
    assert.match(out, /58412@c\.us/);

    // 4) Configuración: LocalAuth por defecto (sin MONGODB_URI) y argumentos de Chromium
    assert.match(out, /FAKE_LOCALAUTH \{"dataPath"|FAKE_LOCALAUTH null/);
    assert.match(out, /FAKE_OPTS \{"args":\d+,"exe":"\/usr\/bin\/chromium"\}/);
    assert.match(out, /sin credenciales/); // avisa que el correo no está configurado

    // 5) SIGTERM: cierra el cliente y sale con 0
    child.kill('SIGTERM');
    assert.equal(await exited, 0);
    assert.match(out, /FAKE_DESTROYED/);
  } finally {
    child.kill('SIGKILL');
  }
});
