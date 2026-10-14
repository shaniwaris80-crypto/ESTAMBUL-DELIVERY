# Last.app → App Rider sin despacho intermedio (auto-dispatch)

**Objetivo**: Last.app emite un webhook; el servidor consulta `GET /v2/tabs/{tabId}` con el secreto del integrador, importa la entrega y elige el rider adecuado; los Riders reciben sus pedidos con el sondeo de Supabase existente (~5 s con la app visible). **No es necesario asignar desde Live Admin.**

## Código desplegado en el backend
- `ed-last-webhook`: valida el Bearer de Last.app, almacena el evento de forma idempotente y lo entrega en segundo plano a la función interna.
- `ed-last-auto-sync`: verifica credencial interna de servicio, obtiene evento de la bandeja, consulta la ficha actual del pedido en Last.app y llama a la RPC de importación.
- `015_last_to_rider_auto_import.sql`: vínculos por ID de local de Last.app, importación idempotente por ID de tab, cancelaciones; sólo se aceptan pedidos de entrega.
- `016_assign_waiting_last_orders_on_rider_online.sql`: si no había riders online, al ponerse uno online asume pedidos propios pendientes autorizados sin pasar por despacho.
- `017_do_not_override_unknown_last_courier.sql`: nunca reasigna silenciosamente un pedido que Last había destinado a un courier explícito todavía no identificado.

## Política de asignación
1. Courier con `id/externalId` conocido y enrolado: asignar a ese Rider, aunque estuviese momentáneamente offline.
2. Courier sin ID pero nombre único coincidente con un Rider enrolado: asignar al Rider inequívoco. Requiere verificar nombres de Last.
3. Last no aporta courier: asignar al Rider **online y enrolado** con menor cantidad de entregas pendientes; desempatar establemente.
4. Sin Rider disponible: guardar pedido como pendiente. Cuando un Rider autorizado se ponga online, se asigna automáticamente (máximo 25 en cada activación).
5. Courier especificado por Last pero sin correspondencia fiable: poner en espera con `assignment_blocked`. No se envía a otro Rider erróneamente; hay que establecer correspondencia de IDs para ese caso.

Las cancelaciones de Last.app anulan pedidos no entregados; pedidos ya entregados conservan historial. Los duplicados se evitan con el par `(location_id, tab_id)` y transacciones serializadas.

## Activación por establecimiento: una sola vez, no por pedido
**NO está activo** hasta que:
1. Last.app deje de mostrar «Solicitada», entregue `location:integrated` autenticado y `GET /v2/organizations` muestre la organización.
2. Se compruebe que el token configurado en el webhook coincide con el que Last.app envía; un HTTP 401 significa que ese evento no llega al sincronizador.
3. En la bandeja `private.ed_last_locations` aparezca el locationId obtenido del webhook.
4. Se compruebe que el ID pertenece a **Kebab Estambul**, antes de ejecutar (con servicio autorizado) `ed_last_bind_location(p_location_id,p_account_id)`, que vincula **una vez** ese establecimiento a la cuenta ESTAMBUL DELIVERY.
5. Se revisen 2–3 pedidos ficticios de sandbox, comparando dirección, importe, pago, canal, courier, cancelación y duplicados antes de aceptar pedidos reales.

**La existencia del backend no equivale a una integración activada.** Las aplicaciones no reciben pedidos de Last.app si la tarjeta sigue como «Solicitada».

## Limitaciones a revisar antes de uso real
- La API pública documenta en algunos ejemplos `delivery.courier.name`, pero puede no dar un ID estable. La asignación necesita enrolamiento y mapeo fiable para riders nombrados.
- Si Last no devuelve `bills.total`, la importación registra importe 0 y forma de pago puede estar sin clasificar hasta recibir datos verificables. Nunca se presupone que un pago online sea cobro en efectivo.
- Falta sincronización bidireccional de estados Rider → Last.app y reconciliación periódica de pedidos si falla un webhook.
- La PWA y app Rider existente consultan cada 5 s **cuando están activas**; notificaciones push reales con teléfono bloqueado no están terminadas.
- No sincronizamos órdenes de takeaway, mesa, terceros que no correspondan a entrega. No se hacen pedidos reales de prueba ni se modifica el token almacenado por el usuario.
- Los errores de webhook se guardan sin credenciales, y quedan pendientes para reintentar mediante una llamada de servicio con `{ "drain": true }` al worker interno.

## Comprobación del estado
Consultar:
```sql
select count(*) as locations, count(*) filter(where enabled) as authorized
 from private.ed_last_locations;
select count(*) as linked_orders from private.ed_last_order_links;
select count(*) filter(where processed_at is null) as pending,
       count(*) filter(where processed_at is not null) as processed
 from private.ed_last_webhook_events;
```
No imprimir tokens, teléfonos ni datos personales en los logs.
