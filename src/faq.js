'use strict';

const { normalize, termToRegex } = require('./text');

/**
 * PREGUNTAS FRECUENTES (solo datos).
 *
 * Cada entrada:
 *   id        identificador único
 *   kind      'link'  -> el usuario pide un enlace/portal (respuesta directa)
 *             'info'  -> respuesta con pasos de autoayuda
 *             'route' -> solo detecta el tema y ofrece abrir el reporte correcto
 *   match     lista de grupos; basta que se cumpla UN grupo, y dentro del grupo
 *             deben aparecer TODOS los términos.  [['link','correo'], ['outlook']]
 *             'abc'  = inicio de palabra (abc, abcd...)   '=abc' = palabra exacta
 *             Un grupo con más términos es más específico y gana a uno corto.
 *   answer    texto de respuesta (opcional en 'route')
 *   escalate  id de un nodo `form` de flow.js: tras responder pregunta
 *             "¿Quieres que abra un reporte?" (1 = sí, 2 = no)
 *   label     (kind 'link') nombre corto que se muestra en "Enlaces rápidos"
 *   enabled   false para desactivar sin borrar
 *
 * Para agregar una FAQ nueva basta con añadir un objeto a este arreglo.
 */

// Si el mensaje contiene alguna de estas palabras, la persona probablemente está
// REPORTANDO una falla ("no abre outlook"), no pidiendo el enlace.
const PROBLEM_TERMS = [
  '=no', '=nada', 'falla', 'error', 'bloque', 'problema', 'clave',
  'contrasena', 'olvid', 'lent', 'caid', 'sirve', 'funciona',
];
// ...salvo que pida explícitamente el enlace ("no encuentro el link de cargo").
const ASKS_LINK_TERMS = ['link', 'enlace', 'url', 'direccion', 'pagina', 'portal', '=web'];

const entries = [
  // ───────────── Enlaces rápidos ─────────────
  {
    id: 'link-traslados',
    kind: 'link',
    label: 'traslados',
    match: [['traslad']],
    answer: '🚗 *Sistema de Traslados:*\nIngresa aquí: https://traslados.avior.com.ve/',
  },
  {
    id: 'link-cargo',
    kind: 'link',
    label: 'cargo',
    match: [['cargo'], ['dayal']],
    answer: '📦 *Avior Cargo / Dayal:*\nIngresa aquí: https://cargo.avior.com.ve/login',
  },
  {
    id: 'link-kiu-click',
    kind: 'link',
    label: 'kiu click',
    match: [['kiu click']],
    answer: '✈️ *KIU Click:*\nIngresa aquí: https://kiu.click/login/',
  },
  {
    id: 'link-outlook',
    kind: 'link',
    label: 'outlook',
    // "outlook"/"webmail" solos, o "link/enlace" + "correo" (no basta con "correo")
    match: [['outlook'], ['webmail'], ['link', 'correo'], ['enlace', 'correo'], ['correo', '=web']],
    answer: '📧 *Correo Corporativo (Web):*\nIngresa aquí: https://outlook.cloud.microsoft/mail/',
  },

  // ───────────── Autoayuda (genéricas: revisa que apliquen a tu entorno) ─────────────
  {
    id: 'info-internet',
    kind: 'info',
    match: [['internet'], ['wifi'], ['wi fi'], ['=red'], ['conexion']],
    escalate: 'network',
    answer:
      '🌐 *Antes de reportar, prueba esto:*\n' +
      '1. Confirma si tus compañeros del área también están sin conexión.\n' +
      '2. Desconecta y vuelve a conectar el cable de red (o el Wi-Fi).\n' +
      '3. Reinicia tu equipo.',
  },
  {
    id: 'info-impresora',
    kind: 'info',
    match: [['impresora'], ['imprimir'], ['toner'], ['tinta']],
    escalate: 'hardware',
    answer:
      '🖨️ *Antes de reportar, revisa:*\n' +
      '1. Que la impresora esté encendida y sin luces de error.\n' +
      '2. Que tenga papel y tóner/tinta.\n' +
      '3. Que el cable o la red estén conectados y que no haya trabajos atascados en la cola de impresión.',
  },
  {
    id: 'info-clave-correo',
    kind: 'info',
    // Dos términos: es más específico que la ruta genérica de "correo".
    match: [['clave', 'correo'], ['contrasena', 'correo'], ['olvide', 'correo'], ['bloquead', 'correo']],
    escalate: 'email',
    answer:
      '🔑 *Clave de correo:*\n' +
      'Por seguridad, el desbloqueo o restablecimiento lo realiza un analista de Help Desk.',
  },

  // ───────────── Rutas: detectan el tema y ofrecen el reporte correcto ─────────────
  { id: 'route-email', kind: 'route', escalate: 'email', match: [['correo'], ['outlook'], ['email'], ['e mail']] },
  { id: 'route-kiu', kind: 'route', escalate: 'kiu', match: [['kiu'], ['=firma']] },
  { id: 'route-sap', kind: 'route', escalate: 'sap', match: [['=sap']] },
  { id: 'route-vpn', kind: 'route', escalate: 'vpn', match: [['vpn'], ['acceso remoto'], ['teletrabajo']] },
  {
    id: 'route-hardware',
    kind: 'route',
    escalate: 'hardware',
    match: [['computador'], ['laptop'], ['=pc'], ['teclado'], ['mouse'], ['monitor'], ['telefono'], ['equipo']],
  },

  // ───────────── Plantillas desactivadas (necesitan datos reales de Avior) ─────────────
  {
    id: 'info-horario',
    kind: 'info',
    enabled: false,
    match: [['horario'], ['a que hora']],
    answer: '🕒 *Horario de Help Desk:*\nEDITAR: días y horas de atención.',
  },
  {
    id: 'info-contacto',
    kind: 'info',
    enabled: false,
    match: [['telefono', 'help'], ['extension', 'help'], ['llamar', 'soporte']],
    answer: '📞 *Contacto Help Desk:*\nEDITAR: extensión / teléfono.',
  },
];

