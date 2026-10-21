# Despliegue en la nube gratuita

## 0. ⚠️ Antes de publicar nada: cambia la clave del correo

La contraseña SMTP de `helpdesk@avior.com.ve` estuvo escrita en `bot.js` y el repositorio es **público**, así que
está en el historial de git aunque ya no esté en el código actual. **Cámbiala ahora** y úsala solo como variable de
entorno (`SMTP_PASS`). Sacarla del historial (`git filter-repo`) es opcional una vez cambiada; cambiarla no lo es.

## 1. Dónde alojarlo (estado en octubre 2026, según la documentación de cada proveedor)

whatsapp-web.js necesita **Chromium** (≈ 400–600 MB de RAM) y un proceso encendido 24/7.

| Opción | Lo bueno | Lo malo |
|---|---|---|
| **Render (plan free)** — recomendada para probar | Despliegue desde GitHub con `render.yaml`, sin administrar servidores | Duerme tras **15 min sin tráfico entrante**; **sin disco persistente**; 750 h/mes por cuenta. La RAM del plan gratuito suele ser 512 MB (no pude confirmarlo en su documentación): Chromium puede quedarse corto |
| **Oracle Cloud Always Free (VM)** — plan B si Render se queda sin memoria | Mucha RAM: ARM Ampere **2 OCPU / 12 GB** (Oracle la redujo de 4/24) | Más trabajo (VM + Docker). Oracle puede **reclamar instancias "ociosas"** (CPU p95, red y memoria < 20 % durante 7 días), y un bot casi inactivo está en ese caso |
| Hugging Face Spaces | — | Los Docker Spaces ya **requieren plan de pago** → descartado |

La misma imagen Docker sirve para ambas. Empieza por Render; si en los logs ves reinicios por memoria, pasa a Oracle.

## 2. Base de datos para la sesión (MongoDB Atlas, gratis)

En un servidor sin disco persistente, WhatsApp pediría escanear el QR **en cada reinicio**. El bot guarda la sesión
en MongoDB (RemoteAuth) cuando existe `MONGODB_URI`.

1. Crea un cluster gratuito (M0) en MongoDB Atlas y un usuario con contraseña larga.
2. *Network Access* → permitir `0.0.0.0/0` (las IP de Render cambian; la protección es la contraseña).
3. *Connect → Drivers* → copia la URI (`mongodb+srv://usuario:clave@cluster.../avior`) → será `MONGODB_URI`.

## 3. Render, paso a paso

1. Sube este código a tu repositorio de GitHub.
2. Render → **New + → Blueprint** → elige el repo (lee `render.yaml`).
3. Completa las variables marcadas como secretas:
   - `ADMIN_KEY`: una clave larga inventada (protege la página del QR).
   - `MONGODB_URI`: la del paso 2.
   - `SMTP_USER`, `SMTP_PASS` (la **nueva**), `TICKET_TO`. Si el correo SMTP ya no funciona en tu tenant, ve a la sección 6.
4. Deploy. Cuando el log diga `[http] escuchando`, abre
   `https://TU-SERVICIO.onrender.com/qr?key=TU_ADMIN_KEY`.
5. En el teléfono: WhatsApp → *Dispositivos vinculados* → *Vincular un dispositivo* → escanea el QR de la página.
6. **Espera ~5 minutos** hasta ver en el log `sesión guardada en MongoDB`. Hasta entonces un reinicio pediría QR de nuevo.

## 4. El enlace para que cualquiera active el bot

- `https://TU-SERVICIO.onrender.com/` → página pública con botón **Abrir WhatsApp** y un QR (usa el número vinculado).
- O directamente `https://wa.me/<numero>?text=menu` (número en formato internacional sin `+`): abre el chat con "menu" escrito.

La persona entra, envía el mensaje y el bot responde con el menú.

## 5. Mantenerlo despierto (Render free)

Render duerme el servicio tras 15 min sin peticiones HTTP entrantes y el bot dejaría de escuchar. Crea un monitor
externo gratuito (UptimeRobot, cron-job.org, etc.) que haga `GET https://TU-SERVICIO.onrender.com/health` cada 5 minutos.
Un servicio activo 24/7 consume ~744 h de las 750 h mensuales; **no despliegues otros servicios free en la misma cuenta**.

## 6. Correo: SMTP o Microsoft Graph

El bot envía los tickets por correo. Microsoft anunció el retiro de la autenticación básica de SMTP AUTH
(`smtp.office365.com`) desde marzo de 2026 (confirma en el centro de mensajes de tu tenant). Además, M365 puede bloquear
inicios de sesión desde IP de centros de datos. Si los tickets no llegan (el log mostrará `[ticket] SIN CORREO ...`
con el ticket completo), usa Graph:

1. Entra ID → *App registrations* → nueva app → crea un *client secret*.
2. *API permissions* → Microsoft Graph → **Application** → `Mail.Send` → *Grant admin consent*.
3. (Recomendado) limita la app al buzón del Help Desk con una *Application Access Policy* de Exchange Online.
4. Variables: `MAIL_PROVIDER=graph`, `MAIL_FROM=helpdesk@avior.com.ve`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`,
   `GRAPH_CLIENT_SECRET`, `TICKET_TO`.

Opcional: `ADMIN_WHATSAPP=584121234567` hace que el bot te avise por WhatsApp si un ticket no pudo enviarse por correo.

## 7. Plan B: máquina virtual con Docker (Oracle u otro VPS)

```bash
git clone https://github.com/luisjcm/avior-bot && cd avior-bot
docker build -t avior-bot .
docker run -d --name avior-bot --restart unless-stopped -p 80:10000 --env-file .env avior-bot
```

`.env` basado en `.env.example` (con `MONGODB_URI` o, sin ella, monta un volumen: `-v avior-session:/data/session`).
Abre el puerto 80 en las reglas de red de la VM y entra a `http://IP/qr?key=...`.

## 8. Importante sobre el número de WhatsApp

- whatsapp-web.js es una librería **no oficial**: WhatsApp puede restringir o bloquear números que automatizan con ella.
  Para estas pruebas usa un **número secundario**, no el WhatsApp Business corporativo.
- Para producción, el camino soportado es la **WhatsApp Business Platform (API oficial de Meta)**; el motor
  (`src/engine.js`) no depende de whatsapp-web.js y se puede reutilizar detrás de un webhook.

## 9. Si algo falla

| Síntoma | Qué mirar |
|---|---|
| Reinicios constantes / `Out of memory` | Render free se queda corto con Chromium → pasar a la VM (sección 7) |
| El QR no aparece | Log del servicio; `/health` debe devolver `{"ok":true,"whatsapp":"qr"}` |
| Pide QR tras cada reinicio | Falta `MONGODB_URI` o no esperaste el mensaje `sesión guardada` |
| El bot no responde a los 15 min | Falta el monitor del paso 5 (servicio dormido) |
| Tickets sin correo | Sección 6; el detalle completo está en el log |
