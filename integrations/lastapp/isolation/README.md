# Last.app: núcleo de ingesta independiente (fase 2)

Implementación aislada para pruebas, NO una sustitución de la integración desplegada.
El código original de `supabase/functions/ed-last-*` y las 23 migraciones históricas
permanecen intactos. `main`, Supabase remoto, secretos, usuarios, URL de webhook y
mensajería externa no se modifican en esta fase.

## Separación conseguida en el código

`schema.sql` crea desde cero tres tablas en un esquema nuevo y privado:

| Tabla | Responsabilidad |
| --- | --- |
| `ed_last_stage.locations` | Localizaciones aprobadas, organización y tenant lógico; desactivadas por defecto. |
| `ed_last_stage.events` | Bandeja de eventos, deduplicación, intentos, espera y bloqueo temporal de trabajo. |
| `ed_last_stage.snapshots` | Último detalle obtenido de Last.app por localización/pedido, sin crear pedidos operativos. |

No depende de `ed_orders`, `ed_riders`, `auth.users`, arqueos, turnos, tracking, chat,
colas SMS ni triggers de las versiones anteriores. Los identificadores lógicos de
organización/tenant no requieren crear usuarios. No se asigna ningún pedido a un
rider: únicamente se conserva el courier recibido de Last.app. El sistema nuevo
resolverá después su vínculo explícito con la cuenta del repartidor.

Los RPC nuevos `edv9_last_receive`, `edv9_last_claim`, `edv9_last_complete` y
`edv9_last_fail` son solo de backend, con SECURITY INVOKER, permisos revocados a
PUBLIC/anon/authenticated y RLS en las tres tablas. No se expone el esquema privado
a la Data API. No se usa user_metadata para autorizar. El rol service_role es de
servidor y no debe entregarse al cliente.

## Contrato y funcionamiento

Base documental: archivo del usuario `openapi (1).json`, Last.app API 2.0.0,
`components.schemas.webhook`, `tab`, `deliveryStatus`, `bill` y `payment`.
El módulo soporta los cinco eventos `tab:created`, `tab:updated`, `tab:closed`,
`tab:cancelled` y `tab:delivery-status-updated`. En los cuatro primeros el ID está
en `data.id`; en el de estado está en `data.tabId`. Otros eventos se identifican
como no soportados, no se reinterpretan como pedidos. Altas/bajas de integración,
bills/payments independientes, merges y polling requieren adaptadores posteriores.

El futuro borde HTTP debe autenticar Last.app, limitar el cuerpo y aprobar la
localización antes de llamar al RPC. `parseEvent` NO autentica HTTP. No se publica
ni conecta un nuevo webhook en esta fase. El webhook actual sigue intacto.

`processOne` utiliza dos puertos inyectados: store (los cuatro RPC) y last (lectura
del tab completo). No contiene clientes HTTP ni lee credenciales. Un adaptador de
backend posterior deberá implementarlos y comprobar la autenticación real.
Las pruebas usan servicios simulados. El timeout de 12 segundos es un requisito
pasado al puerto; el futuro lector HTTP debe imponerlo con AbortSignal.

Se procesa una consulta a la vez por localización, con lease de 30 segundos y un
token nuevo por intento. Un worker antiguo no puede confirmar ni sobrescribir el
resultado de otro. Se aplica separación mínima de 500 ms entre claims. Esto limita
este módulo a 2 lecturas/s por localización, pero NO coordina la cuota consumida por
otros procesos. No activar junto al importador anterior sin un limitador compartido.
Ante 429 se respeta el Retry-After suministrado por el adaptador (0–86400 segundos)
a nivel de localización; los demás errores transitorios usan backoff y máximo 5
intentos. Credenciales inválidas, 404 y documentos inválidos requieren intervención.

Los eventos fuera de orden NO usan `event.created` como versión del pedido: cada
trabajo consulta el detalle actual. `revision` es local, no un campo de Last.app.
Una cancelación se conserva cuando consta en el detalle; no se inventa ante un GET
fallido. Una transición a takeaway guarda una marca inactiva mínima para evitar
que un antiguo destino siga considerándose de reparto.

## Datos económicos y de entrega

`normalizeTab` es nuestro modelo interno, no el JSON oficial. Conserva ID y nombre
del courier por separado, no asigna por coincidencia de nombre. Conserva productos,
notas de entrega y pagos observados. Un importe ausente es null, no 0. Bills
repetidos, rectificativos, cantidades no enteras o ambiguas requieren revisión.
El método preferido no confirma un cobro. No calcula arqueo ni atribuye cobros al
rider. `rider_collected_cents` es null hasta que otro módulo confirme la operación.
CLOSED se conserva como CLOSED y no se traduce a DELIVERED. No se convierte
`closeTime` en una entrega. Los teléfonos no se usan para enviar mensajes.

## Pruebas reproducibles

`node --test integrations/lastapp/isolation/tests/contract.test.mjs`

El workflow `Last.app isolated ingestion` crea PostgreSQL 17 temporal con datos
ficticios. Instala este esquema SIN ejecutar las 23 migraciones antiguas y verifica
comportamiento, RLS/ACL, duplicados, ámbito organización/localización, recuperación,
reintentos, cancelación, cambio a takeaway y 10 sesiones concurrentes.

`schema.sql` es un bootstrap experimental fuera de `supabase/migrations`, no una
migración publicada. Exige la variable de sesión
`SET ed_last_stage.bootstrap='ISOLATED_TEST_DATABASE'` y rechaza una base con la
integración antigua. No contiene DROP/TRUNCATE. Para un despliegue de staging habrá
que generar la migración con la CLI de Supabase, probarla allí y ejecutar advisors.
Las comprobaciones SQL de CI no se presentan como un informe del servicio Advisors.

No se ha verificado aún un proyecto Supabase remoto, PostgREST, Edge Runtime,
credenciales reales, recepción de webhooks reales, paginación o sincronización de
estados hacia Last.app. No hay UI nueva ni envío SMS real. Esta fase elimina el
acoplamiento en la nueva base de pruebas, no migra ni borra datos de producción.

Antes de usar datos reales: definir retención/purga de eventos y snapshots, verificar
límites globales, tratamiento de tabs fusionados y cancelaciones con GET no disponible,
configurar adapters, y ejecutar pruebas de contrato en un proyecto de staging
independiente. Nunca añadir snapshots reales o secretos al repositorio público.

Referencias técnicas consultadas para el diseño, separadas del contrato del usuario:
- https://supabase.com/changelog
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/functions/auth
- https://www.postgresql.org/docs/17/sql-select.html
