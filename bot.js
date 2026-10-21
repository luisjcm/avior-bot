'use strict';

// Hora de Venezuela para los IDs de ticket aunque el servidor en la nube esté en UTC.
process.env.TZ = process.env.TZ || 'America/Caracas';

const { randomBytes } = require('node:crypto');
const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');

const flow = require('./src/flow');
const { entries: faqEntries } = require('./src/faq');
const { Engine } = require('./src/engine');
const { createMailer } = require('./src/mailer');
const { createTickets } = require('./src/tickets');
const { createServer } = require('./src/server');
const { attachHandlers } = require('./src/app');

const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

/**
 * Sesión de WhatsApp:
 *  - MONGODB_URI definida -> RemoteAuth: la sesión vive en MongoDB y sobrevive a reinicios
 *    (necesario en nubes gratuitas, cuyo disco se borra).
 *  - sin MONGODB_URI      -> LocalAuth en disco, igual que antes (desarrollo local).
 */
async function buildAuth() {
  if (env.MONGODB_URI) {
    const mongoose = require('mongoose');
    const { MongoStore } = require('wwebjs-mongo');
    await mongoose.connect(env.MONGODB_URI);
    console.log('[wa] sesión remota en MongoDB');
    return new RemoteAuth({
      clientId: env.SESSION_ID || 'avior-bot',
      store: new MongoStore({ mongoose }),
      backupSyncIntervalMs: 300_000, // el primer respaldo ocurre ~5 min después de vincular
    });
  }
  return new LocalAuth(env.SESSION_DIR ? { dataPath: env.SESSION_DIR } : undefined);
}

async function main() {
  const state = { status: 'starting', qr: null, number: null };

  // Clave para /qr: si no se define, se genera una y se imprime en el log.
  let adminKey = env.ADMIN_KEY;
  if (!adminKey) {
    adminKey = randomBytes(16).toString('hex');
    console.log(`[admin] ADMIN_KEY no definida; clave temporal: ${adminKey}`);
  }

  // El servidor HTTP arranca primero: la plataforma necesita ver el puerto abierto.
  const port = num(env.PORT, 3000);
  createServer({ state, adminKey }).listen(port, () => console.log(`[http] escuchando en :${port}`));

  // Correo + tickets
  const mailer = createMailer(env);
  if (!mailer.configured) {
    console.warn(`[mail] proveedor "${mailer.provider}" sin credenciales: los tickets solo quedarán en el log.`);
  }
  const ticketTo = env.TICKET_TO || env.MAIL_FROM || env.SMTP_USER || '';

  const client = new Client({
    authStrategy: await buildAuth(),
    puppeteer: {
      headless: true,
      executablePath: env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // /dev/shm es pequeño en contenedores
        '--disable-gpu',
        '--no-zygote',
        '--disable-extensions',
        '--disable-background-networking',
        '--mute-audio',
      ],
    },
  });

  // Si el correo falla del todo, avisar por WhatsApp a un administrador (opcional).
  const tickets = createTickets({
    mailer,
    to: ticketTo,
    onFailure: async (ticket, err) => {
      if (!env.ADMIN_WHATSAPP) return;
      const chat = `${env.ADMIN_WHATSAPP.replace(/\D/g, '')}@c.us`;
      await client.sendMessage(chat, `⚠️ No pude enviar el correo del ticket ${ticket.id} (${ticket.type}). Revisa los logs. Error: ${err?.message}`);
    },
  });

  const engine = new Engine({
    flow,
    faq: faqEntries,
    tickets,
    config: {
      idleTimeoutMs: num(env.IDLE_TIMEOUT_MIN, 10) * 60_000,
      handoffSilenceMs: num(env.HANDOFF_SILENCE_MIN, 120) * 60_000,
      hintCooldownMs: num(env.HINT_COOLDOWN_MIN, 360) * 60_000,
      greetUnknown: env.GREET_UNKNOWN !== 'false',
    },
  });

  attachHandlers({ client, engine, state });

  // Apagado ordenado (Render/Docker envían SIGTERM al redesplegar).
  const shutdown = async (sig) => {
    console.log(`[app] ${sig} recibido, cerrando…`);
    try {
      await client.destroy();
    } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await client.initialize();
}

process.on('unhandledRejection', (err) => console.error('[app] unhandledRejection:', err));

main().catch((err) => {
  console.error('[app] error fatal al iniciar:', err);
  process.exit(1);
});
