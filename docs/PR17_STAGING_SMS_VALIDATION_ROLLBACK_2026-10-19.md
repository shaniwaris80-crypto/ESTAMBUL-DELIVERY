# PR 17 — procedimiento de validación aislada en staging

Fecha: 2026-10-19  
Estado: **guía preparada; pruebas no ejecutadas**. PR 17 sigue en borrador. No fusionar ni desplegar.

## Límites de seguridad

- Usar un proyecto Supabase **desechable de staging**, separado de producción, con cuentas y pedidos sintéticos.
- No enviar SMS/WhatsApp ni llamar a Twilio. No crear pedidos en Last.app/GloriaFood ni usar teléfonos reales.
- Mantener `ESTAMBUL_MESSAGING_ENABLED=false`; retirar del entorno de staging los secretos y remitentes de Twilio. No ejecutar una función que pueda reclamar toda la cola mientras existan filas reales en ella.
- No usar `supabase db reset --linked` salvo que se haya verificado que el proyecto enlazado es desechable y se acepta borrar íntegramente ese proyecto.
- No hacer checkout, push, merge ni despliegue en `main` o producción.

## Numeración corregida y estado de staging

La migración de omisión se ha renumerado en esta rama como `024_single_sms_skip_secondary.sql`. La secuencia de archivos del repositorio llega a 023 y ya no hay dos archivos con la misma versión.

El proyecto enlazado `rknxqlijcgpbecoophva` está activo, pero la comprobación de staging del 19-10-2026 encontró cero tablas públicas, cero migraciones y cero Edge Functions. **No aplicar `db push` todavía**: primero hay que revisar y preparar la línea base completa de la aplicación en staging; el dry-run actual no puede tratarse como una actualización aislada de 024. La migración 024 crea la RPC `public.ed_skip_secondary_sms(uuid)`; el esquema de cola debe permitir `skipped`.

## 1. Preparar checkout y proyecto

Requisitos: Node 22, npm, Supabase CLI compatible con el repositorio, Docker, acceso al proyecto **staging** y permisos de prueba. Nunca copiar claves al repositorio.

```sh
git clone https://github.com/shaniwaris80-crypto/ESTAMBUL-DELIVERY.git
cd ESTAMBUL-DELIVERY
git fetch origin
git switch --detach origin/feature/customer-experience-pro-v1
git status --short
git branch --show-current
```

Confirmar que el commit coincide con la cabeza actual del PR 17 y que el árbol está limpio. Crear una rama de trabajo desde esa referencia solo si hay que corregir la numeración de la migración.

Autenticarse y enlazar **solo después de copiar el project-ref del panel que muestra claramente “STAGING / desechable”**:

```sh
supabase login
export STAGING_PROJECT_REF='REEMPLAZAR_POR_REF_VERIFICADO_DE_STAGING'
supabase link --project-ref "$STAGING_PROJECT_REF"
supabase projects list
supabase migration list --linked
```

Detenerse si el ref o nombre no coincide con el proyecto de staging acordado, si producción aparece enlazada, si hay discrepancias de historial, o si quedan migraciones ajenas pendientes. No usar `migration repair` para ocultar una discrepancia.

## 2. Datos de prueba

Crear en el backoffice de **staging** dos pedidos manuales ficticios, asignados al Rider QA:

| Referencia | Nombre | Teléfono | Importe | Pago | Consentimiento |
|---|---|---|---:|---|---|
| `QA-PR17-A` | `Cliente QA PR17 A` | `+34999999991` (marcador ficticio; no contactar) | 12,50 € | efectivo | SMS habilitado solo para probar filas de cola |
| `QA-PR17-B` | `Cliente QA PR17 B` | `+34999999992` (marcador ficticio; no contactar) | 18,00 € | tarjeta | SMS habilitado solo para probar filas de cola |

No importar datos de Last.app/GloriaFood. Si la interfaz no permite crear pedidos aislados, preparar los fixtures con SQL usando el esquema de staging y conservar sus UUID en el registro de prueba. Etiquetar cada fila con la referencia `QA-PR17-*`; no usar un pedido real.

Antes de probar claims, confirmar que la cola staging no contiene trabajo ajeno:

```sql
select delivery_status, channel, count(*)
from private.ed_notification_queue
group by delivery_status, channel
order by delivery_status, channel;
```

Si hay filas no QA en `awaiting_provider` o `sending`, detenerse y usar una instancia staging nueva. No vaciar ni reclamar filas ajenas.

