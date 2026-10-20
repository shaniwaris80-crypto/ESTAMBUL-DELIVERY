# Estambul Delivery — reconstrucción con Last.app conservado

Rama de trabajo: `rebuild/staging-first`. PR #34 en borrador.
No se ha fusionado a `main`, publicado una nueva app ni desplegado un proyecto remoto de staging.

## Fase 1: limpieza del repositorio

Se retiraron de esta rama el Back Office, Rider App, seguimiento web, demos,
prototipos y recursos de las versiones anteriores, además de las funciones de
mensajería, scripts Twilio y workflows antiguos.

Se conservan byte a byte:

```
supabase/functions/ed-last-webhook/index.ts
supabase/functions/ed-last-auto-sync/index.ts
supabase/migrations/                 # las 23 migraciones históricas 001–023
docs/LAST_APP_INTEGRATION.md         # referencia histórica, no contrato actualizado
```

Estas migraciones siguen siendo dependencias heredadas, no el esquema nuevo.
La limpieza de Git no desactiva funciones, cron o servicios que ya estén desplegados.
No se han borrado bases de datos, cuentas o credenciales externas.

## Fase 2: nuevo núcleo de ingesta aislado

La implementación está en [integrations/lastapp/isolation](integrations/lastapp/isolation/README.md).
Contiene un bootstrap SQL independiente, contrato de normalización y procesamiento
con adaptadores inyectados, pruebas Node, pruebas PostgreSQL y concurrencia real.

El nuevo esquema separa localizaciones autorizadas, eventos y snapshots de pedidos.
No depende de las tablas antiguas de riders, pedidos, arqueos, SMS, tracking ni Auth.
Preserva los datos de courier recibidos de Last.app; no autoasigna ni crea usuarios.
No transforma el método de pago preferido en un cobro confirmado.

El código nuevo y el conservado conviven en carpetas distintas. El nuevo módulo
NO está conectado a Last.app ni a la base de producción. No sustituye las funciones
originales. Los lectores HTTP y el adaptador de los RPC son el siguiente punto de
conexión; las pruebas actuales usan datos sintéticos y PostgreSQL temporal.

## Verificaciones

```sh
python3 -m unittest discover -s tests -v
python3 scripts/verify_lastapp_preservation.py
node --test integrations/lastapp/isolation/tests/contract.test.mjs
```

`Last.app preservation` comprueba el historial SQL y las funciones originales.
`Last.app isolated ingestion` prueba el contrato y crea una base PostgreSQL temporal
SIN ejecutar las migraciones antiguas. Incluye comprobaciones de permisos,
deduplicación, leases, reintentos y diez sesiones concurrentes.
Ambos workflows son de comprobación y no despliegan ni usan secretos de negocio.
Consultar la ejecución correspondiente al commit actual para conocer el resultado;
la existencia de tests no significa por sí sola que hayan pasado.

## Límites actuales

No hay Back Office nuevo, app rider nueva, recepción real verificada en el módulo
nuevo, pruebas en Supabase remoto, SMS/WhatsApp real ni migración de producción.
El bootstrap experimental está fuera de `supabase/migrations` y exige una base
independiente y una habilitación explícita. No ejecutarlo en producción.

Antes de conectar el sistema nuevo: implementar los adaptadores, generar y probar
la migración en un proyecto de staging independiente, ejecutar advisors, definir
retención de datos y completar pruebas de integración. Después construir los
módulos operativos. La asignación debe continuar siendo manual desde Last.app.
