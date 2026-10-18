# Estambul Delivery — WhatsApp automático de seguimiento

**18/10/2026: código preparado en rama de pruebas, NO activado en producción.**

## Por qué falla actualmente
El error Twilio 21655 significa que el ContentSid no existe o no pertenece a la cuenta que hace la petición. En la captura aparece el número de prueba de Twilio WhatsApp Sandbox, NO un remitente de producción. Ningún conector de ChatGPT tiene permiso para crear o aprobar la plantilla directamente en la cuenta Twilio.

## Plantilla propuesta (Utility · español)
Nombre: estambul_entrega_seguimiento_es

🛵🥙 ESTAMBUL DELIVERY

Tu pedido {{1}} ha sido aceptado y pronto estará en camino.

Consulta el estado de tu entrega en este enlace privado: {{2}}

Puedes seguir el mismo enlace sin recibir más avisos. ¡Gracias por elegirnos!

Variable 1: referencia del pedido. Variable 2: enlace privado y único de seguimiento.

## Activación en Twilio, sin revelar credenciales
1. **Rota el Auth Token visible en la captura** desde Twilio; actualiza el valor NUEVO en los secretos de Supabase. Nunca pegarlo en GitHub, mensajes o capturas.
2. En Twilio Console > Messaging > Content Template Builder, crea la plantilla Utility en español y envíala a revisión. Debe tener un SID HX de 34 caracteres que pertenezca a la misma cuenta AC que llama a Messages API.
3. Alternativa desde tu propio ordenador con Node 22: después de definir TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN como variables privadas de entorno, ejecuta:
   - node scripts/twilio-whatsapp-template.mjs create
   - Guarda el HX devuelto en TWILIO_WHATSAPP_CONTENT_SID
   - node scripts/twilio-whatsapp-template.mjs approve
   - node scripts/twilio-whatsapp-template.mjs status
   No copies secretos en los comandos.
4. WhatsApp Sandbox solo vale para teléfonos de prueba unidos al Sandbox. Para clientes reales registra el remitente de WhatsApp Business en Twilio.
5. Se requiere consentimiento **específico de WhatsApp**, no solo consentimiento previo para SMS.

## Variables para Supabase SOLO DESPUÉS de la aprobación
TWILIO_ACCOUNT_SID = cuenta Twilio del remitente y Content SID
TWILIO_AUTH_TOKEN = nuevo secreto rotado
TWILIO_WHATSAPP_FROM = whatsapp:+número_verificado
TWILIO_WHATSAPP_CONTENT_SID = HX... aprobado en esa cuenta
ED_WHATSAPP_AUTO_ENABLED = true (solo después de pruebas controladas)
El sistema usa flag false por defecto y mantiene el envío SMS a pedidos con consentimiento exclusivamente SMS.

## Implantación coordinada
Primero ensayar y aprobar docs/staging/one-tracking-message-sms-whatsapp-review.sql, y probar RLS/concurrencia. Después activar Edge y Rider coordinados, con WhatsApp OFF hasta comprobar template/Sender/opt-in.

Primera aceptación autorizada: valida Content SID y estado WhatsApp approved ANTES de reclamar el intento. Usa To/From whatsapp:+, ContentSid y ContentVariables. La PK order_id de la tabla compartida bloquea un nuevo intento por WhatsApp o SMS. No hay mensajes en cada cambio de estado. No hay reintentos automáticos tras timeout; provider accepted NO garantiza entregado al teléfono.

Probar pedido ficticio con teléfono propio unido al Sandbox, doble clic, falta de plantilla, plantilla pendiente, error 21655, fallos de conexión y revisión del Message SID entregado desde Twilio antes de producción.

Documentación Twilio: https://www.twilio.com/docs/content/content-api-resources
Error 21655: https://www.twilio.com/docs/api/errors/21655
