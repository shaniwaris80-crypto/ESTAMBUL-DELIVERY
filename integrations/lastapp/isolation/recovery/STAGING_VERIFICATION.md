# Verificación de recuperación y retención — 20 de octubre de 2026

## Alcance y estado

Repositorio `shaniwaris80-crypto/ESTAMBUL-DELIVERY`, rama `rebuild/staging-first`, PR #34 en borrador.
Código probado y desplegado: `1c4d355820b691816d8b681b2975469c9079b98a`.
Proyecto afectado: **ESTAMBUL DELIVERY STAGING**, `rknxqlijcgpbecoophva`.
Se actualizó únicamente la función NUEVA `edv9-last-queue`, versión **2**, ACTIVE.
El gateway anterior de staging y las funciones originales de Last.app no se sustituyeron.
`main` se volvió a leer al finalizar: permanece en `ba3863c654e4535af64d715c405bb854bfef7db8`.
No hubo cambios de producción, cuentas, secretos o webhook externo ni envíos SMS/WhatsApp.

## Qué añade esta fase

- Descubrimiento por `GET /tabs` dentro de una ventana de activación de 48 horas, configurable hasta 168 horas.
- Páginas de 100; progreso guardado entre ejecuciones; límite de 1.000 filas marcado como `truncated`, no cobertura completa.
- Exclusión de consultas simultáneas mediante el mismo bloqueo temporal de localización que utiliza la cola de detalles.
- Los IDs descubiertos generan solicitudes internas `ingestion_source=reconciliation`. No se presentan como webhooks del proveedor y no crean asignaciones.
- Cada detalle se obtiene después mediante el procesador existente. Una página ausente o vacía nunca cancela pedidos.
- Redacción de payloads y snapshots SOLO de localizaciones synthetic desactivadas y caducadas; se mantiene identidad y SHA-256 para detectar reintentos.

La paginación por offset no tiene orden estable documentado en el archivo aportado. La descripción de `endDate` también es ambigua. Hace falta comprobar sus efectos con Last.app. No se garantiza recuperar todos los pedidos históricos, ni cambios de pedidos fuera de la ventana; este módulo es recuperación acotada de mejor esfuerzo.

## Pruebas de código y PostgreSQL temporal

Workflow `Last.app recovery and retention`: run **39496149860**, job **118881591061**.
Resultado: **88 pruebas Node aprobadas, 0 fallidas, 0 omitidas**.
Pruebas SQL: aprobadas, incluyendo descubrimiento sin webhook, uso posterior de la cola, permisos, exclusión de workers, retraso tras 429, persistencia del offset, páginas repetidas y límite de recorrido.
Pruebas de retención: aprobadas para vista previa, apagado por defecto, payloads terminados, protección de snapshots con trabajo pendiente, duplicados y colisiones tras redacción.
Pruebas adicionales: se rechazan tokens de lease nulos; una respuesta tardía no puede completar trabajo; un snapshot actualizado vuelve a ser elegible para limpieza futura.

Los otros cuatro workflows sobre el mismo commit también terminaron SUCCESS:
- Last.app preservation: 39496150159.
- Last.app isolated ingestion: 39496149702.
- Last.app HTTP staging: 39496149952.
- Last.app durable queue: 39496149705.

Estas pruebas se ejecutaron en GitHub Actions, no en el contenedor local de ChatGPT. Los lectores Last.app usaron respuestas simuladas.

## Migración y despliegue remoto

CLI 2.121.0 generó `20261020205610_edv9_last_recovery_retention.sql`.
El conector registró la migración en staging como `20261020205757_edv9_last_recovery_retention`.
El SQL generado y el instalado tienen el mismo SHA-256:
`c1b933fc12d3c054e158aa5f661ee48b5ed6430efdeaebe22e7adeb036528dd8`.

Bundle de la función v2:
`dc09a6159a48a977560cfccaa2407e6dafe4f85bb52e84d33ea2b541a2d41b51`.

Se reutilizaron los dos cron existentes, sin crear duplicados:
- Cada minuto: `select ed_last_stage.recovery_tick();`.
- Mantenimiento, `15 3 * * *`: `select ed_last_stage.recovery_maintenance();`.

## Prueba remota: dos pedidos sin webhook

Se registró una localización SYNTHETIC temporal con dos detalles ficticios en su catálogo de prueba, pero **cero eventos y cero webhooks insertados**.

1. Primer tick lanzado MANUALMENTE a las **20:59:50 UTC**: el lector sintético descubrió dos IDs y dejó dos trabajos internos en cola. HTTP 200; `reconciliation.state=completed`, `queued=2`.
2. Cron AUTÓNOMO de las **21:00:00 UTC**: dos trabajos procesados, un intento por trabajo, dos snapshots guardados, cero errores de almacenamiento. HTTP 200.
3. Se comprobó el historial de cron: `succeeded`, comando `recovery_tick()`, inicio `2026-10-20T21:00:00.014541Z`.
4. Los dos eventos están identificados como `reconciliation`, no como mensajes enviados por Last.app.

Cron, pg_net, HTTPS, Edge Runtime, PostgREST y PostgreSQL fueron reales. **El listado y los detalles Last.app se simularon mediante fixtures**. Hubo cero lecturas de sandbox y cero SMS. No es una prueba de suscripción Last.app real.

## Prueba remota de limpieza y estado final

La limpieza se probó sobre esos dos datos ficticios dentro de una subtransacción que se revirtió explícitamente. Se simularon fechas antiguas solo durante la prueba:
- Vista previa: 2 eventos y 2 snapshots.
- Aplicación: 2 payloads vaciados y 2 snapshots convertidos en referencias mínimas no repartibles.
- El mismo evento siguió devolviendo `duplicate`; un cuerpo distinto con el mismo ID siguió produciendo `event_id_conflict`.
- Rollback comprobado: las fechas y payloads originales de prueba quedaron intactos.

Después se deshabilitaron localización, ruta y recuperación de esa prueba. No quedan rutas synthetic ni sandbox activas, ni exploraciones habilitadas.
Se habilitó la limpieza diaria SOLO de synthetic caducados de más de 7 días. La vista previa final devolvió 0 eventos y 0 snapshots elegibles. No hay política de eliminación automática de datos reales.

Estado legacy final de staging: **0 pedidos, 6 riders y 0 notificaciones**, igual que al inicio.
Los RPC nuevos deniegan ejecución a anon/authenticated y usan SECURITY INVOKER; las tablas nuevas tienen RLS.
Advisors final: ningún hallazgo del módulo nuevo. Siguen avisos heredados, 4 para anon y 18 para authenticated; no se declara libre de avisos el proyecto entero.
Referencias de los avisos heredados: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable y https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable.

## Bloqueo externo que permanece

El diagnóstico remoto sigue mostrando `sandbox_token_present=false`, `sandbox_enabled=false` y cero rutas sandbox aprobadas.
Para validar directamente con Last.app hacen falta una organización/localización de prueba comprobadas, `EDV9_LAST_SANDBOX_TOKEN` configurado como secreto de staging y una suscripción independiente. No pegar secretos en el chat o repositorio ni reutilizar la configuración del restaurante real como sandbox.

Todavía no hay Back Office nuevo, Rider App nueva, tracking nuevo ni SMS real verificado. El desarrollo de esos módulos puede usar el contrato interno probado, pero la publicación exige una validación externa real y sus pruebas funcionales.
