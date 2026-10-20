# Fase 3 — HTTP/RPC y prueba en Supabase staging

## Despliegue verificado el 20 de octubre de 2026

Proyecto de destino: **ESTAMBUL DELIVERY STAGING** (`rknxqlijcgpbecoophva`).
Se inspeccionó antes del cambio: existían tablas legacy, seis riders, cero pedidos
y cero elementos en la cola de notificaciones. No se han borrado esos objetos.

Se añadió el esquema `ed_last_stage` con cuatro tablas: locations, events,
snapshots y probes. Las tres primeras pertenecen al núcleo; probes sirve únicamente
para una prueba sintética autorizada por un administrador, con token hash de un
solo uso. Las cuatro tienen RLS y no conceden acceso a anon/authenticated.
Los seis RPC son SECURITY INVOKER y están restringidos al backend service_role.

Migración remota registrada: `20261020200257_edv9_last_http_staging`.
La CLI 2.121.0 generó primero `20261020200028_edv9_last_http_staging.sql` en CI.
El SQL generado y el SQL almacenado en el historial de Supabase tienen exactamente
el mismo SHA-256: `45755c638c269bd584df1fdd793e0abaf788e279746c3811e5a4ef137ebad70f`.
La marca de versión remota la asignó el conector al aplicar la migración.

`render.mjs` genera el SQL desde el bootstrap original, cuyo hash comprueba, y añade
las funciones de prueba. Omite expresamente la prohibición de coexistir con tablas
legacy **solo para este destino de staging inspeccionado**; el bootstrap original
sigue intacto y protegido para CI. No hay DROP/TRUNCATE ni referencias a tablas
operativas legacy en el nuevo esquema. El renderizado no debe usarse para producción.

Función nueva: `edv9-last-gateway`, versión 1, estado ACTIVE.
El paquete desplegado importa fuentes fijadas al commit
`9e953225019170de862c1f7d26774d027b8bc11e`, no una rama mutable. El entrypoint se
niega a funcionar si SUPABASE_URL no coincide con el proyecto de staging.
Hash de bundle devuelto por Supabase:
`50ee06c6d05f697db71941b6e049076ab8dcc4f97752c816808a0c57c973f075`.
La lectura posterior de la función confirmó versión y entrypoint.

## Rutas y controles

Base: `https://rknxqlijcgpbecoophva.supabase.co/functions/v1/edv9-last-gateway`.

- GET `/health`: salud del módulo, no prueba de Last.app ni de su suscripción.
- POST `/webhook`: autentica Authorization, valida el JSON y su ámbito, persiste el
  evento y devuelve HTTP 200 vacío únicamente después de la recepción durable.
- POST `/run`: exige un secreto de backend distinto del webhook. Procesa un trabajo
  de la localización indicada. No devuelve datos de cliente ni el tab completo.
- POST `/probe`: exclusivo de esta instalación de staging; exige un token aleatorio
  de 256 bits cuyo hash, caducidad y uso se verifican por RPC. No permite especificar
  un cliente, destino externo, pedido real ni URL arbitraria.

verify_jwt=false es necesario para las credenciales de webhook y de prueba, que no
son JWT de usuario. **No significa acceso anónimo a operaciones**: cada ruta operativa
realiza su propia autenticación. Las rutas internas de prueba del handler también
se comprobaron con credenciales correctas e incorrectas.

La función usa SUPABASE_SERVICE_ROLE_KEY únicamente en servidor, sin extraerla ni
copiarla a GitHub. Para la activación Last.app se reservan EDV9_LAST_SANDBOX_TOKEN y
EDV9_LAST_SANDBOX_ENABLED=true. No se reutilizó ni leyó el secreto de producción.
El estado observado en `/health` es enabled=false, live_last_verified=false.

El lector Last.app usa exclusivamente GET sobre `https://api.last.app/v2/tabs/{id}`,
Authorization Bearer y LocationID. Impone timeout, límite de cuerpo, rechaza redirects
y clasifica errores sin reflejar mensajes del proveedor ni credenciales.
El adaptador RPC solo acepta procedimientos conocidos y un origen Supabase válido.
No se expone el esquema privado en la configuración de Data API.

## Evidencia real, sin confundir qué se simuló

