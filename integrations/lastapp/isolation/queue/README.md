# Fase 4 — procesamiento periódico durable (solo staging)

El código original de Last.app y las 23 migraciones permanecen intactos. Esta fase añade un consumidor de la bandeja existente, no una nueva aplicación ni un reemplazo de producción.

## Diseño

`queue_tick` se ejecuta mediante pg_cron. Solo hace una llamada HTTPS a `edv9-last-queue/drain` si existe trabajo elegible; en reposo envía como máximo un diagnóstico cada 15 minutos. Cada solicitud lleva una credencial aleatoria de un solo uso, válida 100 segundos. Solo su SHA-256 se conserva en tablas durables; el valor sin cifrar existe temporalmente en la solicitud privada pg_net. No se copian secretos de Last.app, Twilio ni claves de servicio a cron o al repositorio.

La tabla de eventos es durable. La cola HTTP de pg_net no lo es: si se pierde una llamada, la siguiente ejecución de cron detecta el trabajo pendiente después de caducar el ticket. Los locks por localización y los tokens de lease existentes impiden procesamientos concurrentes y escrituras de workers atrasados.

Cada lote inicia como máximo 20 trabajos y deja de iniciar nuevos tras 15 segundos; la operación ya iniciada puede agotar sus timeouts. El timeout HTTP es 60 segundos y el ticket dura 100. Una pausa de 600ms respeta el intervalo existente de 500ms por localización. El sistema reintenta trabajos transitorios pendientes sin requerir otro webhook. Un 429 conserva su espera; no se reintenta en bucle. Esto no es una garantía de exactly-once ni coordina la cuota consumida por otros clientes Last.app.

## Autorización y modo de prueba

`queue_control.enabled` habilita el planificador. `sandbox_enabled`, las rutas aprobadas con caducidad, la localización habilitada y las variables Edge `EDV9_LAST_SANDBOX_ENABLED` / `EDV9_LAST_SANDBOX_TOKEN` son barreras independientes para lecturas de sandbox. Sin credencial no se reclaman eventos ni se consumen intentos. Nunca se reutiliza automáticamente `LAST_APP_INTEGRATOR_TOKEN` de producción.

El modo `synthetic` utiliza exclusivamente fixtures almacenadas por el backend, ligadas a localización/tab y con aprobación temporal. La petición pública no elige el modo ni aporta pedidos. Los fixtures no hacen llamadas a Last.app. Finalizadas las pruebas se deshabilitan las rutas y localizaciones sintéticas. Una ejecución remota sintética demuestra Edge/PostgREST/DB/cron, no Last.app real.

RLS en todas las tablas; RPC SECURITY INVOKER exclusivos de service_role, sin permisos de anon/authenticated. El tick privado solo lo ejecuta el propietario DB. Los resultados persistidos contienen contadores y estados de configuración, nunca clientes, teléfonos, direcciones o credenciales.

## Instalación y reversión de staging

Generar `schema.sql` mediante `render.mjs` y CLI; aplicar únicamente a `rknxqlijcgpbecoophva`. Después desplegar la nueva función. Instalar `cron.sql` para habilitar pg_cron y pg_net. Registrar tareas con nombres `edv9-last-queue-minute` (cada minuto) y `edv9-last-queue-maintenance` (diaria), solo tras verificar el destino. `queue_tick` fija la URL al proyecto staging. Las dos funciones Last.app originales no se editan.

Pausa reversible: `UPDATE ed_last_stage.queue_control SET enabled=false`. No borra eventos ni afecta producción. Puede desprogramarse únicamente el cron con el nombre indicado; no borrar otros cron.

Retención de informes de scheduler: 7 días. La limpieza privada solo borra informes caducados. NO borra pedidos, eventos, snapshots, riders ni datos legacy. Retención/purga de payloads Last.app reales sigue pendiente antes de admitir datos reales.

## Pruebas y límites

`node --test integrations/lastapp/isolation/queue/tests/drain.test.mjs` y `tests/database.sql`, junto a las pruebas anteriores, verifican lotes, recuperación, límites, permisos, tickets de un uso, fixtures y ausencia de lecturas de proveedor con configuración incompleta. El workflow no usa credenciales remotas ni despliega.

El sandbox requiere un token específico, localización autorizada y una suscripción de webhook independiente; no se da por conectado por tener un HTTP 200 de salud. Esta fase no implementa aún polling para pedidos nunca recibidos ni conciliación de todos los canales, ni aplicaciones, SMS o cambios de producción. Consultar la evidencia del commit/despliegue para los resultados realmente ejecutados.

Referencia de programación consultada: https://supabase.com/docs/guides/functions/schedule-functions
