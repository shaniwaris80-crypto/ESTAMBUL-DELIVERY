# Estambul Delivery PRO — Experiencia del cliente (fase 1)
Fecha: 2026-10-14 · Rama de trabajo: `feature/customer-experience-pro-v1`

## Objetivo
Mejorar la experiencia del cliente sin modificar el diseño del despacho, el arqueo ni las integraciones estables. No activar comunicaciones reales desde este cambio documental.

## Inventario verificado en el repositorio
- Ya existe seguimiento privado por pedido mediante `track.html#token=...` y `docs/track.js`.
- El seguimiento utiliza `ed_public_track` en Supabase y presenta estados, GPS opcional y ETA estimado.
- El acceso a la ubicación depende del consentimiento del rider y de la vigencia del dato; una PWA no garantiza GPS con pantalla bloqueada.
- Hay formulario de valoración posterior a la entrega y chat del cliente condicionado al estado.
- La documentación del repositorio distingue demos y conectores operativos; validar las integraciones reales en staging antes de hacer afirmaciones de producción.

## Contrato único de eventos (propuesta, no desplegado)
Unificar cambios de Last.app y GloriaFood en un evento interno:
`source`, `source_order_id`, `account_id`, `event_id`, `event_type`, `occurred_at`, `received_at`, `payment_method_raw`, `payment_method_normalized`, `order_status`, `customer_sms_opt_in`.

- Conservar valor original de método de pago y distinguir `cash`, `card_on_delivery`, `prepaid_online`, `unknown` sin inventar estados.
- Deduplicar por identificador estable de origen y evento; el mismo evento no debe generar dos SMS.
- Procesar fuera de la petición webhook en cola durable con reintentos y dead-letter.
- Firmas, autenticidad y autorización de webhooks deben verificarse según cada proveedor.
- No registrar tokens privados de seguimiento ni datos completos de clientes en logs.

## SMS transaccionales mediante Twilio (propuesta)
1. Pedido recibido y confirmado: solo cuando existe estado confiable del origen.
2. Salida a reparto: enlace privado de seguimiento por pedido.
3. Retraso significativo: aviso único por umbral configurable y reevaluación.
4. Nunca enviar a números de prueba no autorizados; separar marketing de comunicaciones de servicio.
5. Persistir `notification_id`, pedido, tipo, idioma, estado, referencia Twilio, intentos y errores minimizados.
6. Procesar callbacks de estado para distinguir aceptado, enviado, entregado y fallido.
7. Guardar credenciales Twilio exclusivamente en secretos del servidor, nunca en GitHub Pages, frontend o URL.

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
