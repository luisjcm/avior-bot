const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const nodemailer = require('nodemailer');

// Configuración del servidor SMTP
const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com', // Cambia esto por el host SMTP corporativo
    port: 587,
    secure: false, // true para puerto 465, false para otros puertos
    auth: {
        user: 'helpdesk@avior.com.ve', // Cuenta de envío
        pass: '$oport3tecnic0-2020'
    }
});

// Función auxiliar para despachar los correos
async function sendTicketEmail(tipoFalla, numeroUsuario, detalles) {
    try {
        await transporter.sendMail({
            from: '"WhatsApp Bot Help Desk" <helpdesk@avior.com.ve>',
            to: 'helpdesk@avior.com.ve',
            subject: `🚨 Nuevo Reporte Bot: ${tipoFalla}`,
            text: `Se ha generado un nuevo reporte automático desde WhatsApp.\n\n` +
                  `Tipo de Solicitud: ${tipoFalla}\n` +
                  `Número de Contacto: ${numeroUsuario.replace('@c.us', '')}\n` +
                  `Detalles proporcionados: ${detalles}\n\n` +
                  `Por favor, asignar y atender a la brevedad.`
        });
        console.log(`Correo enviado a helpdesk para el caso: ${tipoFalla}`);
    } catch (error) {
        console.error('Error enviando la alerta por correo:', error);
    }
}

// LocalAuth guarda la sesión para que no tengas que escanear el QR cada vez que reinicies
const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
    // Genera el código QR en tu terminal para vincular el teléfono de guardia
    qrcode.generate(qr, { small: true });
    console.log('Escanea este código QR con el WhatsApp Business de la oficina.');
});

client.on('ready', () => {
    console.log('¡El bot de Help Desk está activo y escuchando!');
});

// Estructura simple para almacenar el estado de los usuarios
const userStates = {};

client.on('message', async (msg) => {
    if (msg.isGroupMsg) return;

    const chatId = msg.from;
    const text = msg.body.trim().toLowerCase();

    // Comando universal para reiniciar o salir de cualquier flujo
    if (text === 'menu' || text === 'hola' || text === 'cancelar') {
        userStates[chatId] = { step: 'MENU' };
        
        await msg.reply(
            "✈️ *Help Desk - Informática Avior* \n\n" +
            "Bienvenido al soporte automatizado. Selecciona tu requerimiento:\n\n" +
            "1️⃣ Correo Corporativo (Bloqueo / Olvido de clave)\n" +
            "2️⃣ Falla de Internet en Oficina/Estación\n" +
            "3️⃣ Sistema KIU (Olvido / Bloqueo de firma)\n" +
            "4️⃣ Sistema SAP (Restablecimiento de clave)\n" +
            "5️⃣ Hablar con un Analista de Guardia 👨‍💻\n\n" +
            "Responde con el número de tu opción. (Escribe *cancelar* en cualquier momento para volver aquí)."
        );
        return;
    }

    if (!userStates[chatId]) return; // Ignorar si no ha iniciado con saludo
    const currentState = userStates[chatId].step;

    if (currentState === 'MENU') {
        switch (text) {
            case '1':
                await msg.reply("📧 *Soporte de Correo Corporativo:*\n\nPor favor, escribe tu **Dirección de Correo** y especifica si está bloqueada o si olvidaste la clave.");
                userStates[chatId].step = 'WAITING_EMAIL_DATA';
                break;
            case '2':
                await msg.reply("🌐 *Reporte de Caída de Internet:*\n\nPor favor, indica en qué **Estación (ej. BLA, CCS) y Área/Oficina específica** te encuentras actualmente.");
                userStates[chatId].step = 'WAITING_STATION_DATA';
                break;
            case '3':
                await msg.reply("✈️ *Soporte KIU:*\n\nPor favor, indica tu **Firma o Usuario KIU** y si está bloqueado o necesitas reseteo.");
                userStates[chatId].step = 'WAITING_KIU_DATA';
                break;
            case '4':
                await msg.reply("⚠️ *Seguridad SAP:*\n\nPor políticas de seguridad, el reseteo de SAP requiere validación de identidad.\n\nPor favor, escribe tu **Número de Empleado y Extensión/Teléfono**. Un analista te llamará a la brevedad.");
                userStates[chatId].step = 'WAITING_SAP_DATA';
                break;
            case '5':
                userStates[chatId].step = 'HUMAN_HANDOFF';
                await msg.reply("🚨 Entendido. Estoy derivando tu caso al **Analista de Help Desk de Guardia**. Por favor espera un momento en línea.");
                await sendTicketEmail('Asistencia Manual Requerida', chatId, 'El usuario ha solicitado hablar directamente con un analista.');
                break;
            default:
                await msg.reply("Opción no válida. Por favor responde con un número del 1 al 5.");
                break;
        }
    } 
    // Captura de datos para generación de tickets automáticos
    else if (currentState === 'WAITING_EMAIL_DATA') {
        await msg.reply(`✅ Solicitud de correo registrada.\nDatos recibidos: *${msg.body}*.\nUn analista revisará tu cuenta en breve.`);
        await sendTicketEmail('Soporte de Correo Corporativo', chatId, msg.body);
        delete userStates[chatId];
    } 
    else if (currentState === 'WAITING_STATION_DATA') {
        await msg.reply(`✅ Falla de internet reportada para la ubicación: *${msg.body}*.\nEl equipo de infraestructura ha sido notificado.`);
        await sendTicketEmail('Falla de Internet', chatId, msg.body);
        delete userStates[chatId];
    } 
    else if (currentState === 'WAITING_KIU_DATA') {
        await msg.reply(`✅ Ticket de KIU generado para la firma: *${msg.body}*.\nTe notificaremos apenas se restablezca.`);
        await sendTicketEmail('Soporte Sistema KIU', chatId, msg.body);
        delete userStates[chatId];
    } 
    else if (currentState === 'WAITING_SAP_DATA') {
        await msg.reply(`✅ Solicitud SAP registrada. Mantente atento a tu extensión/teléfono (*${msg.body}*), un analista de guardia te contactará para validar tu identidad.`);
        await sendTicketEmail('Soporte Sistema SAP', chatId, msg.body);
        delete userStates[chatId];
    } 
    else if (currentState === 'HUMAN_HANDOFF') {
        // Silencio del bot. Todo lo que el usuario escriba aquí lo lees tú directamente en el teléfono.
    }
});

client.initialize();