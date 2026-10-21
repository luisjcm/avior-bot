'use strict';

/**
 * ÁRBOL DE CONVERSACIÓN (solo datos, sin lógica).
 *
 * Para agregar o cambiar opciones edita este archivo; el motor (engine.js)
 * numera los menús y valida el árbol al arrancar.
 *
 * Tipos de nodo:
 *   menu    -> lista numerada. options: [{ label, next }]. Puede anidarse (aparece "0 Volver").
 *   form    -> pide los datos en UN mensaje y crea el ticket.
 *              { title, ticketType, prompt, success, minLength? }
 *              En `success` usa {ticket} para insertar el número de ticket.
 *   handoff -> crea ticket y deja el chat en silencio para que responda un analista.
 *   info    -> responde un texto fijo y deja al usuario en el menú.
 *
 * Formato WhatsApp: *negrita*  _cursiva_  (un solo asterisco, no dos).
 */
module.exports = {
  root: 'main',
  nodes: {
    main: {
      type: 'menu',
      title: '✈️ *Help Desk - Informática Avior*',
      intro: 'Bienvenido al soporte automatizado. Selecciona tu requerimiento:',
      footer: 'Responde con el número de tu opción. (Escribe *cancelar* en cualquier momento para volver aquí).',
      options: [
        { label: 'Correo Corporativo (Bloqueo / Olvido / Creación)', next: 'email' },
        { label: 'Red e Internet (Falla de conexión en Estación u Oficina)', next: 'network' },
        { label: 'Sistema KIU (Bloqueo / Reseteo de firma)', next: 'kiu' },
        { label: 'Sistema SAP (Restablecimiento de clave)', next: 'sap' },
        { label: 'Accesos Remotos y VPN', next: 'vpn' },
        { label: 'Falla de Hardware (PC, Impresoras, Teléfonos)', next: 'hardware' },
        { label: 'Hablar con un Analista de Guardia 👨‍💻', next: 'analista' },
      ],
    },

    email: {
      type: 'form',
      title: 'Correo Corporativo',
      ticketType: 'Soporte de Correo Corporativo',
      prompt:
        '📧 *Soporte de Correo Corporativo:*\n\n' +
        'Por favor, responde en un solo mensaje indicando:\n' +
        '- *Cuenta de correo* afectada.\n' +
        '- *Número de contacto o Extensión*.\n' +
        '- *Falla exacta* (Ej: Olvidé la clave, bloqueada).',
      success: '✅ Solicitud registrada con el ticket *{ticket}*.\nUn analista revisará tu caso en breve.',
    },

    network: {
      type: 'form',
      title: 'Red e Internet',
      ticketType: 'Falla de Red/Internet',
      prompt:
        '🌐 *Reporte de Caída de Red/Internet:*\n\n' +
        'Por favor, responde en un solo mensaje indicando:\n' +
        '- *Estación/Área* (Ej: BLA, CCS, Piso 2).\n' +
        '- *Número de contacto o Extensión*.\n' +
        '- *Tipo de falla* (Ej: No hay Wi-Fi, internet lento).',
      success: '✅ Reporte de red registrado con el ticket *{ticket}*.\nEl equipo de infraestructura ha sido notificado.',
    },

    kiu: {
      type: 'form',
      title: 'Sistema KIU',
      ticketType: 'Soporte Sistema KIU',
      prompt:
        '✈️ *Soporte KIU:*\n\n' +
        'Por favor, responde en un solo mensaje indicando:\n' +
        '- *Firma o Usuario KIU*.\n' +
        '- *Número de contacto o Extensión*.\n' +
        '- *Problema* (Ej: Bloqueo por intentos, reseteo).',
      success: '✅ Solicitud KIU registrada con el ticket *{ticket}*.\nTe notificaremos apenas se procese.',
    },

    sap: {
      type: 'form',
      title: 'Sistema SAP',
      ticketType: 'Soporte Sistema SAP',
      prompt:
        '⚠️ *Seguridad SAP:*\n\n' +
        'Por favor, escribe tu *Número de Empleado y Extensión/Teléfono*. ' +
        'Un analista te llamará para validar tu identidad antes del reseteo.',
      success:
        '✅ Solicitud SAP registrada con el ticket *{ticket}*.\n' +
        'Mantente atento, te contactaremos para validar tu identidad.',
    },

    vpn: {
      type: 'form',
      title: 'Accesos Remotos y VPN',
      ticketType: 'Soporte VPN/Acceso Remoto',
      prompt:
        '🔐 *Accesos Remotos y VPN:*\n\n' +
        'Por favor, responde en un solo mensaje indicando:\n' +
        '- *Usuario VPN*.\n' +
        '- *Número de contacto o Extensión*.\n' +
        '- *Sistema/IP* al que intentas acceder.',
      success: '✅ Reporte VPN registrado con el ticket *{ticket}*.\nEl equipo de seguridad revisará tus permisos.',
    },

    hardware: {
      type: 'form',
      title: 'Falla de Hardware',
      ticketType: 'Falla de Hardware/Equipos',
      prompt:
        '🛠️ *Soporte de Hardware/Equipos:*\n\n' +
        'Por favor, responde en un solo mensaje indicando:\n' +
        '- *Tipo de equipo* (PC, Impresora, Teléfono).\n' +
        '- *Número de contacto o Extensión*.\n' +
        '- *Ubicación exacta y falla*.',
      success: '✅ Reporte de hardware registrado con el ticket *{ticket}*.\nUn analista evaluará el caso a la brevedad.',
    },

    analista: {
      type: 'handoff',
      title: 'Analista de Guardia',
      ticketType: 'Asistencia Manual Requerida',
      details: 'El usuario ha solicitado hablar directamente con un analista.',
      message:
        '🚨 Entendido. Tu caso fue registrado bajo el ticket *{ticket}*.\n\n' +
        'Estoy derivando tu chat al *Analista de Help Desk de Guardia*. Por favor espera un momento en línea.',
    },
  },
};
