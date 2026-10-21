'use strict';

const { normalize, numEmoji, parseOption, isMenuCommand } = require('./text');
const { compile, matchFaq } = require('./faq');

const MIN = 60 * 1000;

const DEFAULTS = {
  idleTimeoutMs: 10 * MIN, // inactividad dentro de un menú/formulario
  handoffSilenceMs: 120 * MIN, // el bot calla mientras atiende un analista
  hintCooldownMs: 6 * 60 * MIN, // no repetir "escribe menu" a quien escribe cosas sueltas
  greetUnknown: true, // responder con una pista a mensajes que no entiende
};

const HANDOFF_EXIT = new Set(['menu', 'cancelar', 'inicio']);

const MSG = {
  hint: '👋 Soy el asistente de Help Desk de Avior. Escribe *menu* para ver las opciones o reportar una falla.',
  expired: '⏱️ Tu sesión expiró por inactividad. Escribe *menu* para comenzar de nuevo.',
  media: '📎 Por ahora solo puedo leer texto. Descríbelo por escrito; cuando te contacte el analista podrás enviarle la captura.',
  tooShort: '✏️ Necesito un poco más de detalle para que el analista pueda ayudarte. Por favor, completa los datos solicitados en un solo mensaje.',
  linkFooter: '_Escribe *menu* si necesitas reportar una falla a Help Desk._',
  followupDone: '👍 Perfecto. Si necesitas algo más, escribe *menu*.',
};

/** Valida el árbol al arrancar para detectar errores de edición (typos en `next`, etc.). */
function validateFlow(flow) {
  const errors = [];
  const nodes = flow?.nodes ?? {};
  if (!nodes[flow?.root]) errors.push(`root "${flow?.root}" no existe en nodes`);
  for (const [id, n] of Object.entries(nodes)) {
    switch (n.type) {
      case 'menu':
        if (!Array.isArray(n.options) || n.options.length === 0) errors.push(`${id}: menu sin options`);
        for (const [i, o] of (n.options ?? []).entries()) {
          if (!o.label) errors.push(`${id}.options[${i}]: falta label`);
          if (!nodes[o.next]) errors.push(`${id}.options[${i}]: next "${o.next}" no existe`);
        }
        break;
      case 'form':
        for (const k of ['ticketType', 'prompt', 'success']) if (!n[k]) errors.push(`${id}: falta ${k}`);
        if (n.success && !n.success.includes('{ticket}')) errors.push(`${id}: success debe incluir {ticket}`);
        break;
      case 'handoff':
        for (const k of ['ticketType', 'message']) if (!n[k]) errors.push(`${id}: falta ${k}`);
        break;
      case 'info':
        if (!n.text) errors.push(`${id}: falta text`);
        break;
      default:
        errors.push(`${id}: type "${n.type}" desconocido`);
    }
  }
  if (errors.length) throw new Error(`flow.js inválido:\n - ${errors.join('\n - ')}`);
}

/**
 * Motor de conversación. No conoce WhatsApp ni el correo: recibe texto y devuelve
 * los mensajes a enviar, lo que lo hace fácil de probar.
 *
 * Estados por chat:  MENU · FORM · FOLLOWUP · HANDOFF   (sin sesión = reposo)
 */
class Engine {
  /**
   * @param {object} deps
   * @param {object} deps.flow      árbol de flow.js
   * @param {Array}  deps.faq       entradas de faq.js
   * @param {object} deps.tickets   { create({type, details, contact, chatId}) -> {id} }
   * @param {object} [deps.config]  sobrescribe DEFAULTS
   * @param {Function} [deps.now]   reloj inyectable (tests)
   */
  constructor({ flow, faq, tickets, config = {}, now = () => Date.now() }) {
    validateFlow(flow);
    this.flow = flow;
    this.faq = compile(faq);
    this.tickets = tickets;
    this.cfg = { ...DEFAULTS, ...config };
    this.now = now;
    this.sessions = new Map(); // chatId -> sesión
    this.hints = new Map(); // chatId -> última vez que se mostró la pista
    this.quickLinks = faq.filter((e) => e.kind === 'link' && e.enabled !== false && e.label).map((e) => e.label);
  }

