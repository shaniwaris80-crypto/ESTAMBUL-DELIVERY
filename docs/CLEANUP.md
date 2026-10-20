# Limpieza del repositorio — 20 de octubre de 2026

## Base inspeccionada

Repositorio: `shaniwaris80-crypto/ESTAMBUL-DELIVERY`.
Rama de trabajo: `rebuild/staging-first`, commit de partida `0f407f2d48145b69c99c4f46643fb2ca13378e32`.
`main` observado antes de la limpieza: `ba3863c654e4535af64d715c405bb854bfef7db8`.
El directorio Supabase de ambos commits tiene el mismo hash: `d1563d7c010fe35e7ab4fc03e337ef25da0ad4dc`.

## Qué se retira de la rama

Aplicaciones de `apps/`, paquetes de la UI anterior, `preview/`, archivos web de la raíz y de `docs/`, service workers, manifestos, iconos, demos, configuración pública del cliente y documentación de releases anteriores. También las dos funciones de mensajería ajenas a Last.app, sus scripts y los workflows anteriores. El nuevo workflow solamente verifica integridad y no despliega.

No se borran otras ramas, tags, historial Git ni recursos externos. No se fusiona esta limpieza a `main`.

## Qué se conserva y por qué

`ed-last-webhook` autentica el encabezado Authorization contra el secreto configurado, valida la estructura del evento, llama a `ed_receive_last_webhook` y solicita trabajo a `ed-last-auto-sync`. Conserva su nombre y ruta. El GET de salud devuelve 200 sin demostrar que la suscripción externa funcione.

`ed-last-auto-sync` exige la clave de servicio del backend. Procesa los eventos conservados, consulta el detalle del pedido a Last.app y llama a procedimientos SQL. No importa módulos locales de las apps eliminadas y no llama directamente a las dos funciones de mensajería retiradas.

Procedimientos referenciados por estas funciones:

- `ed_receive_last_webhook`.
- `ed_last_get_event`, `ed_last_record_location`, `ed_last_disable_location`.
- `ed_last_cancel_tab`, `ed_last_import_tab`, `ed_last_mark_event`, `ed_last_pending_events`.
- `ed_last_upsert_item_snapshot`, opcional y con error capturado por el worker; su disponibilidad en la base desplegada no se ha comprobado en esta limpieza.

La migración 018 muestra dependencias de `public.ed_orders`, `public.ed_riders`, funciones privadas de permisos y `private.ed_last_order_links` / `private.ed_last_locations`. Por ese acoplamiento se conserva íntegro el historial 001–023, no solo los archivos cuyo nombre contiene Last. Incluye componentes antiguos que deberán separarse más adelante; no se afirma que los 23 archivos sean todos imprescindibles para un módulo mínimo futuro.

Se conserva el documento histórico `LAST_APP_INTEGRATION.md` sin alterarlo. Cuando menciona firmas, altas/bajas de riders o una arquitectura propuesta, no debe interpretarse como funcionalidad implementada. El código preservado autentica con un secreto de integrador; esta limpieza no añade una firma HMAC ni endpoints nuevos.

## Configuración externa protegida

El código lee `LAST_APP_INTEGRATOR_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y la opción `ED_RIDER_ITEMS_INGEST_ENABLED`. No se consultan ni modifican sus valores en esta fase. Tampoco se modifica el proyecto remoto, el webhook registrado, los mapeos ni los cron existentes.

Eliminar una función de este árbol Git NO borra su despliegue en Supabase ni suspende sus tareas programadas. No se afirma que la mensajería desplegada quede desactivada.

## Validación y límites

El manifiesto fija los hashes originales de las dos funciones, del documento histórico y de todo el árbol de migraciones. El script comprueba los bytes del checkout, incluidos nombres, permisos de ejecución y entradas del árbol; detecta archivos borrados o cambiados. Sus pruebas usan archivos temporales ficticios y Git local.

Estas comprobaciones no ejecutan las funciones Deno, no instalan migraciones, no consultan producción y no son una prueba de integración real. La base resultante no es aún un backend independiente instalable en una base vacía, ni la nueva app del restaurante.

## Próximo trabajo separado

Diseñar un esquema mínimo de ingesta y su adaptador al sistema nuevo en staging. Validar eventos repetidos y fuera de orden, recuperación de errores, asignaciones manuales, pagos y límites de consulta antes de tocar la integración preservada. Validar después cada módulo nuevo y su mensajería con servicios simulados. Cualquier cambio de producción queda fuera de esta limpieza.
