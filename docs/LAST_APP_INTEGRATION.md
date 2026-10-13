# Last.app → Estambul Delivery: contrato de integración pendiente

## Objetivo
**Last.app es la fuente de verdad** de los riders propios y sus asignaciones. Los nombres visibles pueden coincidir, pero NO deben usarse como identificador primario si Last.app proporciona un ID. Una modificación o baja en Last.app debe propagarse sin dejar pedidos entregables a un rider inactivo.

## Confirmado vs pendiente
- Last.app gestiona riders propios en LastAdmin/LastPOS y ha documentado información sobre courier en ciertos datos de pedido.
- Debemos confirmar con datos de sandbox los campos exactos y versiones de respuesta API, ya que un ejemplo público no garantiza que se facilite un listado de riders.
- **No** se ha confirmado endpoint público para listar todos los riders, ni webhook específico de asignación/baja.
- No leer ni reproducir pantallas de LastPOS con scraping; obtener permisos oficiales.

## Preguntas a integrations@last.app
1. ¿API o método oficial para listar riders de cada localización con `id`, `name`, `phone`, `active`?
2. ¿Cómo se notifican altas/bajas/modificaciones y cómo se reconoce la eliminación de un rider?
3. ¿Qué campos contiene `delivery.courier` en `GET /v2/tabs/{tabId}` y en listado de pedidos?
4. ¿Qué eventos permiten webhooks para asignaciones, reasignaciones, cancelaciones y entregas? ¿Cómo verificar firmas/reintentos?
5. ¿Los pedidos de Uber Eats y Just Eat **con reparto propio**, recogidos en LastPOS, incluyen el rider y estados con los mismos permisos?
6. ¿Hay sandbox/organización ficticia y cuotas de consulta acordes al intervalo previsto?

## Arquitectura de producción propuesta
```
Last.app --(API autorizada / webhooks firmados)--> Servicio de ingesta (servidor)
     --> normalización + deduplicación (lastTabId, version, source)
     --> base de datos (riders, orders, assignments, status_events)
     --> canal de eventos autenticado
     --> App Rider iOS/Android + Back Office web
     --> enlaces efímeros /track/{token} para cliente
```

Siempre verificar en backend los permisos: usuario rider X puede leer solo pedidos asignados a X; supervisor puede operar únicamente con los establecimientos autorizados.

## Reglas de sincronización
- **ID externo**: enlazar rider por `lastRiderId`. Solo usar el nombre como posible coincidencia manual si es **único**; nunca asignar de manera silenciosa por un nombre ambiguo.
- **Alta**: crear asociación inactiva o pendiente de enrolamiento; enviar invitación controlada para activar la cuenta móvil.
- **Renombre**: actualizar nombre sin cambiar identificador ni historial.
- **Baja**: desactivar cuenta, cerrar sesiones, detener tracking y notificar al supervisor de pedidos sin rider. Conservar histórico mínimo necesario según política.
- **Reasignación**: actualizar atómicamente el rider de pedido, retirar acceso del anterior, notificar al nuevo. Evitar entregas duplicadas.
- **Cancelación**: bloquear entrega y retirar rutas activas. Especial atención a cancelaciones no sincronizadas en todos los canales.
- **Sin webhook**: sondeo moderado de API dentro de cuota autorizada más reconciliación de estado, con ventana de seguridad y alerta de último sync.
- **Conflictos**: Last.app manda en asignaciones, pero la app móvil reporta recogida/entrega y el servidor decide qué estados puede devolver.

## Contrato de datos mínimo (por validar)
```json
{
  "external_order_id": "id-de-lastapp",
  "external_rider_id": "id-estable-del-repartidor",
  "rider_name": "Nombre visible",
  "source_channel": "lastapp|uber|justeat",
  "destination": {"lat": 0, "lng": 0, "address": "..."},
  "status": "pending|assigned|picked_up|en_route|delivered|cancelled",
  "source_updated_at": "fecha fuente"
}
```
Es un **contrato interno propuesto**, NO un JSON ni endpoint oficial confirmado de Last.app.

## Datos de prueba
Utilizar solo organizaciones ficticias y pedidos de test. La demo en `docs/` no accede a Last.app. No cargar tokens en GitHub ni en la app cliente.
