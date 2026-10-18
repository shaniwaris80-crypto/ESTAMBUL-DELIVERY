# PR 17 — procedimiento reproducible de validación en staging

Estado al preparar este runbook: PR 17 abierto, en borrador y sin fusionar. Este documento es un plan de ejecución; **no afirma que las pruebas estén hechas**.

## Límites obligatorios

- Usar un proyecto Supabase separado o una rama de base de datos descartable, creada desde staging. No usar producción ni datos copiados con datos personales.
- Usar pedidos, teléfonos y usuarios sintéticos. No invocar Last.app ni GloriaFood.
- **No enviar SMS ni WhatsApp.** Para pruebas del proveedor, usar un mock de Twilio que no tenga salida de red; nunca credenciales reales.
- No modificar `main`, no fusionar y no desplegar a Pages ni a producción.
- Si no puede confirmarse el proyecto de staging antes de una escritura, detenerse.

## 0. Preparar checkout aislado y marcar los proyectos

Requisitos: Git, Node, Supabase CLI y un proyecto de staging desechable con la misma estructura base que producción. Ejecutar desde un equipo de desarrollo:

```sh
git clone https://github.com/shaniwaris80-crypto/ESTAMBUL-DELIVERY.git
cd ESTAMBUL-DELIVERY
git fetch origin pull/17/head:pr-17-staging
git switch pr-17-staging
git status --short
git rev-parse --abbrev-ref HEAD
```

El último comando debe mostrar `pr-17-staging`; `git status --short` debe estar vacío. No hacer push de esta rama.

Registrar el commit con `git rev-parse HEAD` en la evidencia. La colisión de numeración se ha corregido en esta rama: la migración SMS es ahora `024_single_sms_skip_secondary.sql`; las versiones del repositorio llegan de 001 a 024 sin duplicados. El proyecto staging `rknxqlijcgpbecoophva` está activo, pero la comprobación del 19-10-2026 encontró cero tablas, cero migraciones y cero funciones Edge. Por tanto, **detenerse antes de `db push`**: primero debe prepararse y revisarse la línea base completa 001–023 y confirmar que el staging vacío es el destino intencionado. Tras esa preparación, el dry-run deberá mostrar solo 024 si 001–023 ya están registradas como aplicadas; si staging sigue vacío, no aplicar una secuencia completa sin revisar cada migración.
 
Definir localmente los dos refs conocidos (no poner contraseñas ni tokens en el terminal compartido):

```sh
export STAGING_PROJECT_REF='ref-del-proyecto-staging-descartable'
export PRODUCTION_PROJECT_REF='ref-de-produccion'
test -n "$STAGING_PROJECT_REF"
test "$STAGING_PROJECT_REF" != "$PRODUCTION_PROJECT_REF"
supabase --version
supabase db push --help
supabase functions deploy --help
```

En el Dashboard, confirmar que el proyecto señalado por `STAGING_PROJECT_REF` se llama staging y está separado de producción. Si el nombre/ref no coincide, detenerse. No ejecutar `supabase db reset --linked`: destruye la base enlazada.

## 1. Revisar esquema antes de aplicar la migración corregida

Autenticarse y enlazar únicamente el ref de staging. La contraseña de base de datos se introduce en el prompt del CLI, nunca se añade al comando:

```sh
supabase login
supabase link --project-ref "$STAGING_PROJECT_REF"
supabase projects list
supabase migration list --linked
supabase db push --dry-run --linked
```

Antes del dry-run, detectar versiones duplicadas localmente:

```sh
python3 - <<'PY'
from pathlib import Path
from collections import Counter
versions = [p.name.split('_', 1)[0] for p in Path('supabase/migrations').glob('*.sql')]
duplicates = sorted(v for v, n in Counter(versions).items() if n > 1)
print('\n'.join(duplicates))
PY
```