// Se precompila una sola vez: [{ entry, groups: [{ size, regexes }] }]
function compile(list) {
  return list
    .filter((e) => e.enabled !== false)
    .map((entry) => ({
      entry,
      groups: entry.match.map((terms) => ({ size: terms.length, regexes: terms.map(termToRegex) })),
    }));
}

const termHits = (regexes, text) => regexes.some((re) => re.test(text));
const problemRegexes = PROBLEM_TERMS.map(termToRegex);
const asksLinkRegexes = ASKS_LINK_TERMS.map(termToRegex);

/** Mayor tamaño de grupo cumplido por la entrada (0 = no coincide). */
function scoreOf(compiled, text) {
  let best = 0;
  for (const g of compiled.groups) {
    if (g.regexes.every((re) => re.test(text))) best = Math.max(best, g.size);
  }
  return best;
}

/**
 * Busca la FAQ que corresponde al texto.
 *  - Los enlaces ('link') tienen prioridad, salvo que el mensaje suene a falla.
 *  - Entre el resto gana la coincidencia más específica; si hay empate entre
 *    entradas distintas es ambiguo y devuelve null (mejor mostrar el menú).
 * @returns {object|null} la entrada de FAQ
 */
function matchFaq(rawText, compiledEntries) {
  const text = normalize(rawText);
  if (!text) return null;

  const hasProblem = termHits(problemRegexes, text);
  const asksLink = termHits(asksLinkRegexes, text);

  if (!hasProblem || asksLink) {
    for (const c of compiledEntries) {
      if (c.entry.kind === 'link' && scoreOf(c, text) > 0) return c.entry;
    }
  }

  const scored = compiledEntries
    .filter((c) => c.entry.kind !== 'link')
    .map((c) => ({ entry: c.entry, score: scoreOf(c, text) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null; // ambiguo
  return scored[0].entry;
}

module.exports = { entries, compile, matchFaq };