CI, workflow **Last.app HTTP staging**, run `39488188905`, job `118854035343`:
56 pruebas Node aprobadas, cero fallidas y cero omitidas. Incluyen las 30 pruebas
del contrato anterior y 26 pruebas nuevas de autenticación, límites HTTP, errores,
scoping, RPC, compatibilidad de claves, duplicados y respuestas sin datos personales.
La migración se generó usando la CLI, se instaló sobre PostgreSQL temporal con
objetos legacy de prueba y no alteró esos objetos. Pasaron las pruebas de permisos
y consumo único del token de prueba. La preservación de fuentes legacy pasó también.

En Supabase remoto se llamó por HTTP a `/probe`. Dentro de esa función se usaron
Request/Response del handler de webhook y worker con credenciales sintéticas; el
Fetch de Last.app se sustituyó por una respuesta sintética fija. **No hubo conexión
con la API Last.app ni recepción de un webhook enviado por Last.app.**
Sí hubo ejecución real de Edge Runtime, llamadas HTTPS reales a PostgREST y
persistencia real en la base de staging.

Resultado devuelto y confirmado después en SQL:

```json
{
  "passed": true,
  "http": {
    "empty_200": true,
    "processed": true,
    "last_headers": true,
    "unauthorized": true,
    "duplicate_200": true,
    "one_full_read": true,
    "worker_unauthorized": true,
    "no_customer_in_response": true
  },
  "database": {
    "one_event": true,
    "processed": true,
    "one_snapshot": true,
    "full_tab_saved": true
  },
  "last_source": "synthetic",
  "sms_sent": false
}
```

Repetir la misma solicitud de prueba devolvió HTTP 401. No se almacena el token en
este repositorio. La localización sintética quedó desactivada; quedan cero locales
nuevos habilitados. Se conserva un evento/snapshot ficticio como evidencia.
Las tablas antiguas siguen con cero pedidos, seis riders y cero notificaciones.
La extensión http se utilizó dentro de transacciones revertidas para las llamadas
de prueba; una consulta posterior confirmó que no quedó instalada.

## Advisors

Se ejecutó el asesor de seguridad de Supabase antes y después. No aparecieron avisos
para el nuevo esquema ni los RPC edv9_last_*. Siguen los avisos heredados por funciones
SECURITY DEFINER: cuatro accesibles a anon y dieciocho a authenticated. Son hallazgos
de permisos a revisar en su contexto, no una declaración automática de vulnerabilidad.
No se modificaron esas funciones fuera del alcance de esta fase.

Remediaciones oficiales:
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

## Antes de habilitar un sandbox Last.app externo

1. Configurar un token de sandbox en el gestor de secretos y aprobar explícitamente
   el locationId/organizationId de pruebas. No activar por coincidencia de nombres.
2. Registrar el webhook de pruebas por separado, sin modificar el webhook actual
   de producción. Probar creación, actualización, asignación manual y cancelación.
3. Completar el drenaje periódico de la cola: el wake-up actual intenta un solo
   trabajo; no sustituye un scheduler durable para ráfagas, leases activos y reintentos.
   `/run` existe, pero no hay cron nuevo programado en este despliegue.
4. Definir y probar retención/purga antes de incorporar datos reales. La caducidad
   del token de prueba no elimina los eventos ni snapshots. No hay purga automática.
5. Implementar polling/reconciliación, eventos financieros independientes y merges
   antes de afirmar cobertura completa de Last.app.

Los pasos pendientes son restricciones reales del estado actual, no pruebas ya
superadas. No hay aplicación operativa nueva, GPS nuevo, chat, arqueo ni SMS en esta
fase. No se modificaron main, funciones productivas, cuentas o datos de producción.

## Reproducir el SQL sin secretos

```sh
node integrations/lastapp/isolation/staging/render.mjs rknxqlijcgpbecoophva /tmp/edv9-empty-migration-workdir
```

Este comando crea un archivo local mediante CLI; NO despliega ni aplica SQL remoto.
El historial de este proyecto ya incluye migraciones legacy y la nueva migración.
Antes de cualquier db push, recuperar/reconciliar el historial remoto; no intentar
aplicar de nuevo el bootstrap ni usar ciegamente las 23 migraciones conservadas.
Las siguientes migraciones deben mantener nombres/versiones coherentes con el remoto.
