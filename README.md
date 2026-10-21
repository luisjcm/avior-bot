# Avior Help Desk Bot

Bot de WhatsApp (whatsapp-web.js) que atiende el Help Desk de Informática: menú guiado, respuestas
automáticas a preguntas frecuentes y creación de tickets que se envían por correo.

## Estructura

```
bot.js              Arranque: configura cliente, correo, servidor web y apagado ordenado
src/flow.js         ÁRBOL de conversación (solo datos)        ← edita aquí menús y formularios
src/faq.js          Preguntas frecuentes y enlaces (solo datos) ← edita aquí las FAQ
src/engine.js       Motor: estados, menús, formularios, expiración, traspaso a analista
src/tickets.js      ID de ticket, correo en segundo plano con reintentos
src/mailer.js       Proveedores de correo: SMTP o Microsoft Graph
src/app.js          Conecta whatsapp-web.js con el motor (cola por chat, filtros)
src/server.js       Web: enlace público, /health y /qr protegido
test/               55 pruebas (npm test) — no necesitan WhatsApp ni Chromium
```

## Agregar o cambiar opciones del menú (`src/flow.js`)

Cada nodo es un `menu`, `form`, `handoff` o `info`. El menú se numera solo; para añadir una opción
nueva basta un nodo y una línea en `options`:

```js
// 1) el nodo
telefonia: {
  type: 'form', title: 'Telefonía', ticketType: 'Soporte de Telefonía',
  prompt: '☎️ *Telefonía:*\n\nIndica *extensión* y *falla*.',
  success: '✅ Reporte registrado con el ticket *{ticket}*.',
},
// 2) en main.options
{ label: 'Telefonía / Extensiones', next: 'telefonia' },
```

Al arrancar se valida el árbol: un `next` mal escrito detiene el bot con un mensaje claro en vez de fallar
en producción. Los menús pueden anidarse (el motor agrega "0 Volver").
Formato de WhatsApp: `*negrita*` con **un** asterisco.

## Agregar una pregunta frecuente (`src/faq.js`)

```js
{
  id: 'link-intranet',
  kind: 'link',                 // 'link' | 'info' | 'route'
  label: 'intranet',            // aparece en "Enlaces rápidos"
  match: [['intranet'], ['portal', 'empleado']],   // [[A], [B y C]] = A  ó  (B y C)
  answer: '🏢 *Intranet:*\nIngresa aquí: https://...',
}
```

- `'abc'` coincide con el *inicio* de una palabra (`traslad` → traslado, traslados); `'=abc'` solo con la palabra exacta.
- Sin tildes ni mayúsculas: se normaliza el texto antes de comparar.
- `escalate: 'email'` hace que, tras responder, el bot ofrezca abrir el reporte de ese formulario (1 = sí, 2 = no).
- Más términos en un grupo = más específico; si dos FAQ distintas empatan, el bot no adivina y muestra la pista del menú.
- Las FAQ `info-horario` e `info-contacto` vienen **desactivadas** (`enabled: false`): complétalas con datos reales y actívalas.
- Las FAQ de autoayuda incluidas (internet, impresora) son genéricas: revísalas para que apliquen a Avior.

## Comportamiento por defecto

| Situación | Qué hace |
|---|---|
| `hola`, `menu`, `cancelar`, `buenas tardes` | Muestra el menú |
| Escribe un problema dentro de un formulario | Lo guarda en el ticket (no lo interrumpen los enlaces) |
| Pregunta suelta ("link de cargo", "no tengo internet") | Responde la FAQ; si aplica, ofrece abrir el reporte |
| Mensaje que no entiende | Pista "escribe *menu*" (máx. 1 vez cada 6 h por chat) |
| Opción 7 (analista) | Crea ticket y **calla 2 h** para no hablar encima del analista; `menu` lo reactiva |
| Sin respuesta 10 min en un menú/formulario | Cierra la sesión con aviso |
| Imagen sin texto en un formulario | Pide que lo describa por escrito (el ticket no se crea vacío) |

## Desarrollo local

```bash
cp .env.example .env     # rellena SMTP_PASS, etc.
npm install
npm run dev              # QR en consola y en http://localhost:3000/qr?key=<ADMIN_KEY>
npm test
```

Despliegue en la nube: ver [DEPLOY.md](DEPLOY.md).

> Nota: el repo tenía `pnpm-lock.yaml` y `pnpm-workspace.yaml` junto a `package-lock.json`. El Dockerfile usa
> `npm ci`; conviene borrar los de pnpm para no tener dos lockfiles que se desincronicen.
