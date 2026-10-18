# Estambul Delivery — WhatsApp de seguimiento sin duplicados
Preparación 2026-10-18. Propuesta sin instalar en producción.

## Error 21655 de la captura
El Content SID no se encuentra o no pertenece a la misma cuenta/subcuenta Twilio desde la que se envió el mensaje. La plantilla anterior Order Notifications además contiene variables de fecha y hora, no sirve para el seguimiento privado.
Referencia: https://www.twilio.com/docs/api/errors/21655

IMPORTANTE: En la captura parece visible un Auth Token. Regenera ese token en Twilio y actualízalo en Supabase Secrets. No lo pegues en el chat, en GitHub ni en archivos.

## Plantilla nueva que prepara el script
Nombre: estambul_delivery_tracking_es_v1
Idioma: es
Tipo: twilio/text
Categoría WhatsApp: UTILITY
Variables: {{1}} referencia del pedido, {{2}} URL privada del mismo pedido.

Texto exacto:
🛵🥙 ESTAMBUL DELIVERY: tu pedido {{1}} ha sido aceptado. Consulta su seguimiento privado aquí: {{2}}. Puedes ver los cambios de estado en el mismo enlace. Gracias por tu pedido.

## Crear en la cuenta de Twilio real (sin exponer credenciales)
Desde un ordenador propio con Node 22, y las variables TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN cargadas en el entorno local (o TWILIO_API_KEY y TWILIO_API_SECRET de la misma cuenta), ejecutar:

1. node scripts/create-estambul-whatsapp-template.mjs create
2. Copiar el SID real devuelto por Twilio que comienza por HX.
3. node scripts/create-estambul-whatsapp-template.mjs approve HX_DEL_PASO_2
4. node scripts/create-estambul-whatsapp-template.mjs verify HX_DEL_PASO_2

El resultado debe indicar que la plantilla pertenece a la cuenta y estado whatsapp_status=approved. Estas acciones crean/revisan plantillas, NO envían mensajes. La revisión Meta puede tardar varias horas.

## Conexión futura a Supabase Edge Function Secrets
- TWILIO_ACCOUNT_SID: AC de cuenta propietaria de plantilla/remitente.
- TWILIO_AUTH_TOKEN: token privado ya regenerado.
- TWILIO_WHATSAPP_FROM: número E.164 registrado como WhatsApp Sender.
- TWILIO_WHATSAPP_CONTENT_SID: HX creado y aprobado.
- ESTAMBUL_WHATSAPP_ENABLED: true sólo después de pruebas. De inicio está desactivado.

El remitente sandbox +14155238886 es SOLO para tests con móviles que se unieron al Sandbox, no producción. En el código se exige además ESTAMBUL_WHATSAPP_TEST_MODE=true y TWILIO_WHATSAPP_TEST_TO para restringir pruebas al número autorizado. Para producción es necesario registrar un remitente WhatsApp Business propio.

## Garantías del código
- WhatsApp automático sólo para pedidos que hayan autorizado ese canal: notifications_consent=true y notification_channel=whatsapp.
- No se cambian consentimientos existentes de SMS a WhatsApp ni se envían ambos.
- Content SID se verifica con la misma cuenta y la aprobación Meta antes de reclamar el mensaje.
- Una única clave primaria order_id compartida por SMS/WhatsApp evita reintentos automáticos y duplicados entre canales.
- Mensajería de cambios de estado continúa apagada: el enlace original se actualiza automáticamente.
- Un timeout de envío deja el intento gastado, para evitar mensajes duplicados.
- Si el canal no está configurado/aprobado y no se intentó enviar, Rider conserva opción manual con consentimiento.
- No se escribe el enlace privado en logs ni se publican tokens de clientes.
- Las asignaciones manuales LastPOS y cobros quedan intactos.

## Publicación condicionada
1. Backup verificado y SQL de docs/staging/ed_one_whatsapp_tracking_review.sql ensayada en staging.
2. Plantilla HX de la misma cuenta, aprobada. Remitente real registrado.
3. Test autorizado con un teléfono: exactamente un mensaje al aceptar y cero al cambiar estado. Inspeccionar entrega final Twilio, no sólo aceptación HTTP.
4. Una vez aprobado, publicar función y configurar secretos; habilitar WhatsApp sólo en pedidos con consentimiento específico.
5. Conservar SMS como canal aparte, sin fallback automático que duplique.

ESTADO: código y script preparados en rama de prueba. No se ha creado ninguna plantilla en Twilio desde ChatGPT, no se han enviado mensajes ni se ha activado WhatsApp.
