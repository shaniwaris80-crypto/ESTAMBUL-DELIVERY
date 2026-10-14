# Estambul Delivery — Rider UX v18 / Seguimiento privado

Esta mejora se aplica a la **PWA conectada de pruebas**, `rider.html`, al administrador `live.html` y a la página `track.html`. **No implica que Last.app esté conectado ni que los pedidos reales se importen automáticamente**.

## Repartidor — estilo moderno, no clon de Uber
- Interfaz de alto contraste, jerarquía visual clara, tarjetas grandes y acciones cómodas para móvil.
- En un pedido **en ruta**, el gesto «Desliza para entregar» actualiza el estado a `entregado` en Supabase al superar el 80 % del recorrido de la barra.
- Existe también el botón «Confirmar entrega con botón» para accesibilidad y teléfonos incompatibles.
- La escritura de estado tiene comprobación de rider y estado anterior en base de datos; si se reasigna o cambia, se rechaza.

## Arqueo sin pérdidas de historial
- Cuando se entrega un pedido, pasa a «Entregas por arquear» y desaparece de la lista activa.
- Al cerrar correctamente el arqueo, sus IDs quedan en `ed_shift_closure_items` y ya no aparecen en la jornada del repartidor ni en la tabla principal del despacho.
- El administrador puede pulsar «Mostrar también pedidos ya incluidos en arqueos cerrados», y conserva los importes, pagos y diferencias en «Arqueos».
- No se borran pedidos ni se reinician contadores fiscales o registros anteriores. Si se abre otro turno el mismo día, solo cuentan sus entregas nuevas.

## Ubicación en directo: permiso específico por pedido
1. El repartidor acepta el pedido y obtiene el enlace privado de seguimiento, o el administrador lo genera.
2. Cuando el pedido esté recogido o en ruta, activa el GPS voluntario en `rider.html`.
3. Pulsa «Mostrar mi ubicación al cliente» **en ese pedido**. Puedes detenerla desde el mismo botón; el administrador también puede revocarla.
4. El cliente abre su enlace `track.html#token=...`. Durante `en_ruta`, verá un mapa si hay una coordenada con menos de 45 segundos.
5. Al entregar, cerrar la página, dejar de compartir o perder datos recientes, el mapa desaparece; se siguen viendo los estados del pedido.

**Privacidad:** los enlaces usan tokens aleatorios de 256 bits, solo se almacena su hash en Supabase, y la función pública devuelve la coordenada exclusivamente para el pedido de ese token. No devuelve teléfonos ni dirección del cliente. El proveedor externo OpenStreetMap recibe las coordenadas necesarias para representar el mapa cuando este se muestra; debe explicarse en el aviso de privacidad del servicio.

**Límite de la PWA:** geolocalización únicamente con navegador visible y autorización del sistema. Si el repartidor cambia a Google Maps o bloquea el teléfono, el envío de GPS puede detenerse. Para seguimiento permanente durante navegación y móvil bloqueado hace falta la aplicación nativa Android/iOS con permisos de ubicación en segundo plano, controles de privacidad, consentimiento laboral y pruebas de batería.

## Instalación de base de datos

Aplicar `supabase/migrations/013_rider_ux_private_guest_gps.sql` **antes** de desplegar la nueva interfaz. Las funciones nuevas son:
- `ed_rider_unclosed_completed_ids`: historial pendiente de arqueo, solo para el rider autenticado.
- `ed_staff_archived_order_ids`: IDs ya cerrados, limitado al personal autorizado.
- `ed_set_customer_location_share`: activar solo por el rider asignado, desactivar también por personal autorizado.
- `ed_public_track`: añade `live_location` opcional y efímero, manteniendo el estado, la marca, la llamada laboral opt-in y la valoración.

## Prueba manual antes de utilizar clientes
1. Crear pedido de prueba y asignarlo al rider.
2. Aceptar, recoger, iniciar reparto y activar GPS con el móvil y página visibles.
3. Compartir mapa para ese pedido y comprobar que solo su enlace muestra coordenadas recientes.
4. Desactivar GPS y confirmar que el mapa desaparece como máximo en 45 s.
5. Reactivar, deslizar hasta completar entrega y verificar que **no** aparece mapa después.
6. Verificar efectivo, tarjeta, sin clasificar y diferencia de arqueo; cerrar y comprobar que se vacía la sección «Entregas por arquear».
7. En el administrador, confirmar que el pedido sigue en «Arqueos» y puede verse activando «Mostrar también...».
8. Reabrir turno, entregar otro pedido y verificar que el arqueo nuevo no vuelve a sumar el anterior.

No usar pedidos reales ni activar seguimiento con clientes hasta pasar controles RGPD, dispositivos y permisos.
