# Verificación fase 4 — 20 de octubre de 2026

## Código y CI

Código del consumidor desplegado: `cca71eb428bb790c864ce80a5e61a4e0b2f60962`.
GitHub Actions `Last.app durable queue`, run `39491761578`, job `118866460358`: SUCCESS.
71 pruebas Node: 56 existentes y 15 nuevas; 0 fallidas y 0 omitidas. Pruebas PostgreSQL de permisos, selección, reintentos, fencing, expiración y tickets: PASS.
La repetición sobre `cc90aaf63588a1bfdbf52c246d65626ea58c6f2c`, run `39492696795`, job `118869696192`, también terminó SUCCESS. Los otros tres workflows (preservación, núcleo aislado y HTTP) terminaron SUCCESS sobre ese commit.

CLI 2.121.0 generó inicialmente:
- `20261020202523_edv9_last_durable_queue.sql`, SHA-256 `6cb9e069f23b899670a3511524272bb6c87152ce69f9d99718e6c4486c9add61`.
- `20261020202525_edv9_last_queue_cron.sql`, SHA-256 `03d9f52cc1a405b19d8eee36c1b46d2fd3fc38eba28e3db5302a7d1978211f2e`.
Los hashes coinciden con los SQL registrados remotamente, versiones `20261020202634` y `20261020202706`. El generador posterior también crea mediante CLI la migración de corrección de namespace.

## Prueba ejecutada en Supabase staging

Nueva Edge Function `edv9-last-queue`, versión 1, bundle SHA-256 `e7246acac44927ee2df10c255ce70282abfdca425c64aee21bf23d928d21ab93`.
Los componentes originales no se reemplazaron. Proyecto de destino: `rknxqlijcgpbecoophva`.

Tareas instaladas y activas: `edv9-last-queue-minute`, cada minuto; `edv9-last-queue-maintenance`, diariamente a las 03:15 UTC. El mantenimiento elimina solo informes de ejecución caducados de más de 7 días, no pedidos ni eventos.

Tres eventos sintéticos se insertaron una sola vez. No se recibió ni se creó ningún pedido real Last.app.
- Caso 1: fallo de proveedor simulado en el primer intento; queda en retry.
- Caso 2: evento pendiente normal.
- Caso 3: trabajo abandonado con lease vencida y un intento anterior simulado.

La primera llamada manual al tick, a las 20:28:27 UTC, produjo 1 retry. Una llamada solapada al tick fue bloqueada.
La ejecución AUTÓNOMA de pg_cron de las 20:29:00 UTC produjo el siguiente lote: 3 procesados, 0 errores de almacenamiento, 0 lecturas sandbox, 3 lecturas de fixture.
Resultado final: 3 eventos procesados y 3 snapshots nuevos; intentos por caso 2 / 1 / 2. No hubo otro webhook, reinserción ni adelanto artificial de not_before entre intentos. Las tres solicitudes HTTP iniciales devolvieron 200. La ruta y localización sintéticas se deshabilitaron al terminar. No se borraron los resultados de la prueba.

Esto verifica cron + pg_net + HTTPS + Edge Runtime + PostgREST + PostgreSQL reales. El proveedor Last.app fue simulado. No se prueba con ello la recepción directa de Last.app, la entrega SMS ni la app de reparto completa.

## Bloqueo de sandbox identificado

Diagnóstico ejecutado dentro de Edge: `sandbox_token_present=false`, `sandbox_enabled=false`. No hay localización sandbox aprobada; la tabla de integración legacy de staging está vacía. No se reutilizaron secretos de producción ni se cambió su webhook para resolver esta ausencia.

Para la prueba externa se requiere configurar `EDV9_LAST_SANDBOX_TOKEN` en los secretos del proyecto de staging (no en chat o GitHub), identificar localización/organización de pruebas y habilitar de forma coordinada las rutas y el webhook separado. La habilitación del planificador no equivale a activar esta conexión. No se encontró una conexión Last.app específica entre los resultados del buscador de plugins; esto no demuestra que no exista en todo el directorio.

## Corrección de seguridad y estado final

Advisors señaló que pg_net se registró en public. Como la extensión es no relocatable, se aplicó `net-schema-fix.sql` exclusivamente a la extensión nueva, con la cola parada, sin solicitudes en vuelo y sin CASCADE. Se conservó la secuencia de request IDs; las respuestas HTTP transitorias de pg_net anteriores a la reinstalación desaparecieron, pero los informes durables y los eventos/snapshots permanecieron.

Migración correctora registrada: `20261020203329`, SHA-256 `9a367eb40d159d1e67ba887a089e2a45f09fe7b9495e4c37d50dfe9bb3a64ab1`.
Comprobación posterior: pg_net en `extensions`, pg_cron en `pg_catalog`, scheduler reactivado. Solicitud de diagnóstico 4: HTTP 200, estado finished, sin timeout, sin errores y sin lecturas de Last.app.
Advisors del 20 de octubre a las 20:34 UTC no devuelve avisos del módulo nuevo ni de pg_net; continúan 4 avisos legacy de funciones SECURITY DEFINER para anon y 18 para authenticated. No se declara limpio de avisos el proyecto entero.

Estado final de staging: planificador habilitado; sandbox deshabilitado; 0 rutas sandbox activas, 0 rutas sintéticas activas. Tablas legacy: 0 pedidos, 6 riders y 0 notificaciones, iguales al inicio.
`main` observado después de los cambios: `ba3863c654e4535af64d715c405bb854bfef7db8`, sin cambios. No se modificó producción, el webhook existente, secretos ni cuentas. El PR #34 sigue en borrador.

## Límites restantes

Faltan la conexión real de sandbox, la política de retención/purga de payloads antes de datos reales y la reconciliación/polling para pedidos cuyos eventos nunca lleguen. El planificador recupera trabajo que YA esté en la bandeja: no descubre pedidos desconocidos. No hay nuevo Back Office, Rider App, tracking o SMS publicado por esta fase.
