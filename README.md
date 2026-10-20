# Estambul Delivery — reconstrucción con Last.app conservado

Rama: `rebuild/staging-first`. PR #34 en borrador. No fusionado a `main`.

## Estado actual: núcleo HTTP desplegado y probado en staging

Se ha desplegado **únicamente** `edv9-last-gateway` en el proyecto existente
**ESTAMBUL DELIVERY STAGING**, separado del proyecto de producción.
El esquema nuevo `ed_last_stage` y sus seis RPC de backend están instalados allí.
No se han sustituido las funciones originales, modificado el webhook externo de
Last.app, activado SMS ni publicado las nuevas aplicaciones.

La prueba integrada ejecutada en Supabase utiliza Edge Runtime y PostgREST reales,
pero **simula Last.app y sus solicitudes de webhook dentro del arnés de prueba**.
Resultado: un evento, un snapshot, un procesamiento, rechazo de autenticación
incorrecta y rechazo de reutilización de la clave de prueba. Los datos son ficticios.
Las 56 pruebas Node (30 de contrato y 26 HTTP) y la instalación SQL en CI pasaron.

La recepción externa del módulo nuevo está deshabilitada: requiere configuración
explícita del sandbox y validación con Last.app. No confundir un servicio desplegado
y una prueba sintética superada con una suscripción Last.app real funcionando.

Detalles, evidencia y límites: [staging](integrations/lastapp/isolation/staging/README.md).

## Fase 1: código antiguo retirado de esta rama

Se retiraron Back Office, Rider App, tracking, demos, prototipos y mensajería antigua.
Se conservan byte a byte las dos funciones `supabase/functions/ed-last-*`, las 23
migraciones históricas en `supabase/migrations` y `docs/LAST_APP_INTEGRATION.md`.
Estas migraciones no se ejecutaron para instalar el esquema nuevo.
Eliminar archivos Git no desactiva funciones externas ya desplegadas.

## Fase 2 y 3: núcleo separado y adaptadores

`integrations/lastapp/isolation/contract.mjs`: datos y procesamiento independientes.
`schema.sql`: bootstrap de CI que sigue rechazando tablas legacy.
`http.mjs`: autenticación HTTP, lectura Last.app GET acotada y adaptador RPC.
`staging/`: despliegue aditivo separado, prueba sintética de un solo uso y evidencia.

La instalación aditiva de staging permite coexistir con las tablas anteriores, sin
referenciarlas ni alterarlas. El núcleo nuevo no crea riders, pedidos operativos,
arqueos, chat ni mensajes. Los datos del courier no se convierten en autoasignaciones.
Los importes desconocidos siguen siendo desconocidos; pago preferido no significa
cobro confirmado; CLOSED no significa DELIVERED.

## Verificaciones

```sh
python3 -m unittest discover -s tests -v
python3 scripts/verify_lastapp_preservation.py
node --test integrations/lastapp/isolation/tests/contract.test.mjs integrations/lastapp/isolation/tests/http.test.mjs
```

Los tres workflows comprueban integridad, contrato/concurrencia y HTTP/migración.
No despliegan a Supabase ni contienen secretos de negocio. Consultar las ejecuciones
para el commit concreto; tener tests escritos no demuestra que hayan pasado.

## Pendientes antes de activar datos reales

Validar sandbox, token y localización Last.app; registrar separadamente el nuevo
webhook sin cambiar producción; completar drenaje periódico/reintentos de la cola,
polling/reconciliación y retención/purga. Después conectar los módulos operativos.
Aún no hay Back Office nuevo, Rider App nueva ni envío SMS verificado.
No ejecutar `supabase db push` desde la carpeta de migraciones legacy.
