'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createTickets, buildEmail, escapeHtml, formatId } = require('../src/tickets');
const { createMailer } = require('../src/mailer');
const { createServer } = require('../src/server');
const { attachHandlers, shouldIgnore } = require('../src/app');
const { Engine, MSG } = require('../src/engine');
const flow = require('../src/flow');
const { entries } = require('../src/faq');

const silentLog = { info() {}, error() {}, warn() {} };

// ───────────── Tickets ─────────────

test('formatId: AAAAMMDD-HHMMSS-XX', () => {
  assert.equal(formatId(new Date(2026, 9, 21, 14, 5, 9), 'AB'), 'REQ-20261021-140509-AB');
});

test('IDs únicos aunque se creen muchos en el mismo segundo (y sin colgarse)', () => {
  const t = createTickets({ mailer: { send: async () => {} }, to: 'x@y.z', log: silentLog, clock: () => new Date(2026, 0, 1, 0, 0, 0) });
  const ids = new Set();
  for (let i = 0; i < 600; i++) ids.add(t.create({ type: 'T', details: 'd' }).id); // > 256 sufijos posibles
  assert.equal(ids.size, 600);
});

test('el correo escapa HTML del usuario', () => {
  const { html, subject } = buildEmail({
    id: 'REQ-1',
    type: 'Soporte',
    details: '<script>alert(1)</script>\nlínea "dos" & tres',
    contact: { name: '<b>Ana</b>', number: '584121234567' },
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;Ana&lt;\/b&gt;/);
  assert.match(html, /wa\.me\/584121234567/);
  assert.match(html, /&quot;dos&quot; &amp; tres/);
  assert.equal(subject, '🚨 Ticket [REQ-1]: Soporte');
  assert.equal(escapeHtml(null), '');
});

test('dispatch reintenta y termina enviando', async () => {
  let calls = 0;
  const mailer = {
    send: async () => {
      if (++calls < 3) throw new Error('smtp caído');
    },
  };
  const t = createTickets({ mailer, to: 'a@b.c', log: silentLog, sleep: async () => {} });
  assert.equal(await t.dispatch({ id: 'R', type: 'T', details: 'd' }), true);
  assert.equal(calls, 3);
});

test('si el correo falla del todo: queda en el log y se avisa por onFailure', async () => {
  const errors = [];
  let failed;
  const t = createTickets({
    mailer: { send: async () => { throw new Error('535 auth'); } },
    to: 'a@b.c',
    log: { ...silentLog, error: (m) => errors.push(m) },
    sleep: async () => {},
    onFailure: async (ticket, err) => { failed = { ticket, err }; },
  });
  const ok = await t.dispatch({ id: 'R-9', type: 'T', details: 'detalle importante' });
  assert.equal(ok, false);
  assert.ok(errors.some((m) => m.includes('SIN CORREO') && m.includes('detalle importante')));
  assert.equal(failed.ticket.id, 'R-9');
  assert.match(failed.err.message, /535/);
});

test('create devuelve el ID de inmediato sin esperar al correo', () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const t = createTickets({ mailer: { send: () => gate }, to: 'a@b.c', log: silentLog });
  const ticket = t.create({ type: 'T', details: 'd', chatId: 'c' });
  assert.match(ticket.id, /^REQ-\d{8}-\d{6}-[0-9A-F]{2}$/);
  release();
});

// ───────────── Mailer ─────────────

test('SMTP sin credenciales: no configurado y send rechaza', async () => {
  const m = createMailer({});
  assert.equal(m.configured, false);
  await assert.rejects(m.send({ to: 'a', subject: 's', html: 'h' }), /SMTP no configurado/);
});

test('SMTP con credenciales: usa Office365:587 con STARTTLS por defecto', async () => {
  let opts;
  let sent;
  const m = createMailer(
    { SMTP_USER: 'helpdesk@x.com', SMTP_PASS: 'secreto' },
    { transportFactory: (o) => ((opts = o), { sendMail: async (msg) => (sent = msg) }) },
  );
  assert.equal(m.configured, true);
  await m.send({ to: 'dest@x.com', subject: 'S', html: '<p>h</p>' });
  assert.equal(opts.host, 'smtp.office365.com');
  assert.equal(opts.port, 587);
  assert.equal(opts.secure, false);
  assert.equal(opts.requireTLS, true);
  assert.deepEqual(opts.auth, { user: 'helpdesk@x.com', pass: 'secreto' });
  assert.equal(sent.to, 'dest@x.com');
  assert.match(sent.from, /<helpdesk@x\.com>/);
});

