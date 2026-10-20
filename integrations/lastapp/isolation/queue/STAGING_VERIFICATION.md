# Verificación fase 4 — 20 de octubre de 2026

## Código y CI inicial

Código del consumidor: `cca71eb428bb790c864ce80a5e61a4e0b2f60962`.
GitHub Actions `Last.app durable queue`, run `39491761578`, job `118866460358`: SUCCESS.
71 pruebas Node: 56 existentes y 15 nuevas; 0 fallidas y 0 omitidas. Pruebas PostgreSQL de permisos, selección, reintentos, fencing, expiración y tickets: PASS.

CLI 2.121.0 generó:
- `20261020202523_edv9_last_durable_queue.sql`, SHA-256 `6cb9e069f23b899670a3511524272bb6c87152ce69f9d99718e6c4486c9add61`.
- `20261020202525_edv9_last_queue_cron.sql`, SHA-256 `03d9f52cc1a405b19d8eee36c1b46d2fd3fc38eba28e3db5302a7d1978211f2e`.

## Prueba ejecutada en Supabase staging

Nueva Edge Function `edv9-last-queue`, versión 1, bundle SHA-256 `e7246acac44927ee2df10c255ce70282abfdca425c64aee21bf23d928d21ab93`.
Los componentes originales no se reemplazaron. Proyecto de destino: `rknxqlijcgpbecoophva`.

Se registraron dos tareas nuevas: revisión cada minuto y mantenimiento diario de informes caducados. El primer diagnóstico HTTPS/PostgREST/DB terminó HTTP 200.

Tres eventos sintéticos se insertaron una sola vez. No se recibió ni se creó ningún pedido real Last.app.
- Caso 1: fallo de proveedor simulado en el primer intento; queda en retry.
- Caso 2: evento pendiente normal.
- Caso 3: trabajo abandonado con lease vencida y un intento anterior simulado.

La primera llamada manual al tick, a las 20:28:27 UTC, produjo 1 retry. Una llamada solapada al tick fue bloqueada.
La ejecución AUTÓNOMA de pg_cron de las 20:29:00 UTC produjo el siguiente lote: 3 procesados, 0 errores de almacenamiento, 0 lecturas sandbox, 3 lecturas de fixture.
Resultado final: 3 eventos procesados y 3 snapshots; intentos por caso 2 / 1 / 2. No hubo otro webhook, reinserción ni adelanto artificial de not_before entre intentos. Las tres solicitudes HTTP iniciales devolvieron 200. La ruta y localización sintéticas se deshabilitaron al terminar.

Esto verifica cron + pg_net + HTTPS + Edge Runtime + PostgREST + PostgreSQL reales. El proveedor Last.app fue simulado. No se prueba con ello la recepción directa de Last.app, la entrega SMS ni la app de reparto completa.

## Bloqueo de sandbox identificado

Diagnóstico ejecutado dentro de Edge: `sandbox_token_present=false`, `sandbox_enabled=false`. No hay localización sandbox aprobada; la tabla de integración legacy de staging está vacía. No se reutilizan secretos de producción ni se cambia su webhook para resolver esta ausencia.

Para la prueba externa se requiere configurar `EDV9_LAST_SANDBOX_TOKEN` en los secretos del proyecto de staging (no en chat o GitHub), identificar localización/organización de pruebas y habilitar de forma coordinada las rutas y el webhook separado. La habilitación del planificador no equivale a activar esta conexión.

## Aviso de configuración detectado

Advisors señaló que pg_net se registró en el esquema public (extensión no relocatable). Se preparó `net-schema-fix.sql` para reinstalar únicamente esta extensión nueva en extensions, con la cola parada, sin solicitudes en vuelo y sin CASCADE. El archivo preserva la secuencia de request IDs. Su aplicación y el reencendido deben verificarse antes de dar la fase por cerrada. No se afirma que los avisos legacy estén resueltos.
