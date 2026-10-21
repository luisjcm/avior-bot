'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const flow = require('../src/flow');
const { entries } = require('../src/faq');
const { Engine, validateFlow, MSG } = require('../src/engine');

const MIN = 60_000;

function setup({ cfg = {}, customFlow = flow } = {}) {
  const clock = { t: 1_000_000 };
  const created = [];
  const tickets = {
    create(t) {
      const ticket = { id: `REQ-TEST-${created.length + 1}`, ...t };
      created.push(ticket);
      return ticket;
    },
  };
  const engine = new Engine({ flow: customFlow, faq: entries, tickets, config: cfg, now: () => clock.t });
  const say = async (text, meta) => (await engine.handle('chat1', text, meta)).join('\n---\n');
  return { engine, clock, created, say };
}

// ───────────── Menú y números ─────────────

test('"hola" muestra el menú numerado y los enlaces rápidos', async () => {
  const { say } = setup();
  const out = await say('hola');
  assert.match(out, /Help Desk - Informática Avior/);
  assert.match(out, /1️⃣ Correo Corporativo/);
  assert.match(out, /7️⃣ Hablar con un Analista/);
  assert.match(out, /Enlaces rápidos:\* traslados · cargo · kiu click · outlook/);
});

test('saludos y comandos variados abren el menú', async () => {
  for (const g of ['Hola', 'HOLA!!', 'Buenas tardes', 'menú', 'Hola buenos días', 'cancelar', 'ayuda']) {
    const { say } = setup();
    assert.match(await say(g), /Help Desk - Informática Avior/, g);
  }
});

test('una consulta que empieza con "hola" pero es larga NO es un saludo', async () => {
  const { say } = setup();
  const out = await say('hola no me abre el correo desde la mañana');
  assert.doesNotMatch(out, /Selecciona tu requerimiento/);
  assert.match(out, /Correo Corporativo/);
});

test('las opciones aceptan "1", "1.", "opción 1" y el emoji 1️⃣', async () => {
  for (const v of ['1', '1.', 'opción 1', '1️⃣', '01']) {
    const { say } = setup();
    await say('menu');
    assert.match(await say(v), /Soporte de Correo Corporativo/, v);
  }
});

test('opción inválida y fuera de rango', async () => {
  const { say } = setup();
  await say('menu');
  assert.match(await say('9'), /Opción no válida.*del 1 al 7/);
  assert.match(await say('blablabla'), /Opción no válida/);
});

// ───────────── Flujo completo y tickets ─────────────

test('flujo completo: menú → formulario → ticket', async () => {
  const { say, created } = setup();
  await say('hola');
  assert.match(await say('3'), /Soporte KIU/);
  const out = await say('Firma JPEREZ, ext 2345, bloqueada por intentos', {
    resolveContact: async () => ({ name: 'Juan', number: '584121234567' }),
  });
  assert.match(out, /ticket \*REQ-TEST-1\*/);
  assert.equal(created.length, 1);
  assert.equal(created[0].type, 'Soporte Sistema KIU');
  assert.match(created[0].details, /JPEREZ/);
  assert.deepEqual(created[0].contact, { chatId: 'chat1', name: 'Juan', number: '584121234567' });
});

test('si no se puede resolver el contacto el ticket se crea igual', async () => {
  const { say, created } = setup();
  await say('hola');
  await say('2');
  await say('Estación CCS, ext 100, no hay internet', {
    resolveContact: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].contact, { chatId: 'chat1' });
});

test('tras crear el ticket la sesión se cierra (no se duplica)', async () => {
  const { say, created } = setup();
  await say('hola');
  await say('4');
  await say('Empleado 12345 ext 222');
  await say('Empleado 12345 ext 222'); // reenvío accidental
  assert.equal(created.length, 1);
});

test('respuesta muy corta: se pide más detalle UNA vez y luego se acepta', async () => {
  const { say, created } = setup();
  await say('hola');
  await say('1');
  assert.equal(await say('no sirve'), MSG.tooShort);
  assert.equal(created.length, 0);
  assert.match(await say('no sirve'), /ticket/);
  assert.equal(created.length, 1);
});

test('imagen sin texto en un formulario: se avisa y NO se crea ticket vacío', async () => {
  const { say, created } = setup();
  await say('hola');
  await say('6');
  assert.equal(await say('', { hasMedia: true }), MSG.media);
  assert.equal(created.length, 0);
});

