'use strict';

/**
 * Normaliza texto para comparar: sin tildes, minúsculas, sin signos ni emojis,
 * espacios colapsados. "¡¡Hola, BUENAS!!" -> "hola buenas"; "1️⃣" -> "1".
 */
function normalize(input) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convierte un término de FAQ en regex sobre texto ya normalizado.
 *   'traslad'   -> coincide al INICIO de una palabra (traslado, traslados, trasladar)
 *   '=pc'       -> palabra exacta (no coincide con "pcs" ni "especial")
 *   'kiu click' -> frase que empieza una palabra
 * Así "cargo" no se activa con "encargo".
 */
function termToRegex(term) {
  const exact = term.startsWith('=');
  const t = normalize(exact ? term.slice(1) : term);
  return new RegExp(`(?:^| )${escapeRegExp(t)}${exact ? '(?: |$)' : ''}`);
}

const NUM_EMOJI = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function numEmoji(n) {
  return NUM_EMOJI[n] ?? `${n}.`;
}

/** "3", "3.", "opcion 3", "3️⃣" -> 3 ; cualquier otra cosa -> null */
function parseOption(normalized) {
  const m = normalized.match(/^(?:opcion|opc|numero|n)?\s*(\d{1,2})$/);
  return m ? Number(m[1]) : null;
}

const GREETINGS = new Set([
  'hola', 'holi', 'buenas', 'buenos', 'buen', 'hi', 'hello', 'menu', 'inicio',
  'ayuda', 'start', 'empezar', 'comenzar', 'cancelar', 'salir', 'volver',
]);

/**
 * ¿El mensaje es un saludo/comando para abrir el menú?
 * "hola", "Buenas tardes", "menú", "hola buenos dias" -> sí
 * "hola no me abre el correo" (más de 4 palabras) -> no, es una consulta.
 */
function isMenuCommand(normalized) {
  if (!normalized) return false;
  const tokens = normalized.split(' ');
  return GREETINGS.has(tokens[0]) && tokens.length <= 4;
}

module.exports = { normalize, termToRegex, numEmoji, parseOption, isMenuCommand };