La salida debe estar vacía. **Con la rama corregida, la salida de duplicados locales debe estar vacía.** Staging está vacío; por ello aún no se debe ejecutar el push. El criterio de este runbook (dry-run solo 024) aplica únicamente después de validar y registrar 001–023 como línea base aplicada. Si falta cualquier migración anterior o aparece otro cambio, detenerse y corregir el staging; no aplicar una cola de cambios desconocida.

Aplicar solo después del dry-run revisado:

```sh
supabase db push --linked
supabase migration list --linked
```

La segunda lista debe mostrar 024 aplicada. La migración añade la función `public.ed_skip_secondary_sms(uuid)`; no actualiza registros existentes.

Comprobaciones SQL en el SQL Editor del **proyecto staging confirmado**:

```sql
select to_regprocedure('public.ed_skip_secondary_sms(uuid)') is not null as rpc_exists;

select has_function_privilege('service_role',
  'public.ed_skip_secondary_sms(uuid)', 'EXECUTE') as service_role_can_execute,
       has_function_privilege('anon',
  'public.ed_skip_secondary_sms(uuid)', 'EXECUTE') as anon_cannot_execute,
       has_function_privilege('authenticated',
  'public.ed_skip_secondary_sms(uuid)', 'EXECUTE') as authenticated_cannot_execute;

select pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'private.ed_notification_queue'::regclass
  and conname = 'ed_notification_queue_delivery_status_check';
```

Éxito: RPC existe; solo service_role puede ejecutarla; la restricción admite `sending` y `skipped`. Cualquier resultado distinto bloquea la prueba funcional.

## 2. Preparar fixture y probar claims sin proveedor

En el SQL Editor del staging confirmado, ejecutar este fixture una sola vez. Crea datos de base sintéticos y dos filas de cola; no llama a Last.app, GloriaFood ni Twilio. Antes de repetir, borrar únicamente la cuenta de prueba indicada (y confirmar que es staging):

```sql
delete from public.ed_accounts where name = 'STG-SMS016-RUN-001';

with account as (
  insert into public.ed_accounts(name)
  values ('STG-SMS016-RUN-001')
  returning id
), rider as (
  insert into public.ed_riders(account_id, display_name, active, online)
  select id, 'Rider sintético SMS016', true, false from account
  returning id, account_id
), orders as (
  insert into public.ed_orders(
    account_id, reference, channel, customer_name, customer_phone, destination,
    amount, status, rider_id, notifications_consent, notification_channel
  )
  select r.account_id, v.reference, 'test', 'Cliente sintético', '+00000000000',
         'Dirección ficticia staging', 10.00, 'asignado', r.id, true, 'sms'
  from rider r
  cross join (values ('STG-SMS016-A'), ('STG-SMS016-B')) as v(reference)
  returning id, account_id, reference, customer_phone
)
insert into private.ed_notification_queue(
  order_id, account_id, channel, destination, event_status, body, delivery_status
)
select id, account_id, 'sms', customer_phone, 'asignado',
       'Fixture sintético; no enviar', 'awaiting_provider'
from orders;
```

El número `+00000000000` es intencionalmente inválido y solo sirve como dato de cola; el worker debe omitir SMS antes de validar o llamar al proveedor. Las referencias deben ser exactamente `STG-SMS016-A` y `STG-SMS016-B`.

Antes de probar, verificar que las dos filas cumplen: `channel='sms'`, `delivery_status='awaiting_provider'`, pedido de test correcto, consentimiento vigente y canal SMS. Confirmar también que no hay filas WhatsApp en la cola. No usar Twilio real ni credenciales reales.

Abrir dos sesiones SQL separadas en el staging. En ambas ejecutar una sola vez y casi simultáneamente (el límite 1 fuerza la competencia):

```sql
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.ed_claim_notifications(1);
commit;
```

Guardar los dos JSON de resultado. Éxito: se devuelve un ID distinto en cada sesión; ninguno se reclama dos veces. Para cada ID reclamado, llamar en staging a `public.ed_skip_secondary_sms(id)` con contexto de service_role.