test('imagen con texto: el ticket indica que hubo adjunto', async () => {
  const { say, created } = setup();
  await say('hola');
  await say('6');
  await say('Impresora piso 2, ext 555, atasco', { hasMedia: true });
  assert.match(created[0].details, /adjuntó un archivo/);
});

test('un mensaje vacío fuera de un formulario se ignora', async () => {
  const { say } = setup();
  assert.equal(await say('', { hasMedia: true }), '');
});

// ───────────── FAQ: enlaces ─────────────

test('enlaces rápidos en reposo', async () => {
  const cases = {
    'traslados': 'traslados.avior.com.ve',
    'Link de traslado': 'traslados.avior.com.ve',
    'cargo': 'cargo.avior.com.ve',
    'dayal': 'cargo.avior.com.ve',
    'kiu click': 'kiu.click',
    'outlook': 'outlook.cloud.microsoft',
    'webmail': 'outlook.cloud.microsoft',
    'enlace del correo': 'outlook.cloud.microsoft',
    'correo web': 'outlook.cloud.microsoft',
  };
  for (const [text, url] of Object.entries(cases)) {
    const { say } = setup();
    assert.ok((await say(text)).includes(url), `${text} -> ${url}`);
  }
});

test('"cargo" no se activa dentro de otra palabra (encargo)', async () => {
  const { say } = setup();
  assert.doesNotMatch(await say('hice un encargo ayer'), /cargo\.avior/);
});

test('BUG CORREGIDO: describir una falla en un formulario no lo secuestra el enlace', async () => {
  const { say, created } = setup();
  await say('hola');
  await say('1');
  const out = await say('Mi cuenta de outlook jperez@avior.com.ve está bloqueada, ext 100');
  assert.match(out, /ticket/);
  assert.doesNotMatch(out, /outlook\.cloud\.microsoft/);
  assert.equal(created.length, 1);
  assert.match(created[0].details, /bloqueada/);
});

test('"no abre outlook" es una falla: ofrece el reporte, no el enlace', async () => {
  const { say } = setup();
  const out = await say('no abre outlook');
  assert.doesNotMatch(out, /outlook\.cloud\.microsoft/);
  assert.match(out, /Correo Corporativo/);
});

test('pedir el enlace explícitamente gana aunque haya "no"', async () => {
  const { say } = setup();
  assert.match(await say('no encuentro el link de cargo'), /cargo\.avior\.com\.ve/);
});

test('un enlace dentro del menú no pierde el menú', async () => {
  const { say } = setup();
  await say('hola');
  assert.match(await say('traslados'), /traslados\.avior/);
  assert.match(await say('2'), /Caída de Red/); // sigue en el menú
});

// ───────────── FAQ: autoayuda y seguimiento ─────────────

test('autoayuda + seguimiento: "internet" → pasos → 1 abre el reporte de red', async () => {
  const { say, created } = setup();
  const out = await say('no tengo internet');
  assert.match(out, /Antes de reportar/);
  assert.match(out, /Quieres que abra un reporte para \*Red e Internet\*/);
  assert.match(await say('1'), /Reporte de Caída de Red/);
  await say('Oficina CCS piso 2, ext 300, sin wifi');
  assert.equal(created[0].type, 'Falla de Red/Internet');
});

test('seguimiento: "no" cierra sin ticket', async () => {
  const { say, created } = setup();
  await say('mi impresora no imprime');
  assert.match(await say('no'), /Si necesitas algo más/);
  assert.equal(created.length, 0);
});

test('seguimiento: otra consulta se trata como mensaje nuevo', async () => {
  const { say } = setup();
  await say('no tengo internet');
  assert.match(await say('traslados'), /traslados\.avior/);
});

test('ruta sin texto de autoayuda: detecta el tema (SAP) y ofrece reporte', async () => {
  const { say } = setup();
  const out = await say('necesito resetear mi clave de sap');
  assert.match(out, /Parece que tu consulta es sobre \*Sistema SAP\*/);
});

test('la coincidencia más específica gana (clave + correo)', async () => {
  const { say } = setup();
  assert.match(await say('olvidé la clave del correo'), /lo realiza un analista/);
});

test('tema ambiguo (internet + kiu) no adivina: muestra la pista', async () => {
  const { say } = setup();
  assert.equal(await say('no tengo internet en kiu'), MSG.hint);
});

// ───────────── Reposo, pista y expiración ─────────────

