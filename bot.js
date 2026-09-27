const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const nodemailer = require('nodemailer');

// Configuración del servidor SMTP
const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // true para puerto 465, false para otros puertos
    auth: {
        user: 'helpdesk@avior.com.ve',
        pass: '$oport3tecnic0-2020'
    }
});

// Función para generar ID único basado en fecha y hora
function generarIDTicket() {
    const fecha = new Date();
    const año = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    const horas = String(fecha.getHours()).padStart(2, '0');
    const min = String(fecha.getMinutes()).padStart(2, '0');
    const sec = String(fecha.getSeconds()).padStart(2, '0');
    return `REQ-${año}${mes}${dia}-${horas}${min}${sec}`;
}

// Función auxiliar para despachar los correos
async function sendTicketEmail(ticketId, tipoFalla, detallesRaw) {
    try {
        // Mapear los detalles en bruto del chat a una lista HTML limpia
        const lineasDetalles = detallesRaw
            .split('\n')
            .filter(linea => linea.trim() !== '') // Ignora líneas en blanco
            .map(linea => `<li style="margin-bottom: 5px;">${linea}</li>`)
            .join('');

        await transporter.sendMail({
            from: '"WhatsApp Bot Help Desk" <helpdesk@avior.com.ve>',
            to: 'helpdesk@avior.com.ve',
            subject: `🚨 Ticket [${ticketId}]: ${tipoFalla}`,
            html: `
                <p>Se ha generado un nuevo reporte automático desde WhatsApp.</p>
                <p>
                    <strong>ID del Ticket:</strong> ${ticketId}<br>
                    <strong>Tipo de Solicitud:</strong> ${tipoFalla}<br>
                </p>
                <div style="background-color: #f4f4f4; padding: 15px; border-left: 4px solid #005aa9; margin-top: 15px;">
                    <strong>Detalles proporcionados por el usuario:</strong><br>
                    <ul style="margin-top: 10px; padding-left: 20px; font-family: monospace; font-size: 14px;">
                        ${lineasDetalles}
                    </ul>
                </div>
                <p style="margin-top: 20px; color: #555;">🔍 <em>Para atender este caso, busca el Ticket <strong>${ticketId}</strong> en el buscador de WhatsApp.</em></p>
            `
        });
        console.log(`Correo enviado a helpdesk para el ticket: ${ticketId}`);
    } catch (error) {
        console.error('Error enviando la alerta por correo:', error);
    }
}

// Inicialización del cliente
const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('Escanea este código QR con el WhatsApp Business de la oficina.');
});

client.on('ready', () => {
    console.log('¡El bot de Help Desk está activo y escuchando!');
});

const userStates = {};