Comprobar filas por las referencias de prueba:

```sql
select o.reference, q.id, q.channel, q.delivery_status,
       q.sent_at, q.provider_message_id, q.last_error
from private.ed_notification_queue q
join public.ed_orders o on o.id = q.order_id
where o.reference in ('STG-SMS016-A', 'STG-SMS016-B')
order by o.reference, q.queued_at;
```

Éxito: cada fila termina en `skipped`; `sent_at` y `provider_message_id` son NULL; `last_error` identifica que el SMS secundario se omitió intencionalmente. No debe haber tráfico de salida al proveedor. La omisión no es una entrega y nunca debe quedar marcada como `sent`. Después de guardar la evidencia, limpiar únicamente el fixture con `delete from public.ed_accounts where name = 'STG-SMS016-RUN-001';`.

### Comprobar fallo seguro si falta 016

Usar otra rama/base de staging desechable, anterior a 016, con un solo fixture SMS. Con Twilio sin salida de red y un transporte simulado, ejecutar el worker contra ese fixture. Resultado esperado: respuesta 503 por RPC ausente y cero llamadas HTTP al proveedor. La fila puede quedar en `sending`: la migración 008 reclama `awaiting_provider` y el código actual no contiene recuperación automática de leases `sending`.

En ese fixture únicamente, anotar primero el ID y referencia, devolver esa fila de prueba a `awaiting_provider` mediante una operación SQL acotada por ambos valores, y volver a probar después de aplicar 024. No ejecutar una actualización masiva ni reparar filas de producción. Este resultado documenta un bloqueo de recuperación, no una prueba superada.

## 3. Duplicados, estados y errores

- Repetir el mismo claim y comprobar que las filas `skipped` no vuelven a ser reclamadas.
- Intentar una segunda aceptación del mismo pedido sintético con `p_resend:false`: debe indicar que ya estaba aceptado/no creó otro enlace y no crear otro recibo de envío.
- Cambiar el pedido sintético a `recogido`, `en_ruta` y `entregado`; comprobar que no se crea ni se envía otro SMS por estado.
- Verificar en el código y en triggers que no hay otro worker o función Edge que envíe SMS secundario.

**Límite actual:** `ed-rider-accept-sms` llama directamente a Twilio y `ed-send-notifications` también puede procesar WhatsApp. El repo no incluye un transporte inyectable/mock de Twilio ni un test E2E que intercepte red. Por eso no se permite habilitar el flag de mensajería en un staging con credenciales reales. Añadir primero el mock sin salida de red; después comprobar que aceptación hace exactamente una llamada simulada y cada estado secundario hace cero. La política actual no garantiza reintentos automáticos: un fallo termina como `failed` o puede dejar una fila `sending`; no reintentar aceptación a ciegas, porque podría duplicar el aviso.

Fallos esperados que bloquean el PR: RPC no encontrada (503), función sin permiso, estado `skipped` rechazado por constraint, mismo ID reclamado dos veces, fallo del proveedor que se etiqueta `sent`, llamada real a Twilio, segundo recibo/enlace, SMS secundario, o fila `sending` sin recuperación y sin alerta.

## 4. Compilación y pruebas de interfaz

En el checkout aislado:

```sh
npm install
npm run typecheck:backoffice
npm run typecheck:rider
npm run build:backoffice
node --check docs/rider.js
node --check docs/track.js
node scripts/check-customer-experience.mjs
```

Éxito: todos los comandos terminan con código 0. El script de experiencia es estructural; no sustituye pruebas E2E. El repo no tiene script E2E declarado en `package.json` ni lockfile en la raíz, así que la instalación no es reproducible byte a byte y E2E sigue pendiente. Antes de marcarlo resuelto: fijar dependencias con lockfile y añadir un E2E que apunte solo al staging, use fixtures sintéticos y bloquee solicitudes a Twilio/Last.app/GloriaFood.