test('Graph: pide token una vez, lo reutiliza y envía a /sendMail', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/oauth2/v2.0/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'TOK', expires_in: 3600 }), text: async () => '' };
    }
    return { ok: true, status: 202, text: async () => '' };
  };
  const m = createMailer(
    { MAIL_PROVIDER: 'graph', GRAPH_TENANT_ID: 'tid', GRAPH_CLIENT_ID: 'cid', GRAPH_CLIENT_SECRET: 'sec', MAIL_FROM: 'helpdesk@x.com' },
    { fetchImpl },
  );
  assert.equal(m.configured, true);
  await m.send({ to: 'dest@x.com', subject: 'S', html: '<p>h</p>' });
  await m.send({ to: 'dest@x.com', subject: 'S2', html: '<p>h</p>' });

  const tokenCalls = calls.filter((c) => c.url.includes('oauth2'));
  const mailCalls = calls.filter((c) => c.url.includes('sendMail'));
  assert.equal(tokenCalls.length, 1);
  assert.equal(mailCalls.length, 2);
  assert.equal(mailCalls[0].url, 'https://graph.microsoft.com/v1.0/users/helpdesk%40x.com/sendMail');
  assert.equal(mailCalls[0].init.headers.Authorization, 'Bearer TOK');
  const body = JSON.parse(mailCalls[0].init.body);
  assert.equal(body.message.subject, 'S');
  assert.equal(body.message.body.contentType, 'HTML');
  assert.equal(body.message.toRecipients[0].emailAddress.address, 'dest@x.com');
  assert.match(String(tokenCalls[0].init.body), /grant_type=client_credentials/);
});

test('Graph: error HTTP se propaga y 401 invalida el token', async () => {
  let tokens = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('oauth2')) {
      tokens++;
      return { ok: true, status: 200, json: async () => ({ access_token: 'T' + tokens, expires_in: 3600 }), text: async () => '' };
    }
    return { ok: false, status: 401, text: async () => 'unauthorized' };
  };
  const m = createMailer(
    { MAIL_PROVIDER: 'graph', GRAPH_TENANT_ID: 't', GRAPH_CLIENT_ID: 'c', GRAPH_CLIENT_SECRET: 's', MAIL_FROM: 'h@x.com' },
    { fetchImpl },
  );
  await assert.rejects(m.send({ to: 'a', subject: 's', html: 'h' }), /HTTP 401/);
  await assert.rejects(m.send({ to: 'a', subject: 's', html: 'h' }), /HTTP 401/);
  assert.equal(tokens, 2); // se renovó tras el 401
});

test('Graph sin configuración completa', async () => {
  const m = createMailer({ MAIL_PROVIDER: 'graph' });
  assert.equal(m.configured, false);
  await assert.rejects(m.send({ to: 'a', subject: 's', html: 'h' }), /Graph no configurado/);
});

// ───────────── Servidor HTTP ─────────────

async function withServer(state, adminKey, fn) {
  const server = createServer({ state, adminKey });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('servidor: /health siempre 200 y refleja el estado', async () => {
  const state = { status: 'starting', qr: null, number: null };
  await withServer(state, 'k', async (base) => {
    const r = await fetch(`${base}/health`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, whatsapp: 'starting' });
    assert.equal((await fetch(`${base}/health`, { method: 'HEAD' })).status, 200);
  });
});

test('servidor: landing 503 sin vincular, 200 con enlace wa.me al estar listo', async () => {
  const state = { status: 'qr', qr: 'x', number: null };
  await withServer(state, 'k', async (base) => {
    assert.equal((await fetch(`${base}/`)).status, 503);
    state.status = 'ready';
    state.number = '584121234567';
    const r = await fetch(`${base}/`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /https:\/\/wa\.me\/584121234567\?text=menu/);
    assert.match(html, /data:image\/png;base64,/);
  });
});

test('servidor: /qr exige la clave correcta', async () => {
  const state = { status: 'qr', qr: '2@abc,def,ghi', number: null };
  await withServer(state, 'clave-secreta', async (base) => {
    assert.equal((await fetch(`${base}/qr`)).status, 403);
    assert.equal((await fetch(`${base}/qr?key=mala`)).status, 403);
    const ok = await fetch(`${base}/qr?key=clave-secreta`);
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /data:image\/png;base64,/);

    state.status = 'ready';
    state.number = '58412';
    assert.match(await (await fetch(`${base}/qr?key=clave-secreta`)).text(), /Vinculado/);
  });
});

test('servidor: sin ADMIN_KEY /qr queda cerrado; 404 y 405', async () => {
  await withServer({ status: 'qr', qr: 'x', number: null }, '', async (base) => {
    assert.equal((await fetch(`${base}/qr?key=`)).status, 403);
    assert.equal((await fetch(`${base}/nada`)).status, 404);
    assert.equal((await fetch(`${base}/health`, { method: 'POST' })).status, 405);
  });
});

// ───────────── Cableado con WhatsApp (cliente falso) ─────────────