client.on('message', async (msg) => {
    if (msg.isGroupMsg) return;

    const chatId = msg.from;
    const text = msg.body.trim().toLowerCase();

    // Menú principal
    if (text === 'menu' || text === 'hola' || text === 'cancelar') {
        userStates[chatId] = { step: 'MENU' };
        
        await msg.reply(
            "✈️ *Help Desk - Informática Avior* \n\n" +
            "Bienvenido al soporte automatizado. Selecciona tu requerimiento:\n\n" +
            "1️⃣ Correo Corporativo (Bloqueo / Olvido / Creación)\n" +
            "2️⃣ Red e Internet (Falla de conexión en Estación u Oficina)\n" +
            "3️⃣ Sistema KIU (Bloqueo / Reseteo de firma)\n" +
            "4️⃣ Sistema SAP (Restablecimiento de clave)\n" +
            "5️⃣ Accesos Remotos y VPN\n" +
            "6️⃣ Falla de Hardware (PC, Impresoras, Teléfonos)\n" +
            "7️⃣ Hablar con un Analista de Guardia 👨‍💻\n\n" +
            "Responde con el número de tu opción. (Escribe *cancelar* en cualquier momento para volver aquí)."
        );
        return;
    }

    if (!userStates[chatId]) return;
    const currentState = userStates[chatId].step;

    if (currentState === 'MENU') {
        switch (text) {
            case '1':
                await msg.reply("📧 *Soporte de Correo Corporativo:*\n\nPor favor, responde en un solo mensaje indicando:\n- **Cuenta de correo** afectada.\n- **Número de contacto o Extensión**.\n- **Falla exacta** (Ej: Olvidé la clave, bloqueada).");
                userStates[chatId].step = 'WAITING_EMAIL_DATA';
                break;
            case '2':
                await msg.reply("🌐 *Reporte de Caída de Red/Internet:*\n\nPor favor, responde en un solo mensaje indicando:\n- **Estación/Área** (Ej: BLA, CCS, Piso 2).\n- **Número de contacto o Extensión**.\n- **Tipo de falla** (Ej: No hay Wi-Fi, internet lento).");
                userStates[chatId].step = 'WAITING_STATION_DATA';
                break;
            case '3':
                await msg.reply("✈️ *Soporte KIU:*\n\nPor favor, responde en un solo mensaje indicando:\n- **Firma o Usuario KIU**.\n- **Número de contacto o Extensión**.\n- **Problema** (Ej: Bloqueo por intentos, reseteo).");
                userStates[chatId].step = 'WAITING_KIU_DATA';
                break;
            case '4':
                await msg.reply("⚠️ *Seguridad SAP:*\n\nPor favor, escribe tu **Número de Empleado y Extensión/Teléfono**. Un analista te llamará para validar tu identidad antes del reseteo.");
                userStates[chatId].step = 'WAITING_SAP_DATA';
                break;
            case '5':
                await msg.reply("🔐 *Accesos Remotos y VPN:*\n\nPor favor, responde en un solo mensaje indicando:\n- **Usuario VPN**.\n- **Número de contacto o Extensión**.\n- **Sistema/IP** al que intentas acceder.");
                userStates[chatId].step = 'WAITING_VPN_DATA';
                break;
            case '6':
                await msg.reply("🛠️ *Soporte de Hardware/Equipos:*\n\nPor favor, responde en un solo mensaje indicando:\n- **Tipo de equipo** (PC, Impresora, Teléfono).\n- **Número de contacto o Extensión**.\n- **Ubicación exacta y falla**.");
                userStates[chatId].step = 'WAITING_HARDWARE_DATA';
                break;
            case '7':
                userStates[chatId].step = 'HUMAN_HANDOFF';
                const ticketIdManual = generarIDTicket();
                await msg.reply(`🚨 Entendido. Tu caso fue registrado bajo el ticket *${ticketIdManual}*.\n\nEstoy derivando tu chat al **Analista de Help Desk de Guardia**. Por favor espera un momento en línea.`);
                await sendTicketEmail(ticketIdManual, 'Asistencia Manual Requerida', 'El usuario ha solicitado hablar directamente con un analista.');                break;
            default:
                await msg.reply("Opción no válida. Por favor responde con un número del 1 al 7.");
                break;
        }
    } 
    
    // Captura de datos y asignación de ID
    else if (currentState === 'WAITING_EMAIL_DATA') {
        const ticketId = generarIDTicket();
        await msg.reply(`✅ Solicitud registrada con el ticket *${ticketId}*.\nUn analista revisará tu caso en breve.`);
await sendTicketEmail(ticketId, 'Soporte de Correo Corporativo', msg.body);        delete userStates[chatId];
    } 
    else if (currentState === 'WAITING_STATION_DATA') {
        const ticketId = generarIDTicket();
        await msg.reply(`✅ Reporte de red registrado con el ticket *${ticketId}*.\nEl equipo de infraestructura ha sido notificado.`);
        await sendTicketEmail(ticketId, 'Falla de Red/Internet', msg.body);
        delete userStates[chatId];
    } 
    else if (currentState === 'WAITING_KIU_DATA') {
        const ticketId = generarIDTicket();
        await msg.reply(`✅ Solicitud KIU registrada con el ticket *${ticketId}*.\nTe notificaremos apenas se procese.`);
        await sendTicketEmail(ticketId, 'Soporte Sistema KIU', msg.body);
        delete userStates[chatId];
    } 
    else if (currentState === 'WAITING_SAP_DATA') {
        const ticketId = generarIDTicket();
        await msg.reply(`✅ Solicitud SAP registrada con el ticket *${ticketId}*.\nMantente atento, te contactaremos para validar tu identidad.`);
        await sendTicketEmail(ticketId, 'Soporte Sistema SAP', msg.body);
        delete userStates[chatId];
    }
    else if (currentState === 'WAITING_VPN_DATA') {
        const ticketId = generarIDTicket();
        await msg.reply(`✅ Reporte VPN registrado con el ticket *${ticketId}*.\nEl equipo de seguridad revisará tus permisos.`);
        await sendTicketEmail(ticketId, 'Soporte VPN/Acceso Remoto', msg.body);
        delete userStates[chatId];
    }
    else if (currentState === 'WAITING_HARDWARE_DATA') {
        const ticketId = generarIDTicket();
        await msg.reply(`✅ Reporte de hardware registrado con el ticket *${ticketId}*.\nUn analista evaluará el caso a la brevedad.`);
        await sendTicketEmail(ticketId, 'Falla de Hardware/Equipos', msg.body);
        delete userStates[chatId];
    }
    else if (currentState === 'HUMAN_HANDOFF') {
        // Intervención manual, el bot no responde.
    }
});

client.initialize();