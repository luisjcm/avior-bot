'use strict';

const nodemailer = require('nodemailer');

/**
 * Envío de correo con dos proveedores, elegidos con MAIL_PROVIDER:
 *
 *   smtp  (por defecto)  SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
 *   graph                Microsoft Graph (OAuth2, sin contraseña de buzón):
 *                        GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET
 *                        remitente = MAIL_FROM (buzón desde el que se envía)
 *
 * Microsoft anunció el retiro de la autenticación básica en SMTP AUTH (smtp.office365.com),
 * por eso "graph" es la alternativa recomendada si el SMTP deja de funcionar.
 *
 * @returns {{ provider: string, configured: boolean, send: (m: {to: string, subject: string, html: string}) => Promise<void> }}
 */
function createMailer(env = process.env, { fetchImpl = globalThis.fetch, transportFactory = nodemailer.createTransport } = {}) {
  const provider = (env.MAIL_PROVIDER || 'smtp').toLowerCase();
  const from = env.MAIL_FROM || env.SMTP_USER;
  const fromHeader = `"WhatsApp Bot Help Desk" <${from}>`;

  if (provider === 'graph') {
    const tenant = env.GRAPH_TENANT_ID;
    const clientId = env.GRAPH_CLIENT_ID;
    const secret = env.GRAPH_CLIENT_SECRET;
    const configured = Boolean(tenant && clientId && secret && from);
    let token = null; // { value, expiresAt }

    async function getToken() {
      if (token && Date.now() < token.expiresAt - 60_000) return token.value;
      const res = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: secret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
      });
      if (!res.ok) throw new Error(`Graph token HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = await res.json();
      token = { value: json.access_token, expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000 };
      return token.value;
    }

    return {
      provider,
      configured,
      async send({ to, subject, html }) {
        if (!configured) throw new Error('Graph no configurado (faltan GRAPH_* o MAIL_FROM)');
        const res = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              subject,
              body: { contentType: 'HTML', content: html },
              toRecipients: [{ emailAddress: { address: to } }],
            },
            saveToSentItems: false,
          }),
        });
        if (res.status === 401) token = null; // forzar token nuevo en el próximo intento
        if (res.status !== 202) throw new Error(`Graph sendMail HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      },
    };
  }

  // ── SMTP ──
  const configured = Boolean(env.SMTP_USER && env.SMTP_PASS);
  const transporter = configured
    ? transportFactory({
        host: env.SMTP_HOST || 'smtp.office365.com',
        port: Number(env.SMTP_PORT || 587),
        secure: env.SMTP_SECURE === 'true', // true solo para el puerto 465
        requireTLS: env.SMTP_SECURE !== 'true',
        connectionTimeout: 15_000,
        socketTimeout: 20_000,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      })
    : null;

  return {
    provider: 'smtp',
    configured,
    async send({ to, subject, html }) {
      if (!transporter) throw new Error('SMTP no configurado (faltan SMTP_USER / SMTP_PASS)');
      await transporter.sendMail({ from: fromHeader, to, subject, html });
    },
  };
}

module.exports = { createMailer };
