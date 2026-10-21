'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tipos de mensaje que el bot procesa; el resto (notificaciones del sistema, reacciones, etc.) se ignora.
const HANDLED_TYPES = new Set(['chat', 'image', 'document', 'ptt', 'audio', 'video', 'sticker']);

/** Mensajes que nunca debe atender el bot: grupos, estados, canales, propios o de sistema. */
function shouldIgnore(msg) {
  const from = String(msg.from ?? '');
  return (
    msg.fromMe === true ||
    msg.isStatus === true ||
    msg.isGroupMsg === true ||
    from.endsWith('@g.us') ||
    from.endsWith('@broadcast') ||
    from.endsWith('@newsletter') ||
    (msg.type !== undefined && !HANDLED_TYPES.has(msg.type))
  );
}

/**
 * Conecta el cliente de WhatsApp con el motor.
 * `client` es cualquier objeto con la interfaz de whatsapp-web.js (así se prueba con un falso).
 */
function attachHandlers({
  client,
  engine,
  state,
  log = console,
  replyDelayMs = () => 500 + Math.floor(Math.random() * 700), // pausa "humana": reduce el riesgo de bloqueo
  sweepEveryMs = 30_000,
  exit = (code) => process.exit(code),
}) {
  const send = (chatId, text) => client.sendMessage(chatId, text);

  // Un mensaje a la vez POR CHAT: evita carreras si alguien escribe dos mensajes seguidos.
  const queues = new Map();
  function enqueue(chatId, task) {
    const prev = queues.get(chatId) ?? Promise.resolve();
    const next = prev.then(task).catch((err) => log.error(`[bot] error en ${chatId}: ${err.stack || err}`));
    queues.set(chatId, next);
    next.finally(() => {
      if (queues.get(chatId) === next) queues.delete(chatId);
    });
    return next;
  }

  async function processMessage(msg) {
    if (shouldIgnore(msg)) return;
    const chatId = msg.from;
    const replies = await engine.handle(chatId, msg.body ?? '', {
      hasMedia: Boolean(msg.hasMedia),
      resolveContact: async () => {
        const c = await msg.getContact();
        return { name: c?.pushname || c?.name, number: c?.number };
      },
    });
    for (const text of replies) {
      const d = replyDelayMs();
      if (d > 0) await sleep(d);
      await send(chatId, text);
    }
  }

  client.on('qr', (qr) => {
    state.status = 'qr';
    state.qr = qr;
    log.info('[wa] QR listo: ábrelo en /qr?key=<ADMIN_KEY> para vincular WhatsApp');
  });
  client.on('authenticated', () => {
    state.status = 'authenticated';
    state.qr = null;
    log.info('[wa] autenticado');
  });
  client.on('auth_failure', (m) => {
    state.status = 'auth_failure';
    log.error(`[wa] fallo de autenticación: ${m}`);
  });
  client.on('ready', () => {
    state.status = 'ready';
    state.qr = null;
    state.number = client.info?.wid?.user ?? null;
    log.info(`[wa] ¡El bot de Help Desk está activo y escuchando! (+${state.number})`);
  });
  client.on('remote_session_saved', () => log.info('[wa] sesión guardada en MongoDB (ya sobrevive a reinicios)'));
  client.on('disconnected', (reason) => {
    state.status = 'disconnected';
    log.error(`[wa] desconectado: ${reason}`);
    // Salir con error para que la plataforma reinicie el proceso (y pida QR si se cerró la sesión).
    setTimeout(() => exit(1), 1000); // sin unref: debe ejecutarse siempre
  });
  client.on('message', (msg) => enqueue(String(msg.from), () => processMessage(msg)));

  const timer = setInterval(() => {
    for (const { chatId, text } of engine.sweep()) {
      enqueue(chatId, () => send(chatId, text));
    }
  }, sweepEveryMs);
  timer.unref?.();

  return { enqueue, stop: () => clearInterval(timer) };
}

module.exports = { attachHandlers, shouldIgnore };
