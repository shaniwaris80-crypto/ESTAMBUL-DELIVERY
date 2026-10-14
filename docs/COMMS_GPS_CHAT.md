# ESTAMBUL DELIVERY — GPS, Chat y avisos automáticos (fase de pruebas)

## Situación y funcionamiento

**GPS Rider:** botón **Activar GPS** en la app Rider. Requiere HTTPS, consentimiento del propio repartidor (permiso del móvil), estar online y tener pedido `recogido` o `en_ruta`. Actualiza cada ~14 segundos mientras la web esté visible; el rider puede detenerlo inmediatamente. Al ocultar la web o dejar de tener entregas en curso se detiene. Solo staff autorizado puede consultar las posiciones de los dos últimos minutos, desde **GPS de los repartidores**, con un enlace a Google Maps. No se publica ubicación exacta al cliente. El navegador y el SO pueden suspender GPS al bloquear el móvil: **no es seguimiento en segundo plano**. Para eso se necesitará app nativa, consentimiento específico y revisión de privacidad.

**Chat privado por pedido:** cada tarjeta activa de Rider tiene **Chat cliente**. El cliente puede abrirlo en su página privada `track.html#token=...` mientras el pedido esté `asignado`, `recogido` o `en_ruta`. Los mensajes se sincronizan por consulta periódica (~7 s), sin push. El acceso del cliente depende de poseer el enlace privado válido y el del rider depende de su sesión autenticada y asignación. Chat se cierra al entregar; los mensajes se conservan asociados al pedido. Límite de 450 caracteres y 5 mensajes/minuto del cliente, 8/minuto del rider. No compartir documentos de identidad, datos bancarios ni otros datos sensibles en el chat. El cliente debe recibir su enlace privado para poder utilizarlo.

**SMS y WhatsApp:** en crear/editar pedido, el administrador puede seleccionar `Sin avisos`, `SMS` o `WhatsApp` y registrar que el cliente solicitó esos **avisos de servicio**. Sin permiso y teléfono, no se habilita el canal. Los cambios de estado generan una entrada única en `private.ed_notification_queue`; no envía nada de inmediato. Los mensajes antiguos, los que han perdido el consentimiento y los estados superados se descartan antes de un intento de envío.

**Estado del proveedor: DESACTIVADO.** Edge Function `ed-send-notifications` desplegada con `verify_jwt=true`, requiere llamada de servidor autorizada con service role. La función **no hace envíos** salvo que `ESTAMBUL_MESSAGING_ENABLED=true`, secretos válidos de Twilio y un disparador programado del lado servidor. No hay una programación activa todavía. No introducir credenciales secretas en GitHub, en la web, ni en el chat.

## Activación posterior de SMS/WhatsApp con Twilio

1. Preparar cuenta de empresa en Twilio; registrar SMS sender en E.164 y un remitente WhatsApp Business aprobado.
2. Para WhatsApp, aprobar **plantillas de utilidad** mediante Content Template Builder para los estados que se notificarán. Usar `ContentSid` (HX...) y `ContentVariables`; no enviar mensajes libres fuera de la ventana de atención al cliente.
3. Configurar secretos del servidor mediante la herramienta de gestión de secretos de Supabase (no en el repositorio):
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_SMS_FROM`
   - `TWILIO_WHATSAPP_FROM`
   - `TWILIO_WA_TEMPLATE_ASIGNADO`, `TWILIO_WA_TEMPLATE_RECOGIDO`, `TWILIO_WA_TEMPLATE_EN_RUTA`, `TWILIO_WA_TEMPLATE_ENTREGADO`, `TWILIO_WA_TEMPLATE_CANCELADO` (solo para los estados realmente configurados)
4. Hacer pruebas con números internos autorizados, asegurarse de que el texto de cada plantilla usa {{1}} para la referencia. Activar de forma explícita el secreto `ESTAMBUL_MESSAGING_ENABLED=true` **solo después de validar costes, proveedores y permisos**.
5. Programar desde Supabase un cron server-to-server que invoque `ed-send-notifications` con una credencial de service role guardada fuera de la aplicación. La función limita a 8 entradas por ejecución; las marca como enviadas al recibir aceptación del proveedor, **no al acreditar recepción en el teléfono**. No dar permisos service role a un browser público.

Limitaciones: no existen webhooks de estado de entrega de Twilio ni reintentos automáticos en esta fase. Las comunicaciones promocionales o de recuperación requieren un flujo de consentimiento y bajas aparte. Los datos telefónicos no salen de Supabase mientras la mensajería permanezca desactivada.

## Privacidad y operaciones

- Página de seguimiento: no recibe coordenadas GPS, ni posición del rider, ni mensajes de otros pedidos.
- Los permisos RLS separan cuentas, rider y administrador. Las tablas de GPS y chat se escriben mediante RPC de servidor. No hay acceso anónimo a sus tablas.
- Hay que establecer información de privacidad/retención, hacer pruebas en teléfonos reales y verificar el cumplimiento RGPD antes de activar con clientes reales.
- Para SMS/WhatsApp en producción se requieren proveedores y autorización de los titulares del canal y de los destinatarios.

## Fase temporal: WhatsApp normal, envío iniciado por la persona

Mientras Twilio no está configurado, el administrador dispone del botón WhatsApp por pedido, que abre el teléfono y el texto de estado en WhatsApp normal. Solo se activa en pedidos con canal WhatsApp elegido, número válido y autorización registrada. El Rider también puede compartir el arqueo directamente por WhatsApp normal desde la app. En ambos casos es imprescindible revisar el mensaje y pulsar Enviar dentro de WhatsApp; **no se envía nada en segundo plano**. Los eventos SMS/WhatsApp automáticos permanecen en la cola de Supabase sin proveedor, como documentación del cambio de estado, sin envío real.