  /**
   * Procesa un mensaje entrante.
   * @param {string} chatId
   * @param {string} rawText
   * @param {{hasMedia?: boolean, resolveContact?: () => Promise<object>}} [meta]
   * @returns {Promise<string[]>} mensajes a enviar, en orden
   */
  async handle(chatId, rawText, meta = {}) {
    const now = this.now();
    const text = String(rawText ?? '').trim();
    const n = normalize(text);
    const s = this.#liveSession(chatId, now);

    // Mensaje sin texto (solo imagen/audio/sticker)
    if (!n) {
      if (s?.state === 'FORM' && meta.hasMedia) {
        s.last = now;
        return [MSG.media];
      }
      return [];
    }

    // Durante un traspaso habla un humano: solo "menu"/"cancelar" explícitos reinician
    // (un "hola" va dirigido al analista, no al bot).
    if (s?.state === 'HANDOFF') {
      return HANDOFF_EXIT.has(n) ? this.#showRoot(chatId, now) : [];
    }

    // "menu" / "hola" / "cancelar" funcionan en cualquier otro punto
    if (isMenuCommand(n)) return this.#showRoot(chatId, now);

    if (s?.state === 'FORM') return this.#submitForm(chatId, s, text, meta, now);
    if (s?.state === 'FOLLOWUP') {
      const reply = await this.#followup(chatId, s, n, now);
      if (reply) return reply;
      this.sessions.delete(chatId); // respondió otra cosa: se trata como mensaje nuevo
      return this.#idle(chatId, text, now, false);
    }
    if (s?.state === 'MENU') return this.#menuInput(chatId, s, text, n, now, meta);
    return this.#idle(chatId, text, now, true);
  }

  /**
   * Limpia sesiones vencidas. Llamar periódicamente (p. ej. cada 30 s).
   * @returns {{chatId: string, text: string}[]} avisos de expiración a enviar
   */
  sweep() {
    const now = this.now();
    const notices = [];
    for (const [chatId, s] of this.sessions) {
      if (s.state === 'HANDOFF') {
        if (now > s.until) this.sessions.delete(chatId);
      } else if (now - s.last > this.cfg.idleTimeoutMs) {
        this.sessions.delete(chatId);
        notices.push({ chatId, text: MSG.expired });
      }
    }
    for (const [chatId, t] of this.hints) if (now - t > this.cfg.hintCooldownMs) this.hints.delete(chatId);
    return notices;
  }

  // ───────────────────────── internos ─────────────────────────