## 3. Comprobaciones locales, sin proveedor de mensajes

```sh
node --version
npm --version
npm install --no-audit --no-fund
node scripts/check-customer-experience.mjs
node --check docs/rider.js
node --check docs/track.js
deno check supabase/functions/ed-send-notifications/index.ts
deno check supabase/functions/ed-rider-accept-sms/index.ts
npm run typecheck:backoffice
npm run typecheck:rider
npm run build:backoffice
(cd apps/rider && npx expo export --platform android --output-dir /tmp/ed-rider-android)
```

Criterio: todas las comprobaciones terminan con código 0 y export Android creada. La comprobación estructural de experiencia de cliente no es E2E. El repositorio no define aún un script E2E reproducible; no marcar E2E como aprobado hasta añadirlo o documentar una ejecución Playwright/Appium con artefactos.

## 4. Aplicar migraciones únicamente en staging

Solo después de preparar y revisar la línea base completa (001–023) en el staging vacío:

```sh
supabase migration list --linked
supabase db push --dry-run
```

Leer toda la salida del dry-run. Debe listar solo la secuencia pendiente esperada en el staging desechable, incluida únicamente la nueva migración 024; detenerse si muestra migraciones inesperadas o una versión repetida. Un responsable confirma visualmente el proyecto en el panel y luego aplica:

```sh
supabase db push
supabase migration list --linked
```

Éxito: la migración 024 aparece aplicada una sola vez; `public.ed_skip_secondary_sms(uuid)` existe, solo `service_role` tiene permiso y el estado `skipped` sigue permitido por la restricción de `private.ed_notification_queue`. No desplegar funciones con `ESTAMBUL_MESSAGING_ENABLED=true`.

## 5. Pruebas SQL de cola, reintentos y concurrencia

Usar solo los UUID de `QA-PR17-A/B`. En dos sesiones separadas, invocar simultáneamente `ed_claim_order_notifications(<UUID QA>)` con rol de servicio simulado; la llamada requiere staging y nunca debe invocar Twilio. La función de claim usa `FOR UPDATE SKIP LOCKED`.

Criterios:

1. La primera llamada reclama cada evento elegible como `sending`; la segunda no reclama el mismo ID.
2. Para un estado secundario SMS, `ed_skip_secondary_sms(id)` devuelve `true` y deja la fila en `skipped`, con `sent_at` y `provider_message_id` nulos. No se etiqueta como `sent`.
3. Repetir `ed_skip_secondary_sms(id)` para una fila que ya no está `sending` devuelve `false`; no altera su estado.
4. Una llamada sin rol `service_role` falla con acceso denegado.
5. Invocar `ed-send-notifications` con la bandera apagada devuelve `enabled:false` y no reclama filas. Comprobar que no existe actividad Twilio. No enviar una aceptación desde Rider: la función de aceptación podría contactar al proveedor si la bandera se habilita.
6. Para probar fallo del proveedor y reintentos sin tráfico real, hace falta un adaptador/mock de Twilio inyectable en tests. El endpoint está actualmente codificado a `api.twilio.com`; hasta añadir un mock que falle cerrado, este punto queda **pendiente**, no aprobado. No simularlo cambiando la bandera a `true`.

Consultar resultados:

```sql
select o.reference, q.event_status, q.channel, q.delivery_status,
       q.sent_at, q.provider_message_id, q.last_error
from private.ed_notification_queue q
join public.ed_orders o on o.id=q.order_id
where o.reference in ('QA-PR17-A','QA-PR17-B')
order by o.reference, q.queued_at;
```

No deben existir dos registros `sent` de SMS de eventos secundarios para un mismo estado. Confirmar aparte que el mecanismo de aceptación no duplica el recibo de seguimiento para un token; sin SMS real, eso solo acredita la lógica de registro, no la recepción en un móvil.

## 6. Revisión de emisores y pruebas funcionales

Buscar en la rama todas las rutas de envío para verificar que solo la aceptación inicial puede enviar el enlace SMS, los cambios `recogido`, `en_ruta` y `entregado` no llaman al proveedor, y no quedan triggers o cron jobs de envío paralelo. Revisar también callbacks/reintentos y estados `sending` con fecha antigua; no reintentar automáticamente un envío de resultado ambiguo.

En el Rider y backoffice de staging, con el pedido QA:

