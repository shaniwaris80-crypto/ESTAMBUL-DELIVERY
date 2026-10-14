# Seguimiento cliente V19 — GPS, ETA y llamada al restaurante

## Cambios
- Página privada de seguimiento `track.html`: botón fijo por pedido **Llamar al restaurante · 947 009 319** (`tel:+34947009319`), independiente de la ubicación del rider.
- Aviso permanente con el estado de GPS cuando un pedido está `en_ruta`, incluso cuando no se puede mostrar el mapa.
- Actualización del mapa aproximadamente cada 7 segundos cuando la página cliente está visible (antes cada 15 segundos).
- App Rider: pulsar `Compartir GPS con este cliente` puede iniciar el permiso de ubicación directamente. GPS voluntario y por pedido. En primer plano se solicita posición al menos cada ~20 segundos incluso si el rider está quieto. Sigue sin GPS garantizado con móvil bloqueado.
- El cliente solo ve coordenadas si el rider activo optó por compartir con **ese pedido**, el estado está `en_ruta`, y hay posición de menos de 45 segundos.
- ETA aproximada del servidor: distancia de Haversine × 1,35 (factor orientativo de calles), dividida por velocidad GPS reciente si es fiable (8–60 km/h) o referencia urbana de 18 km/h, más 3 minutos de margen. No es navegación por carretera, no tiene tráfico, y no presenta hora estimada si falta ubicación o destino geocodificado.
- Panel Admin: se pueden consignar coordenadas de destino para nuevos pedidos y editar las existentes. Abrir dirección en Google Maps facilita recuperar la latitud y longitud manualmente. No se envían direcciones de clientes a servicios de geocodificación externos automáticamente.

## Cómo comprobarlo con un pedido ficticio
1. En `live.html` entrar como administrador, crear una entrega ficticia con dirección y coordenadas de destino (latitud y longitud; ambas son necesarias para ETA), asignar a un rider de pruebas.
2. En `rider.html` iniciar sesión como el rider, ponerse `Online`, aceptar pedido, marcar `Recogido` y después `En ruta`.
3. Pulsar `Compartir GPS con este cliente`, permitir geolocalización y mantener Rider visible en el móvil.
4. En el cliente abrir el enlace privado generado por el administrador/rider. Se debe visualizar GPS del rider y ETA orientativa si hay coordenadas de destino.
5. Bloquear pantalla, desactivar GPS, retirar permiso o completar entrega: el mapa debe ocultarse en menos de 45 segundos y el aviso explicar por qué la posición ya no es reciente. Llamar al restaurante permanece disponible.
6. La ruta de arqueo y los historiales anteriores no se modifican.

## Limitaciones
- Actualmente el entorno conectado no contiene pedidos activos, destinos geocodificados ni posiciones GPS. No afirmar que el GPS se haya verificado desde dos dispositivos todavía.
- Para navegación con Google Maps, aplicaciones minimizadas o teléfono bloqueado se necesita una app nativa Android/iOS con permisos de ubicación en segundo plano, aviso laboral adecuado y autorización voluntaria por pedido.
- No utilizar esto para operaciones reales sin validar dispositivos, permisos RGPD, reglas de retención y calidad de estimaciones; el servicio público de mapas puede recibir las coordenadas que se muestran en él.
- El token de Last.app y la configuración de su integración NO se han modificado.
