# Estambul Delivery PRO — Experiencia del cliente (fase 1)
Fecha: 2026-10-20 · Rama de trabajo: `feature/customer-experience-pro-v1`\n\n**Estado:** se aplicó la paleta y el diseño móvil del seguimiento en esta rama. La aceptación RPC y Edge Function existen en staging; faltan callback de entrega, reintentos seguros y las pruebas indicadas. PR 17 sigue en borrador.

## Objetivo
Rediseñar el centro de operaciones, Rider y seguimiento según las capturas, conservar Last.app intacta y cerrar una sola notificación SMS automática por pedido. Las pruebas se limitan a staging con fixtures y mock sin red; no se activa Twilio.

## Inventario verificado en el repositorio
- Ya existe seguimiento privado por pedido mediante `track.html#token=...` y `docs/track.js`.
- El seguimiento utiliza `ed_public_track` en Supabase y presenta estados, GPS opcional y ETA estimado.
- El acceso a la ubicación depende del consentimiento del rider y de la vigencia del dato; una PWA no garantiza GPS con pantalla bloqueada.
- Hay formulario de valoración posterior a la entrega y chat del cliente condicionado al estado.
- La documentación del repositorio distingue demos y conectores operativos; validar las integraciones reales en staging antes de hacer afirmaciones de producción.

## Contrato SMS único por pedido

La única comunicación automática prevista es **un SMS con el enlace privado cuando el Rider acepta por primera vez un pedido asignado**. No se envía otro SMS al recoger, iniciar ruta, cambiar el estado, reintentar un webhook o cerrar el arqueo.

- Deduplicar la aceptación mediante bloqueo transaccional por pedido, `accepted_at` y un token privado único. Aceptaciones simultáneas deben producir un enlace y un intento como máximo.
- Exigir consentimiento de SMS, teléfono válido E.164 y pedido activo. No enviar a teléfonos de fixtures ni llamar a Last.app/GloriaFood durante estas pruebas.
- Registrar estado mínimo y referencia del proveedor, sin cuerpo SMS, teléfono, token ni secretos en logs.
- El callback firmado del proveedor debe actualizar el estado de forma idempotente: `provider_accepted` no equivale a `delivered`.
- Reintentar solo rechazos definitivos que confirmen que el proveedor no creó el mensaje, con límite y deduplicación por pedido. Un timeout o respuesta ambigua queda en revisión manual; reenviar automáticamente podría duplicar el SMS.
- Credenciales Twilio solo en secretos del servidor. El flag de mensajería permanece apagado en staging.

## Experiencia visual inspirada en las capturas

- En móvil, si el Rider comparte GPS reciente, mapa primero y tarjeta inferior solapada con estado, progreso y hora estimada.
- Acciones claras para llamar al restaurante y contactar con el Rider; el mapa y el chat respetan los permisos y el estado del pedido.
- Paleta carbón `#171d1a`, verde `#4b8746`, lima `#b8e45a`, ámbar `#dfa52f` y fondos marfil. Mantener estados de error, pago y éxito diferenciables por texto e icono además del color.
- Last.app continúa como autoridad de asignación. Las reglas de webhook, pedidos y pagos no se alteran con el cambio de CSS.

## Pruebas obligatorias en staging

- [ ] Pedido sintético de Last.app y GloriaFood en fixtures aislados aparece una sola vez; no llamar a esos servicios.
- [ ] Dos aceptaciones concurrentes del mismo pedido producen un token y un único intento SMS simulado.
- [ ] Repetición del webhook/aceptación no crea segundo token ni mensaje.
- [ ] Consentimiento ausente, teléfono inválido y pedido cancelado producen estado explicable y cero intentos al proveedor.
- [ ] Mock local sin salida de red cubre aceptación, rechazo definitivo, timeout ambiguo y callback duplicado.
- [ ] Rechazo definitivo permite solo el reintento configurado; timeout ambiguo no reenvía automáticamente.
- [ ] `skipped` no aparece como enviado ni entregado.
- [ ] Enlace de un pedido no permite ver otro; token caducado o revocado deja de funcionar.
- [ ] Rider sin compartir GPS, GPS antiguo, entrega/cancelación y permiso retirado no exponen posición.
- [ ] Efectivo, tarjeta y prepago se conservan; asignar, cancelar o cerrar arqueo no duplica importes.
- [ ] Móvil sin conexión, reanudación, accesibilidad, build, typecheck y E2E se verifican antes de aprobar.
- [ ] Rollback con fixtures revierte tokens, recibos, SMS simulados y cambios de arqueo; las filas iniciales se comparan antes/después.

## Seguridad del seguimiento
- Token aleatorio de alta entropía, caducidad, revocación y exposición solo del pedido correspondiente.
- No transmitir teléfono, dirección completa ni identidad de otros clientes desde RPC pública.
- GPS visible solo durante reparto autorizado y con datos recientes.
- Desactivar ubicación al entregar, cancelar, revocar o perder frescura.
- ETA no debe prometer minutos exactos si falta ruta vial o señal GPS confiable.
- Páginas de seguimiento con cabeceras anti-indexación y política de referer restrictiva donde lo permita el hosting.

## Pruebas obligatorias de staging
- [ ] Pedido Last.app y GloriaFood aparecen una sola vez.
- [ ] Webhook repetido, fuera de orden o reintentado no repite SMS.
- [ ] Pedido cancelado no muestra repartidor ni vuelve a notificar salida.
- [ ] Enlace de un pedido no permite ver otro.
- [ ] Token caducado o revocado deja de funcionar.
- [ ] Rider sin compartir posición no revela GPS.
- [ ] GPS caducado desaparece y ETA se sustituye por mensaje prudente.
- [ ] Twilio fallo/transitorio: reintento limitado, trazabilidad y alerta al supervisor.
- [ ] Twilio callback duplicado no modifica erróneamente el estado.
- [ ] Efectivo, tarjeta al entregar y prepagado quedan correctamente clasificados sin afectar arqueo.
- [ ] Valorar dos veces el mismo pedido no crea dos reseñas internas.
- [ ] Móvil offline, pantalla bloqueada y retorno a foreground se prueban en Android e iOS.
- [ ] Contraste, lector de pantalla, navegación por teclado y botones táctiles accesibles.
- [ ] Migraciones, permisos RLS y copias de seguridad validados antes de liberar.
- [ ] Rollback de funciones SMS/ETA mediante flags independientes; la recepción y entrega de pedidos sigue operativa.

## Implantación sin riesgo
1. Auditar en staging los webhooks, esquema de pedidos, SQL y puntos de integración actuales.
2. Añadir ingestión idempotente, bandeja de eventos y salida de notificaciones en backend separado, deshabilitados por defecto.
3. Probar con pedidos y teléfonos de test autorizados.
4. Mejorar la vista de cliente únicamente cuando haya datos reales y verificables.
5. Activar por origen/canal y porcentaje, con monitorización, rollback y aprobación humana.
6. No fusionar ni desplegar a `main` hasta completar aceptación.

**Estado:** documento de alcance y plan de pruebas en rama aislada; no certifica que las integraciones externas estén operativas.
