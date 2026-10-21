'use strict';

const { randomBytes } = require('node:crypto');

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pad = (n) => String(n).padStart(2, '0');

/** REQ-AAAAMMDD-HHMMSS-XX  (hora local del proceso; en Docker TZ=America/Caracas). */
function formatId(date, suffix) {
  return (
    `REQ-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${suffix}`
  );
}

/** Cuerpo del correo. Todo texto del usuario se escapa (antes se inyectaba tal cual en el HTML). */
function buildEmail(ticket) {
  const items = ticket.details
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => `<li style="margin-bottom: 5px;">${escapeHtml(l)}</li>`)
    .join('');

  const c = ticket.contact ?? {};
  const contactLines = [
    c.name ? `<strong>Nombre en WhatsApp:</strong> ${escapeHtml(c.name)}<br>` : '',
    c.number
      ? `<strong>Número:</strong> +${escapeHtml(c.number)} (<a href="https://wa.me/${encodeURIComponent(c.number)}">abrir chat</a>)<br>`
      : '',
  ].join('');

  return {
    subject: `🚨 Ticket [${ticket.id}]: ${ticket.type}`,
    html: `
      <p>Se ha generado un nuevo reporte automático desde WhatsApp.</p>
      <p>
        <strong>ID del Ticket:</strong> ${escapeHtml(ticket.id)}<br>
        <strong>Tipo de Solicitud:</strong> ${escapeHtml(ticket.type)}<br>
        ${contactLines}
      </p>
      <div style="background-color: #f4f4f4; padding: 15px; border-left: 4px solid #005aa9; margin-top: 15px;">
        <strong>Detalles proporcionados por el usuario:</strong><br>
        <ul style="margin-top: 10px; padding-left: 20px; font-family: monospace; font-size: 14px;">
          ${items}
        </ul>
      </div>
      <p style="margin-top: 20px; color: #555;">🔍 <em>Para atender este caso, busca el Ticket <strong>${escapeHtml(ticket.id)}</strong> en el buscador de WhatsApp.</em></p>
    `,
  };
}

/**
 * Servicio de tickets: genera el ID al instante (para responder al usuario sin esperar)
 * y envía el correo en segundo plano con reintentos.
 * Si el correo falla del todo, el ticket completo queda en el log y se avisa por onFailure:
 * antes el usuario recibía "ticket registrado" aunque el correo nunca saliera.
 */
function createTickets({
  mailer,
  to,
  log = console,
  clock = () => new Date(),
  retryDelaysMs = [0, 5_000, 20_000],
  onFailure = async () => {},
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const seen = new Set();

  function newId() {
    // Sufijo de 2 hex; si hubiera choques en el mismo segundo se alarga (nunca se cuelga).
    for (let attempt = 0; ; attempt++) {
      const id = formatId(clock(), randomBytes(attempt < 8 ? 1 : 4).toString('hex').toUpperCase());
      if (!seen.has(id)) {
        if (seen.size > 1000) seen.clear();
        seen.add(id);
        return id;
      }
    }
  }

  async function dispatch(ticket) {
    const mail = buildEmail(ticket);
    let lastError;
    for (const delay of retryDelaysMs) {
      if (delay) await sleep(delay);
      try {
        await mailer.send({ to, ...mail });
        log.info(`[ticket] correo enviado: ${ticket.id}`);
        return true;
      } catch (err) {
        lastError = err;
        log.error(`[ticket] fallo enviando ${ticket.id}: ${err.message}`);
      }
    }
    // Último recurso: que no se pierda. Queda en los logs de la plataforma.
    log.error(`[ticket] SIN CORREO, datos completos: ${JSON.stringify(ticket)}`);
    try {
      await onFailure(ticket, lastError);
    } catch (e) {
      log.error(`[ticket] onFailure falló: ${e.message}`);
    }
    return false;
  }

  return {
    /** @returns {{id: string}} de inmediato; el correo se envía en segundo plano. */
    create({ type, details, contact, chatId }) {
      const ticket = { id: newId(), type, details, contact: contact ?? { chatId }, createdAt: clock().toISOString() };
      log.info(`[ticket] ${ticket.id} - ${type}`);
      dispatch(ticket).catch((e) => log.error(`[ticket] error inesperado: ${e.message}`));
      return ticket;
    },
    dispatch,
    buildEmail,
  };
}

module.exports = { createTickets, buildEmail, escapeHtml, formatId };