- Asignación manual, aceptación y transición `asignado → recogido → en_ruta → entregado`.
- GPS: permiso concedido, punto visible solo durante el reparto, actualización reciente; retirar permiso o detener ubicación y verificar que desaparece.
- Arqueo: efectivo 12,50 € y tarjeta 18,00 € aparecen en su categoría, sin duplicarse al refrescar o reabrir.
- Seguimiento: token de A no abre B; token revocado/expirado no muestra datos; estados se actualizan y GPS ausente no inventa ETA.

Éxito: cada estado cambia una vez; cobros coinciden con fixtures; solo los pedidos QA se ven; ningún SMS/WhatsApp sale. GPS real y arqueo deben anotarse con dispositivo, hora y capturas sin datos personales.

## 7. Rollback comprobable

Ensayar en staging desechable y registrar hora/commit:

1. Apagar bandera de mensajería y parar cualquier invocación programada.
2. Desplegar la versión anterior de `ed-send-notifications` en staging (o mantenerla sin invocaciones); confirmar que no hay llamadas externas.
3. Retirar solo los pedidos QA por sus UUID/referencias y revisar de nuevo recuentos de cola y arqueo.
4. La migración nueva es aditiva. Si se requiere volver exactamente al esquema previo y se ha comprobado que no hay dependencias, ejecutar `drop function if exists public.ed_skip_secondary_sms(uuid);` en staging y marcar la migración como revertida **solo después** de comprobar que no quedan versiones posteriores que dependan de ella. Nunca tocar migraciones compartidas ni reparar el historial a ciegas.
5. Repetir login, lectura de pedido, transición de estado, GPS y cierre de caja QA con el worker apagado. La operación de pedidos debe seguir funcionando y no debe salir mensajería.
6. Guardar salida de `supabase migration list --linked`, resultados SQL, logs sin tokens/teléfonos y SHA del commit.

Criterio: rollback deja el staging en el estado previsto, sin datos de QA ni mensajes externos; pedidos, estados y arqueo QA siguen operativos con mensajería deshabilitada. Si el historial no coincide, parar y reconstruir el staging desechable; no improvisar una reparación en producción.

## Fallos esperados y respuesta

| Resultado | Interpretación | Acción |
|---|---|---|
| Duplicate migration/version | Secuencia local/remota divergente | Parar; corregir numeración en rama y volver a comparar historial |
| `ed_skip_secondary_sms` no existe | Migración no aplicada al staging enlazado | Parar worker; verificar ref y aplicar migración solo tras dry-run |
| No se puede establecer `skipped` | Restricción/esquema distinto al esperado | Parar; capturar error y revisar migración 008 y esquema real |
| Dos claims del mismo ID | No se cumple exclusión concurrente | No aprobar; guardar logs/IDs QA y corregir claim antes de avanzar |
| Llamada a Twilio observada | Aislamiento de salida falló | Detener pruebas; rotar credenciales staging si procede; no repetir |
| E2E, GPS o arqueo no verificable | Falta harness/dispositivo/fixture | Marcar pendiente; no declarar listo |
| Rollback falla o historial desincronizado | Staging no recuperable con el plan actual | Parar; reconstruir el entorno desechable, no hacer repair a ciegas |

## Lista final antes de reconsiderar el PR

- [x] Migración nueva renumerada a 024; no hay versión duplicada en la rama.
- [ ] Línea base 001–023 e historial remoto comprobados; dry-run de staging revisado.
- [ ] Migraciones aplicadas en staging desechable y diff/historial adjuntos.
- [ ] Fixture QA repetible y script/SQL de limpieza por IDs guardado.
- [ ] Claims concurrentes sin ID duplicado; estado `skipped` correcto; permisos negativos probados.
- [ ] Worker deshabilitado no reclama; prueba Twilio simulada y cerrada a red añadida.
- [ ] Ningún emisor alternativo de SMS secundario ni retry ambiguo.
- [ ] Pruebas de token, consentimiento, expiración/revocación y ausencia de GPS.
- [ ] Build/typecheck/export correctos; E2E automatizado con resultado adjunto.
- [ ] Prueba manual de GPS y arqueo completada en staging y documentada.
- [ ] Rollback ensayado y evidencia de que pedidos/arqueo siguen operativos.
- [ ] Documentación de secretos/flags, logs mínimos, monitoreo, propietario del rollback y limpieza QA actualizada.
- [ ] Revisión final mantiene PR 17 en borrador hasta completar y aceptar todos los puntos.

**No se considera aprobada ni ejecutada ninguna prueba de staging por la existencia de esta guía.**
