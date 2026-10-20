# Recuperación de avisos perdidos y retención — staging

Este módulo no modifica la integración Last.app original, main, cuentas ni SMS. Se añade al núcleo de staging. Un despliegue debe actualizar únicamente la NUEVA función `edv9-last-queue` con `recovery/index.ts`, después de aplicar `schema.sql` mediante una migración generada con la CLI.

## Recuperación

El contrato del archivo aportado `openapi (1).json`, operación `ListTabs`, documenta `GET /tabs` con `locationId`, `startDate`, `endDate`, `offset` y `limit` (máximo 100). La respuesta es un array. Aquí solo se extraen IDs: cada detalle completo se vuelve a consultar con el worker existente. Los eventos internos llevan `ingestion_source=reconciliation`; no son webhooks enviados por Last.app.

Cada localización debe tener una fila aprobada en `reconcile_state`, además de la autorización de localización/ruta y del sandbox. Por defecto no hay ninguna fila habilitada. Se consulta una ventana de ACTIVACIÓN de 48 horas (configurable 1–168 horas), sin filtrar por open, y una página por ejecución. La ventana se fija durante el recorrido. Offset y estado persisten entre ejecuciones. Se usan el MISMO lease y espera mínima que los GET individuales. Las páginas duplicadas detienen la exploración; al alcanzar 1.000 filas se registra `truncated`, no éxito completo. La consulta se repite cada 5 minutos una vez finalizado el recorrido.

LIMITACIONES DEL CONTRATO: el texto de endDate dice literalmente «after endDate», aunque el nombre sugiere un final de intervalo; su semántica debe verificarse con Last.app. No se inventa un filtro updatedSince, cursor o garantía de orden estable que el archivo no documenta. La paginación por offset sobre datos cambiantes puede omitir filas transitoriamente; los recorridos repetidos son recuperación de mejor esfuerzo, NO garantía absoluta de ausencia de pérdidas. Pedidos fuera de la ventana de activación y cambios de pedidos antiguos aún necesitan una estrategia adicional. Nunca se cancela un pedido porque falte de una página.

El sandbox real requiere `EDV9_LAST_SANDBOX_TOKEN` y `EDV9_LAST_SANDBOX_ENABLED=true` en secretos de staging y una ruta sandbox aprobada. No se usa el token de producción como sustituto. Sin configuración no se consume cuota ni se toma trabajo. Las rutas synthetic usan solo fixtures de pruebas autorizadas y con caducidad.

## Limpieza conservadora

`redact_expired_synthetic(false)` muestra candidatos sin modificar datos. La aplicación exige habilitar `retention_control.synthetic_enabled`; es false por defecto. Solo afecta a localizaciones SYNTHETIC desactivadas y con autorización caducada. Payloads terminados de más de 7 días se vacían conservando el ID y SHA-256 canónico. La recepción sigue detectando reintentos idénticos y conflictos después de la limpieza. Snapshots con trabajo pendiente o en ejecución no se vacían. No toca usuarios, tablas legacy, datos sandbox ni datos de producción.

Esta es una política técnica para pruebas ficticias, no una política jurídica o de conservación para datos reales. No se instala una eliminación automática de información real sin decidir antes sus plazos y excepciones. Un nuevo evento diferente puede volver a obtener el detalle del proveedor; este mecanismo no es una lista de supresión de derechos de borrado.

## Activación de schedules, solo staging

Después de probar la función desplegada y el SQL, sustituir el comando del cron existente `edv9-last-queue-minute` por `select ed_last_stage.recovery_tick();`. Mantener la periodicidad. El wrapper despierta también la cola cuando hay una exploración pendiente aunque no haya eventos. El cron de mantenimiento existente puede llamar a `ed_last_stage.recovery_maintenance()`; respeta el interruptor de retención. No crear otro planificador concurrente ni modificar cron de producción.

## Comprobaciones

El workflow `Last.app recovery and retention` instala el esquema en PostgreSQL temporal y prueba descubrimiento sin webhook, cola de detalle, exclusión de workers, espera tras 429, cursor, página repetida, RLS y deduplicación después de vaciar payloads. Las pruebas HTTP usan respuestas ficticias. No confundir esas comprobaciones con una sesión real del sandbox ni con una nueva app publicada.
