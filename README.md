# Estambul Delivery — reconstrucción con Last.app conservado

Rama `rebuild/staging-first`, PR #34 en borrador. No fusionado a `main`.

## Estado actual: recepción, cola y recuperación en staging

En **ESTAMBUL DELIVERY STAGING** están desplegados `edv9-last-gateway` y
`edv9-last-queue` (v2), con el esquema privado `ed_last_stage`.
La cola revisa trabajo cada minuto, recupera fallos e incorpora un módulo de
consulta paginada para descubrir pedidos dentro de una ventana acotada incluso
cuando no se recibió su webhook. No altera asignaciones ni envía mensajes.

**El sandbox real de Last.app sigue sin configurar y deshabilitado.**
La última prueba remota descubrió dos pedidos FICTICIOS sin insertar eventos:
un tick manual los descubrió y el cron siguiente guardó dos detalles completos.
Cron, HTTPS, Edge, PostgREST y PostgreSQL fueron reales; Last.app se simuló.
No presentar esta prueba como recepción de una suscripción externa Last.app.

La recuperación usa una ventana de activación de 48 horas, páginas de 100 y un
máximo de 1.000 filas por recorrido. Es recuperación de mejor esfuerzo, no una
garantía de captura de todo el histórico. La semántica de fechas y paginación del
proveedor aún debe verificarse en sandbox. No cancela pedidos ausentes de una página.

La limpieza diaria de más de 7 días afecta SOLO a payloads/snapshots de rutas
synthetic caducadas y desactivadas. Conserva IDs y hashes para deduplicar reintentos.
Se probó en la base remota dentro de una subtransacción revertida. No borra datos
reales, cuentas, pedidos legacy ni información sandbox. No hay rutas de prueba
activas al finalizar.

**88 pruebas Node aprobadas, cero fallos ni omisiones**, además de pruebas SQL y
los cinco workflows aprobados sobre el código `1c4d355820b691816d8b681b2975469c9079b98a`.
Las comprobaciones se ejecutaron en GitHub Actions y Supabase staging, no en una
nueva aplicación de usuarios ni con pedidos reales.

Evidencia: [recuperación y retención](integrations/lastapp/isolation/recovery/STAGING_VERIFICATION.md).
Fases anteriores: [cola](integrations/lastapp/isolation/queue/STAGING_VERIFICATION.md) y
[núcleo HTTP](integrations/lastapp/isolation/staging/README.md).

## Código preservado y módulos separados

Se retiraron las aplicaciones, demos, prototipos y mensajería antiguas de esta rama.
Siguen byte a byte intactas las dos funciones `supabase/functions/ed-last-*`, las
23 migraciones históricas de `supabase/migrations` y `docs/LAST_APP_INTEGRATION.md`.
No ejecutar `supabase db push` desde la carpeta legacy para instalar el módulo nuevo.
Eliminar archivos Git no desactiva servicios externos desplegados.

`integrations/lastapp/isolation/` contiene:
- `contract.mjs` y `schema.sql`: núcleo independiente y bootstrap de pruebas.
- `http.mjs` y `staging/`: adaptadores y gateway de staging.
- `queue/`: procesador durable, tickets, permisos y scheduler.
- `recovery/`: descubrimiento paginado, retención sintética, pruebas y evidencia.

## Verificación

```sh
python3 -m unittest discover -s tests -v
python3 scripts/verify_lastapp_preservation.py
node --test integrations/lastapp/isolation/tests/*.test.mjs integrations/lastapp/isolation/queue/tests/*.test.mjs integrations/lastapp/isolation/recovery/tests/*.test.mjs
```

Los workflows solo comprueban, no despliegan ni contienen secretos de negocio.
Advisors no reporta avisos nuevos del módulo; siguen avisos heredados de funciones
SECURITY DEFINER. No se declara el proyecto entero libre de problemas de seguridad.

## Pendiente de conexión y aplicación

Configurar de forma segura el token de sandbox, aprobar una localización de pruebas
verificada y registrar una suscripción independiente sin modificar producción.
Definir una política de retención para información real y comprobar límites,
paginación y pedidos antiguos antes de su activación.
Todavía no hay Back Office, Rider App ni seguimiento nuevos publicados ni SMS real
verificado. Los seis riders legacy de staging se mantienen. Producción, sus cuentas,
credenciales, webhook y las funciones originales siguen sin cambios.
