# Estambul Delivery — reconstrucción con Last.app conservado

Rama: `rebuild/staging-first`. PR #34 en borrador. No fusionado a `main`.

## Estado actual: núcleo HTTP y cola automática desplegados en staging

En **ESTAMBUL DELIVERY STAGING** están instalados `edv9-last-gateway`,
`edv9-last-queue` y el esquema privado `ed_last_stage`. La cola revisa trabajos
pendientes cada minuto; recupera reintentos y leases vencidas, sin otro webhook.
Las funciones originales Last.app y producción no se han reemplazado.

**La conexión real de sandbox NO está activada.** El diagnóstico Edge confirma
`sandbox_token_present=false`, `sandbox_enabled=false` y cero localizaciones
sandbox aprobadas. No se reutilizan credenciales ni webhook de producción.

Prueba remota de cola: tres eventos ficticios, uno con fallo temporal y otro con
trabajo abandonado. El cron real de las 20:29 UTC del 20 de octubre de 2026 recuperó
los tres: tres snapshots, intentos 2/1/2, cero lecturas de Last.app y cero SMS.
Los componentes cron/HTTPS/Edge/PostgREST/PostgreSQL fueron reales; Last.app fue
simulado mediante fixtures. Las rutas sintéticas quedaron deshabilitadas al terminar.

Se ejecutaron 71 pruebas Node (56 anteriores y 15 de cola), con cero fallos;
las pruebas SQL y los cuatro workflows también pasaron sobre el código revisado.
Un aviso nuevo por la ubicación de pg_net fue corregido en staging y el servicio
volvió a responder HTTP 200. Persisten avisos de seguridad heredados, ajenos al
módulo nuevo; no se declara todo el proyecto libre de avisos.

Evidencia exacta: [verificación de la cola](integrations/lastapp/isolation/queue/STAGING_VERIFICATION.md).
Detalles: [núcleo HTTP](integrations/lastapp/isolation/staging/README.md) y
[cola durable](integrations/lastapp/isolation/queue/README.md).

## Fase 1: código antiguo retirado de esta rama

Se retiraron Back Office, Rider App, tracking, demos, prototipos y mensajería antigua.
Se conservan byte a byte las dos funciones `supabase/functions/ed-last-*`, las 23
migraciones históricas en `supabase/migrations` y `docs/LAST_APP_INTEGRATION.md`.
Estas migraciones no se ejecutaron para instalar el esquema nuevo.
Eliminar archivos Git no desactiva funciones externas ya desplegadas.

## Fases 2–4: módulos separados

- `integrations/lastapp/isolation/contract.mjs`: normalización y procesamiento independientes.
- `schema.sql`: bootstrap de CI, no ejecutar junto a tablas legacy.
- `http.mjs` y `staging/`: autenticación, lectura acotada de Last.app, RPC y despliegue de pruebas.
- `queue/`: procesamiento periódico, permisos, tickets de un uso, límites, fixtures y evidencia.

La instalación aditiva de staging permite coexistir con las tablas anteriores sin
referenciarlas ni alterarlas. No crea riders, pedidos operativos, arqueos, chat ni
mensajes. Las asignaciones siguen siendo manuales en Last.app. Importe desconocido
no equivale a cero; método preferido no confirma cobro; CLOSED no significa DELIVERED.

## Verificaciones

```sh
python3 -m unittest discover -s tests -v
python3 scripts/verify_lastapp_preservation.py
node --test integrations/lastapp/isolation/tests/*.test.mjs integrations/lastapp/isolation/queue/tests/*.test.mjs
```

Los workflows solo comprueban: no despliegan ni usan secretos remotos de negocio.
Consultar las ejecuciones del commit concreto. No ejecutar `supabase db push` desde
la carpeta legacy. La cola puede pausarse mediante su control privado, sin borrar datos.

## Pendientes antes de datos reales y aplicación nueva

Configurar la credencial y localización sandbox; suscripción de webhook separada;
política de retención/purga de payloads y polling/reconciliación para pedidos cuyos
eventos nunca lleguen. La cola recupera solo trabajos ya recibidos, no descubre
pedidos desconocidos. La limpieza diaria actual solo alcanza informes de scheduler
caducados de más de siete días. No borra pedidos ni eventos.

Aún no hay Back Office nuevo, Rider App nueva, seguimiento nuevo ni SMS real verificado.
Los seis riders legacy de staging siguen conservados. No se han modificado cuentas,
secretos, base de datos ni webhook de producción.