function harness(extra = {}) {
  const client = new EventEmitter();
  client.sent = [];
  client.sendMessage = async (chatId, text) => void client.sent.push({ chatId, text });
  client.info = { wid: { user: '584120000000' } };
  const created = [];
  const clock = { t: 0 };
  const engine = new Engine({
    flow,
    faq: entries,
    tickets: { create: (t) => (created.push(t), { id: `T${created.length}` }) },
    now: () => clock.t,
    config: extra.cfg,
  });
  const state = { status: 'starting', qr: null, number: null };
  const app = attachHandlers({ client, engine, state, log: silentLog, replyDelayMs: () => 0, ...extra.app });
  const msg = (from, body, o = {}) => ({ from, body, type: 'chat', fromMe: false, hasMedia: false, getContact: async () => ({ pushname: 'Ana', number: '5841' }), ...o });
  const deliver = async (m) => {
    client.emit('message', m);
    await app.enqueue(String(m.from), async () => {});
  };
  return { client, state, created, clock, app, msg, deliver };
}

test('app: eventos de WhatsApp actualizan el estado', () => {
  const h = harness();
  h.client.emit('qr', 'QR-1');
  assert.deepEqual([h.state.status, h.state.qr], ['qr', 'QR-1']);
  h.client.emit('authenticated');
  assert.deepEqual([h.state.status, h.state.qr], ['authenticated', null]);
  h.client.emit('ready');
  assert.deepEqual([h.state.status, h.state.number], ['ready', '584120000000']);
  h.app.stop();
});

test('app: conversación completa a través del cliente', async () => {
  const h = harness();
  await h.deliver(h.msg('58@c.us', 'hola'));
  await h.deliver(h.msg('58@c.us', '2'));
  await h.deliver(h.msg('58@c.us', 'Estación BLA, ext 12, sin wifi'));
  assert.equal(h.client.sent.length, 3);
  assert.match(h.client.sent[0].text, /Selecciona tu requerimiento/);
  assert.match(h.client.sent[2].text, /ticket \*T1\*/);
  assert.equal(h.created[0].contact.name, 'Ana');
  assert.equal(h.created[0].contact.number, '5841');
  h.app.stop();
});

test('app: dos mensajes seguidos del mismo chat se procesan en orden (sin carreras)', async () => {
  const h = harness();
  await h.deliver(h.msg('58@c.us', 'hola'));
  h.client.emit('message', h.msg('58@c.us', '1'));
  h.client.emit('message', h.msg('58@c.us', 'Cuenta a@b.com ext 1 bloqueada')); // sin esperar el anterior
  await h.app.enqueue('58@c.us', async () => {});
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].type, 'Soporte de Correo Corporativo');
  h.app.stop();
});

test('app: ignora grupos, estados, canales, mensajes propios y tipos de sistema', async () => {
  const h = harness();
  for (const m of [
    h.msg('123@g.us', 'hola'),
    h.msg('status@broadcast', 'hola'),
    h.msg('1@newsletter', 'hola'),
    h.msg('58@c.us', 'hola', { fromMe: true }),
    h.msg('58@c.us', 'hola', { isGroupMsg: true }),
    h.msg('58@c.us', 'hola', { type: 'e2e_notification' }),
  ]) {
    await h.deliver(m);
  }
  assert.equal(h.client.sent.length, 0);
  assert.equal(shouldIgnore(h.msg('58@c.us', 'hola')), false);
  h.app.stop();
});

test('app: un error en un chat no frena a los demás', async () => {
  const h = harness();
  h.client.sendMessage = async (chatId) => {
    if (chatId === 'malo@c.us') throw new Error('falló envío');
    h.client.sent.push({ chatId });
  };
  await h.deliver(h.msg('malo@c.us', 'hola'));
  await h.deliver(h.msg('bueno@c.us', 'hola'));
  assert.equal(h.client.sent.length, 1);
  h.app.stop();
});

test('app: el barrido avisa de sesiones expiradas', async () => {
  const h = harness({ cfg: { idleTimeoutMs: 1000 }, app: { sweepEveryMs: 10 } });
  await h.deliver(h.msg('58@c.us', 'hola'));
  h.clock.t += 5000;
  await new Promise((r) => setTimeout(r, 60));
  await h.app.enqueue('58@c.us', async () => {});
  assert.ok(h.client.sent.some((s) => s.text === MSG.expired));
  h.app.stop();
});

test('app: al desconectarse WhatsApp el proceso sale con código 1 (la plataforma lo reinicia)', async () => {
  let code;
  const h = harness({ app: { exit: (c) => (code = c) } });
  h.client.emit('disconnected', 'LOGOUT');
  assert.equal(h.state.status, 'disconnected');
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(code, 1);
  h.app.stop();
});
