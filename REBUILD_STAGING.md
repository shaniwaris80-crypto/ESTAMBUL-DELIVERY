# Estambul Delivery — reconstrucción aislada para staging

## Objetivo
Rehacer Back Office, Rider y seguimiento de cliente en una rama aislada, manteniendo la integración existente con Last.app como contrato de entrada y fuente de verdad para pedidos y asignaciones. La integración se preserva y se valida; no se reemplaza ni se desconecta durante la reconstrucción.

## Límites de este trabajo
- Rama: `rebuild/staging-first`, basada en `main`.
- No fusionar, desplegar ni modificar `main` desde esta reconstrucción.
- No borrar, truncar ni restaurar datos de Supabase.
- No enviar SMS/WhatsApp ni crear pedidos reales. Las pruebas usan exclusivamente datos ficticios en staging.
- No guardar secretos de Last.app, Supabase ni Twilio en GitHub o código cliente.
- La app actual y la configuración externa de Last.app se mantienen como referencia y recuperación.

## Inventario que se conserva
- Ingesta Last.app: `supabase/functions/ed-last-webhook` y `supabase/functions/ed-last-auto-sync`.
- Esquema y reglas Last.app: migraciones `012` y `015–023` de `supabase/migrations`.
- Contrato y límites conocidos: `docs/LAST_APP_INTEGRATION.md`.
- Aplicación existente completa en `main`, sin cambios durante la nueva implementación.
- Configuración de integración fuera de GitHub (secrets, URL de webhook y credenciales) sin cambios.

## Funciones objetivo de la app nueva
1. Back Office: cola de pedidos clara, búsqueda/filtros, asignación según flujo actual de Last.app, incidencias de sincronización y estado de conexión.
2. Rider: pedidos asignados, navegación, transiciones de estado seguras, GPS con consentimiento y arqueo efectivo/tarjeta.
3. Cliente: enlace privado de seguimiento, ETA/GPS cuando esté disponible y datos de contacto.
4. Notificaciones: envío único e idempotente por pedido, con estados de cola, error y reintento; solo se habilitarán tras pruebas controladas.
5. Seguridad: roles y RLS por organización; tokens de servicio solo en backend; mínimo acceso por rol.
6. Compatibilidad Last.app: deduplicación por ID externo, validación de firma/webhook, reintentos y reconciliación; no asignar por nombre ambiguo ni cambiar el flujo de asignación configurado.

## Puertas de aceptación en staging
- Migraciones aplicadas y reversibles en staging; esquema de producción sin cambios.
- Casos de pedido Last.app de prueba: creado, actualizado, cancelado, duplicado, evento fuera de orden y timeout/reintento.
- Asignaciones respetan la fuente Last.app y no generan duplicados ni reasignaciones silenciosas.
- RLS comprobada con usuarios admin, dispatcher y rider.
- SMS/WhatsApp en modo simulación: verificar un solo mensaje por pedido sin contactar teléfonos reales.
- GPS, estados Rider, arqueo y restauración comprobados con datos sintéticos.
- Compilación, pruebas automatizadas y E2E en staging aprobados.
- Comparación de flujos y datos antes de proponer una publicación.

## Pendientes antes de implementar/publicar
- Confirmar con Last.app el esquema vigente de los eventos/campos de rider y sandbox disponible; usar solo APIs oficiales.
- Elegir canal de notificación definitivo y verificar remitente, plantilla, consentimiento, URL y política de reintento sin hacer envíos reales.
- Definir qué copia de seguridad de base de datos se considera válida; no sobrescribir la organización recién inicializada en producción.
- Completar la experiencia visual objetivo y validar un prototipo de Back Office, Rider y cliente antes de conectar datos.
- La publicación requerirá una revisión expresa posterior del resultado probado.
