# ESTAMBUL DELIVERY — LastPOS decide el Rider, la app organiza las entregas

## Regla de asignación (vigente desde octubre de 2026)

**No existe asignación automática por disponibilidad, proximidad, carga o conexión.**
- El responsable elige y cambia manualmente el courier dentro de **Last.app / LastPOS**.
- ESTAMBUL DELIVERY identifica ese courier por ID externo previamente vinculado al usuario Rider autorizado, o por su nombre si hay una única coincidencia inequívoca.
- El mismo courier puede tener **varios pedidos** simultáneos. No existe límite de uno por persona.
- Si Last no indica courier, el pedido queda **pendiente**, no se asigna aunque haya riders online.
- Si se retira la asignación en Last, el pedido deja de estar asignado al anterior; si se cambia a otro Rider, el pedido aparece solo al nuevo. Si el nuevo courier no se identifica con certeza, no se asigna a una persona equivocada.
- El personal no puede reasignar pedidos importados de Last desde el despacho de ESTAMBUL DELIVERY. El panel queda para seguimiento e incidencias.

## Optimización de lista, distinta de asignación

El Rider recibe **solo los pedidos que Last.app le asigna**. En la web Rider, la ruta sugerida prioriza el tiempo de espera real registrado en Last `creationTime`; cuando están todas las coordenadas disponibles y el GPS autorizado del Rider está visible, combina distancia aproximada y antigüedad con penalización creciente de pedidos con más de 18 y 30 min de espera.

Sin coordenadas, el botón «Optimizar» ordena por antigüedad sin inventar distancias. El Rider puede reordenar paradas manualmente y abrir itinerarios multiparada en Google Maps. En la app nativa, la ruta se ordena por antigüedad y, si hay coordenadas de destino, ajusta por proximidad entre paradas, sin GPS de origen. Son sugerencias: no mueven pedidos entre Riders ni modifican Last.app.

## Arquitectura de ingesta

Last.app webhook autenticado → cola segura `ed_last_webhook_events` → `ed-last-auto-sync` → consulta actualizada `GET /v2/tabs/{tabId}` → `ed_last_import_tab` → app Rider del courier designado.

La importación registra `creationTime` de Last para computar esperas, deduplica por ID de tab, procesa cancelaciones y usa únicamente locations autorizadas. El servicio no modifica LastPOS para cambiar la asignación.

## Pendiente de activar

Last.app todavía sigue en **«Solicitada»** y la bandeja tiene 0 eventos aceptados; ninguna localización está autorizada y no se importa ningún pedido real. Una vez activa la integración debemos verificar el **evento o mecanismo oficial para enterarnos de que se ha asignado/cambiado un courier en LastPOS**. Que `GET /v2/tabs/{tabId}` incluya `delivery.courier` no garantiza por sí solo un webhook de reasignación; si no lo hay, habrá que acordar con Last.app una reconciliación mediante API.

Antes de producción probar en un local demo: pedido nuevo sin asignar, asignar dos pedidos al mismo Rider, reasignar a otro, cancelar, y comparar `creationTime`. No utilizar órdenes reales hasta confirmar estos pasos.