## 5. GPS y arqueo, solo con fixture sintético

En staging, con una cuenta Rider de prueba:
- Autorizar ubicación y poner el pedido sintético en `recogido`/`en_ruta`; confirmar punto visible solo si rider activo, online, pedido asignado y ubicación de menos de 2 minutos.
- Revocar permiso o dejar vencer la posición; confirmar que el punto/ETA desaparece. Probar estado entregado y verificar que deja de mostrar ubicación.
- Crear un único pedido de test marcado efectivo, registrar el cobro de prueba y cerrar el turno de prueba. Confirmar que el total de efectivo incluye el pedido exactamente una vez; repetir refresco/reapertura de pantalla y confirmar que no duplica el movimiento.
- Capturar resultado, hora, commit SHA del PR, ref del staging y IDs sintéticos. No incluir tokens, teléfonos reales ni secretos.

Éxito: GPS respeta permiso/frescura y el arqueo suma una vez. Si la app nativa no se puede compilar o si no hay fixture de cierre de caja, dejar el bloqueo abierto; no inferir éxito desde una prueba web.

## 6. Rollback ensayado

Hacer el ensayo en una segunda rama/base staging descartable, con snapshot o recreación disponible y solo fixtures sintéticos. No hacer rollback de una base compartida.

1. Deshabilitar el flag de mensajería y detener invocaciones del worker en staging.
2. Volver a desplegar en staging la versión anterior de `ed-send-notifications`, que no llama a la RPC 024.
3. En SQL Editor de staging ejecutar `drop function if exists public.ed_skip_secondary_sms(uuid);`.
4. Verificar `to_regprocedure('public.ed_skip_secondary_sms(uuid)') is null`, que el worker anterior ya no requiere la RPC y que el flujo de pedido/cobro sigue operativo.
5. Comparar migraciones y datos sintéticos con la línea base. Recrear la rama descartable para repetir la prueba desde cero.

No editar a mano `supabase_migrations.schema_migrations`. La migración 024 no incluye una migración de bajada y su entrada quedará en el historial de ese staging tras el DROP; el rollback limpio y repetible requiere recrear una rama/base de staging desde la línea base anterior a 016 o añadir y revisar una migración de reversión.

Éxito: staging vuelve a la función previa, sin RPC 016 requerida; el flujo funcional de prueba y sus datos están restaurados/recreados. Si no existe copia/restauración probada, rollback no se considera superado.

## Configuración y documentación que todavía faltan

- [ ] Ref separado y confirmado para staging; acceso a un proyecto descartable.
- [x] Resolver la colisión de versión: migración SMS renumerada a 024; versiones locales únicas.
- [ ] Preparar y validar el esquema base 001–023 en staging; confirmar el dry-run de 024.
- [ ] Fixture para pedido efectivo y cierre de caja; el fixture SQL de las dos filas SMS está incluido arriba.
- [ ] Transporte mock de Twilio con bloqueo de red externa; ninguna credencial real.
- [ ] Recuperación segura y alertas para filas `sending` atascadas; política explícita de reintentos.
- [ ] Test concurrente automatizado de claims y test de permisos/RPC en el esquema real.
- [ ] Test E2E web y app nativa para aceptación, estados, GPS y arqueo.
- [ ] Lockfile para instalaciones reproducibles.
- [ ] Migración de reversión revisada o procedimiento de recreación staging comprobado.
- [ ] Evidencia adjunta con commit SHA, ref staging, outputs sin secretos y resultado por caso.
- [ ] Revisión final del PR y de que sigue en borrador.

**Criterio de cierre:** todas las casillas anteriores resueltas; matriz completa en verde; ninguna solicitud de red a SMS/WhatsApp; ningún pedido real; `main` sin cambios. Hasta entonces: PR en borrador, **NO FUSIONAR / NO DESPLEGAR**.
