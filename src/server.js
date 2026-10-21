'use strict';

const http = require('node:http');
const { createHash, timingSafeEqual } = require('node:crypto');
const QRCode = require('qrcode');
const { escapeHtml } = require('./tickets');

const safeEqual = (a, b) =>
  timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());

const page = (title, body, refreshSeconds) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${refreshSeconds ? `<meta http-equiv="refresh" content="${refreshSeconds}">` : ''}
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f4f6f8;color:#1b2733;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
  main{background:#fff;border-radius:14px;padding:28px;max-width:420px;width:100%;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center}
  h1{font-size:1.3rem;margin:0 0 8px} p{line-height:1.5;margin:8px 0}
  .btn{display:inline-block;background:#25d366;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;margin:12px 0}
  img{max-width:100%;height:auto} .muted{color:#667}
</style></head><body><main>${body}</main></body></html>`;

/**
 * Servidor HTTP mínimo (sin Express):
 *   GET /         enlace público para abrir el chat con el bot (+ QR del enlace)
 *   GET /health   estado para el health-check de la plataforma / monitor externo (siempre 200)
 *   GET /qr?key=  QR para vincular WhatsApp; protegido con ADMIN_KEY
 *
 * @param {{status: string, qr: string|null, number: string|null}} state objeto vivo actualizado por app.js
 */
function createServer({ state, adminKey, startText = 'menu' }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (code, type, body) => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'Method Not Allowed');

    try {
      if (url.pathname === '/health') {
        return send(200, 'application/json', JSON.stringify({ ok: true, whatsapp: state.status }));
      }

      if (url.pathname === '/') {
        if (state.status === 'ready' && state.number) {
          const link = `https://wa.me/${state.number}?text=${encodeURIComponent(startText)}`;
          const qr = await QRCode.toDataURL(link, { margin: 1, width: 240 });
          return send(
            200,
            'text/html; charset=utf-8',
            page(
              'Help Desk Avior',
              `<h1>✈️ Help Desk · Informática Avior</h1>
               <p>Abre el chat para usar el asistente automatizado.</p>
               <a class="btn" href="${escapeHtml(link)}">Abrir WhatsApp</a>
               <p class="muted">o escanea desde otro dispositivo:</p>
               <img alt="QR del chat" src="${qr}" width="240" height="240">`,
            60,
          ),
        );
        }
        return send(
          503,
          'text/html; charset=utf-8',
          page('Help Desk Avior', '<h1>✈️ Help Desk · Informática Avior</h1><p>El asistente se está iniciando o no está vinculado todavía. Intenta de nuevo en un minuto.</p>', 15),
        );
      }

      if (url.pathname === '/qr') {
        const key = url.searchParams.get('key') ?? '';
        if (!adminKey || !safeEqual(key, adminKey)) return send(403, 'text/plain', 'Forbidden');

        let body;
        if (state.status === 'ready') {
          body = `<h1>✅ Vinculado</h1><p>WhatsApp conectado como <strong>+${escapeHtml(state.number ?? '?')}</strong>.</p>`;
        } else if (state.status === 'qr' && state.qr) {
          const img = await QRCode.toDataURL(state.qr, { margin: 1, width: 300 });
          body = `<h1>Vincula WhatsApp</h1>
                  <p>WhatsApp → <em>Dispositivos vinculados</em> → <em>Vincular un dispositivo</em> y escanea:</p>
                  <img alt="QR de vinculación" src="${img}" width="300" height="300">
                  <p class="muted">Se actualiza solo. No compartas esta página.</p>`;
        } else {
          body = `<h1>Iniciando…</h1><p>Estado: <code>${escapeHtml(state.status)}</code>. Esta página se recarga sola.</p>`;
        }
        return send(200, 'text/html; charset=utf-8', page('Vincular WhatsApp', body, state.status === 'ready' ? 0 : 5));
      }

      return send(404, 'text/plain', 'Not Found');
    } catch (err) {
      return send(500, 'text/plain', 'Internal Error');
    }
  });
}

module.exports = { createServer };