test('mensaje no entendido: pista una vez y luego silencio durante el cooldown', async () => {
  const { say, clock } = setup({ cfg: { hintCooldownMs: 60 * MIN } });
  assert.equal(await say('quiero hablar con Pedro'), MSG.hint);
  assert.equal(await say('¿estás ahí?'), '');
  clock.t += 61 * MIN;
  assert.equal(await say('sigo esperando a Pedro'), MSG.hint);
});

test('GREET_UNKNOWN=false: el bot calla ante lo que no entiende', async () => {
  const { say } = setup({ cfg: { greetUnknown: false } });
  assert.equal(await say('quiero hablar con Pedro'), '');
});

test('sweep: sesiones inactivas expiran con aviso', async () => {
  const { engine, say, clock } = setup({ cfg: { idleTimeoutMs: 10 * MIN } });
  await say('hola');
  clock.t += 5 * MIN;
  assert.deepEqual(engine.sweep(), []);
  clock.t += 6 * MIN;
  assert.deepEqual(engine.sweep(), [{ chatId: 'chat1', text: MSG.expired }]);
  assert.deepEqual(engine.sweep(), []); // no se repite
  assert.equal(await say('1'), MSG.hint); // "1" suelto en reposo ya no abre nada: solo la pista
});

test('una sesión vencida no se usa aunque sweep no haya corrido', async () => {
  const { say, clock, created } = setup({ cfg: { idleTimeoutMs: 10 * MIN } });
  await say('hola');
  await say('1');
  clock.t += 11 * MIN;
  await say('Mi correo está bloqueado, ext 1');
  assert.equal(created.length, 0); // ya no estaba en el formulario
});

// ───────────── Traspaso a analista ─────────────

test('traspaso: crea ticket, el bot calla, "menu" lo reactiva', async () => {
  const { say, created, clock } = setup({ cfg: { handoffSilenceMs: 120 * MIN } });
  await say('hola');
  const out = await say('7');
  assert.match(out, /Analista de Help Desk de Guardia/);
  assert.equal(created[0].type, 'Asistencia Manual Requerida');

  assert.equal(await say('hola'), ''); // ese "hola" es para el analista
  assert.equal(await say('traslados'), '');
  assert.equal(await say('necesito ayuda urgente'), '');
  assert.match(await say('menu'), /Selecciona tu requerimiento/);

  // y sin "menu", vuelve a la normalidad al terminar la ventana
  await say('7');
  clock.t += 121 * MIN;
  assert.match(await say('traslados'), /traslados\.avior/);
});

// ───────────── Árbol anidado y validación ─────────────

const nested = {
  root: 'r',
  nodes: {
    r: { type: 'menu', title: 'Raíz', options: [{ label: 'Sub', next: 's' }, { label: 'Dato', next: 'i' }] },
    s: { type: 'menu', title: 'Sub', options: [{ label: 'Forma', next: 'f' }] },
    i: { type: 'info', text: 'ℹ️ Dato fijo' },
    f: { type: 'form', title: 'Forma', ticketType: 'T', prompt: 'Dime todo', success: 'ok {ticket}' },
  },
};

test('menús anidados con "0 Volver" e info', async () => {
  const { say, created } = setup({ customFlow: nested });
  await say('menu');
  const sub = await say('1');
  assert.match(sub, /1️⃣ Forma/);
  assert.match(sub, /0️⃣ Volver/);
  assert.match(await say('0'), /2️⃣ Dato/); // volvió a la raíz
  assert.equal(await say('2'), 'ℹ️ Dato fijo');
  await say('1');
  assert.equal(await say('1'), 'Dime todo');
  assert.equal(await say('detalle suficiente'), 'ok REQ-TEST-1');
  assert.equal(created.length, 1);
});

test('validateFlow detecta typos al arrancar', () => {
  const bad = structuredClone(flow);
  bad.nodes.main.options[0].next = 'emial';
  assert.throws(() => validateFlow(bad), /next "emial" no existe/);

  const bad2 = structuredClone(flow);
  bad2.nodes.kiu.success = 'sin placeholder';
  assert.throws(() => validateFlow(bad2), /debe incluir \{ticket\}/);

  assert.throws(() => validateFlow({ root: 'x', nodes: {} }), /root "x" no existe/);
});

test('las FAQ de escalado apuntan a formularios que existen', () => {
  for (const e of entries) {
    if (e.escalate) assert.equal(flow.nodes[e.escalate]?.type, 'form', `${e.id} -> ${e.escalate}`);
  }
});