  /** Devuelve la sesión vigente (descarta las vencidas aunque sweep aún no corrió). */
  #liveSession(chatId, now) {
    const s = this.sessions.get(chatId);
    if (!s) return undefined;
    const expired = s.state === 'HANDOFF' ? now > s.until : now - s.last > this.cfg.idleTimeoutMs;
    if (expired) {
      this.sessions.delete(chatId);
      return undefined;
    }
    return s;
  }

  #showRoot(chatId, now) {
    const s = { state: 'MENU', node: this.flow.root, stack: [], last: now };
    this.sessions.set(chatId, s);
    return [this.#renderMenu(s.node, true)];
  }

  #renderMenu(nodeId, isRoot) {
    const node = this.flow.nodes[nodeId];
    const lines = [`${node.title ?? ''}`.trim(), '', node.intro ?? '', ''];
    node.options.forEach((o, i) => lines.push(`${numEmoji(i + 1)} ${o.label}`));
    if (!isRoot) lines.push(`${numEmoji(0)} Volver`);
    if (node.footer) lines.push('', node.footer);
    if (isRoot && this.quickLinks.length) lines.push('', `🔗 *Enlaces rápidos:* ${this.quickLinks.join(' · ')}`);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  #menuInput(chatId, s, text, n, now, meta) {
    s.last = now;
    const node = this.flow.nodes[s.node];
    const opt = parseOption(n);

    if (opt === 0 && s.stack.length) {
      s.node = s.stack.pop();
      return [this.#renderMenu(s.node, s.stack.length === 0)];
    }
    if (opt !== null && opt >= 1 && opt <= node.options.length) {
      return this.#enter(chatId, s, node.options[opt - 1].next, now, meta);
    }
    if (opt === null) {
      const hit = matchFaq(text, this.faq);
      if (hit) return this.#answerFaq(chatId, hit, now, s);
    }
    return [`Opción no válida. Por favor responde con un número del 1 al ${node.options.length} (o escribe *menu*).`];
  }

  async #enter(chatId, s, nodeId, now, meta = {}) {
    const node = this.flow.nodes[nodeId];
    switch (node.type) {
      case 'menu':
        s.stack.push(s.node);
        s.node = nodeId;
        return [this.#renderMenu(nodeId, false)];
      case 'form':
        this.sessions.set(chatId, { state: 'FORM', node: nodeId, attempts: 0, last: now });
        return [node.prompt];
      case 'info':
        return [node.text];
      case 'handoff': {
        const ticket = this.tickets.create({
          type: node.ticketType,
          details: node.details ?? 'El usuario ha solicitado atención de un analista.',
          chatId,
          contact: await this.#contact(chatId, meta),
        });
        this.sessions.set(chatId, { state: 'HANDOFF', until: now + this.cfg.handoffSilenceMs, last: now });
        return [node.message.replace('{ticket}', () => ticket.id)];
      }
      default:
        return [];
    }
  }

  async #submitForm(chatId, s, text, meta, now) {
    const node = this.flow.nodes[s.node];
    s.last = now;
    const min = node.minLength ?? 10;
    if (text.length < min && s.attempts < 1) {
      s.attempts += 1; // se insiste una sola vez; a la segunda se acepta lo que escriba
      return [MSG.tooShort];
    }
    const details = meta.hasMedia ? `${text}\n[El usuario también adjuntó un archivo/imagen en WhatsApp]` : text;
    // Se borra la sesión ANTES de crear el ticket: un reintento no duplica el reporte.
    this.sessions.delete(chatId);
    const ticket = this.tickets.create({
      type: node.ticketType,
      details,
      chatId,
      contact: await this.#contact(chatId, meta),
    });
    return [node.success.replace('{ticket}', () => ticket.id)];
  }

  async #followup(chatId, s, n, now) {
    if (['1', 'si', 's', 'yes'].includes(n)) {
      this.sessions.set(chatId, { state: 'FORM', node: s.node, attempts: 0, last: now });
      return [this.flow.nodes[s.node].prompt];
    }
    if (['2', 'no', 'nop'].includes(n)) {
      this.sessions.delete(chatId);
      return [MSG.followupDone];
    }
    return null;
  }

  #idle(chatId, text, now, allowHint) {
    const hit = matchFaq(text, this.faq);
    if (hit) return this.#answerFaq(chatId, hit, now, undefined);

    if (!allowHint || !this.cfg.greetUnknown) return [];
    const last = this.hints.get(chatId);
    if (last !== undefined && now - last < this.cfg.hintCooldownMs) return [];
    this.hints.set(chatId, now);
    return [MSG.hint];
  }

  #answerFaq(chatId, hit, now, currentSession) {
    const parts = [];
    if (hit.answer) parts.push(hit.answer);

    if (hit.escalate) {
      const target = this.flow.nodes[hit.escalate];
      if (!hit.answer) parts.push(`Parece que tu consulta es sobre *${target.title}*.`);
      parts.push(`¿Quieres que abra un reporte para *${target.title}*?\n1️⃣ Sí, abrir reporte\n2️⃣ No, gracias`);
      this.sessions.set(chatId, { state: 'FOLLOWUP', node: hit.escalate, last: now });
    } else {
      parts.push(MSG.linkFooter);
      if (currentSession) currentSession.last = now; // sigue en su menú
    }
    return [parts.join('\n\n')];
  }

  async #contact(chatId, meta) {
    try {
      const c = (await meta.resolveContact?.()) ?? {};
      return { chatId, name: c.name, number: c.number };
    } catch {
      return { chatId };
    }
  }
}

module.exports = { Engine, validateFlow, DEFAULTS, MSG };
