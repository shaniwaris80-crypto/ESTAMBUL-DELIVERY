# Estambul Delivery — Política de un solo SMS y pantalla de espera PRO
**18 de octubre de 2026 · PR #23 · RAMA DE PRUEBAS / NO PUBLICADA**

## Verificación de la incidencia (solo lectura de Supabase)
La auditoría encuentra dos mecanismos simultáneos:
- `ed-rider-accept-sms`: un mensaje inicial con enlace al pulsar «Aceptar».
- `private.ed_queue_customer_notification` + `ed-send-notifications`: mensajes separados al cambiar entre asignado, recogido, en ruta, entregado y cancelado.

Resumen agregado, sin teléfonos, nombres ni contenidos privados:
- 7 registros de SMS de seguimiento aceptado por el proveedor en 6 pedidos distintos; al menos un pedido recibió más de un intento aceptado.
- La cola de estados tiene varios mensajes SMS marcados `sent` para diferentes estados.
- Al menos un pedido aparece con SMS inicial aceptado y también mensajes SMS de estado marcados como enviados.
- Estos registros indican aceptación/procesamiento por el proveedor, **no prueban recepción física del SMS**.

## Nueva política exigida
1. Solo en la **primera aceptación** del pedido, el Rider autorizado solicita un enlace privado válido.
2. Antes de enviar a Twilio, una RPC `ed_claim_one_tracking_sms` realiza un INSERT con clave primaria `order_id`, irrepetible y transaccional.
3. Si se pulsa dos veces, hay doble petición o se intenta reenviar: **cero SMS adicionales**.
4. Si Twilio responde con un timeout o conexión rota, NO se reintenta automáticamente: se registra un intento gastado para evitar un envío duplicado. Es un compromiso deliberado de *at-most-once*: un envío puede no llegar.
5. No se envían SMS ni WhatsApp automáticos por cambios de estado: el mismo enlace privado refresca estado, ETA real y GPS autorizado.
6. Rider deja de llamar al servicio de estados y ya no ofrece «Reenviar seguimiento». El enlace se puede copiar manualmente cuando lo recibe por primera vez, sin enviar otro SMS.
7. Los antiguos SMS de estados no se deben descargar tras el cambio: la migración marca la cola pendiente como omitida, sustituye el trigger de la cola por un no-op e importa el historial de intentos al nuevo control.
8. La gestión de rescate de un enlace perdido, errores de destino o consentimiento debe ser una función futura para administración, con auditoría explícita. **No permitir reenvíos automáticos ni nuevos enlaces desde Rider.**

## Nueva página del cliente
- Cabecera principal con estado legible y un mensaje contextual, sin publicidad.
- Cinco fases: recibido → Rider asignado → recogido → en camino → entregado.
- Una única página que refresca el estado automáticamente cada 7 segundos cuando está visible.
- Hora de consulta reciente / sin conexión para evitar que el cliente confunda datos antiguos con vivo.
- Tiempo estimado únicamente si `ed_public_track` entrega `eta_minutes` válido; nunca usar una cuenta atrás simulada.
- Mapa solo con `live_location` reciente proporcionado por la RPC privada tras autorización del Rider.
- Acceso a teléfono del restaurante; al Rider solo si el número de trabajo está autorizado; chat privado y valoración mantienen su función.
- Diseño táctil con contraste, texto claro, puntos de progreso y accesibilidad para móvil.

## Orden obligatorio de activación en staging
1. Preparar un proyecto staging separado, duplicar solo estructura sin datos personales e instalar el nuevo SQL de `docs/staging/one-sms-tracking-policy-review.sql`.
2. Verificar función de un solo intento: dos llamadas concurrentes `ed_claim_one_tracking_sms` al mismo pedido → una TRUE y una FALSE; distintos pedidos → TRUE cada uno.
3. Comprobar que histórico de pruebas enviado por SMS queda registrado como intento gastado.
4. Desplegar `ed-send-notifications` no-op en staging antes de activar la nueva aceptación y verificar que ningún worker genera nuevas notificaciones de estado.
5. Desplegar `ed-rider-accept-sms` actualizada después de la migración; probar petición repetida y `resend=true` prohibido.
6. Validar SMS con **un teléfono de prueba expresamente autorizado**, usando la cuenta Twilio de test o el entorno real controlado; un pedido: aceptación → exactamente un mensaje de enlace; transiciones de estado → cero mensajes nuevos.
7. Simular error de red/timeout de Twilio para verificar que no hay reintento que pudiera duplicar el SMS. Inspeccionar SID de proveedor y, cuando exista, estado de entrega final sin inferirlo de `accepted`.
8. Probar pantalla privada en iOS/Android, anchos 320–430 px, Wi-Fi lento, sin GPS, con GPS, ETA ausente, orden cancelada, entregada y token vencido.
9. No activar en producción si fallan migración, backfill de históricos, RLS, mobile QA o pruebas Twilio.
10. **Para producción**, detener temporalmente workers/cron antiguos antes del despliegue coordinado, respaldar esquema, migrar y activar las dos Edge Functions y clientes juntos. Verificar cola vacía de SMS de estado y conservar una opción de rollback **que no reactive mensajes de estado**. No publicar PR #22 por separado sin esta corrección.

## Estado actual
- Código, CSS, lógica de pantalla y SQL de revisión guardados en PR #23 (basado en PR #22).
- Pruebas automatizadas de código y CI verificadas.
- NO se ha enviado SMS de prueba ni realizado llamadas a Twilio.
- NO se ha ejecutado SQL ni desplegado Edge Functions en Supabase producción.
- NO se ha fusionado ni alterado `main`.
- La recepción efectiva al móvil y *at-most-once* bajo fallos de red deben probarse en staging antes de publicar.
