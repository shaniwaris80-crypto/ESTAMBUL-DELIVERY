# ESTAMBUL DELIVERY frente a Shipday — análisis de funciones

Base: lista de funcionalidades que aportó el usuario y páginas públicas de Shipday consultadas en octubre de 2026. **No equivale a verificar todas las funcionalidades de cada plan de Shipday**.

| Función mencionada | ESTAMBUL DELIVERY, octubre 2026 |
|---|---|
| Pedidos pagados ilimitados | No hay límite explícito en el esquema, pero capacidad y facturación en escala no están probadas |
| Repartidores ilimitados | Esquema permite altas; actualmente solo está probado un rider activo y falta un sistema de alta múltiple seguro |
| 5 cuentas de personal | Roles admin/dispatcher existen, pero no hay interfaz de invitación y gestión de cinco cuentas |
| Avisos SMS/WhatsApp | No implementados; solo se copia TXT de arqueo, no se envía automáticamente |
| Optimización de rutas | Parcial: varios destinos en Google Maps, reordenar, proximidad aproximada con coordenadas; no rutas reales por tiempos/tráfico |
| Asignación automática estándar | No; solo manual |
| Formularios de pedido del cliente | Solo formulario interno del administrador, no público |
| Chat entre rider y dispatcher | No implementado |
| Cálculo de pago del repartidor | Parcial: arqueo por método de pago, no nóminas ni comisión del rider |
| Integraciones preparadas | Last.app, Uber y Just Eat no enlazados de forma real |
| API y webhooks | Supabase ofrece APIs internas, pero faltan API pública integrada y webhooks comerciales |
| Soporte por correo | No hay organización o equipo de soporte montado |
| Seguimiento del conductor en tiempo real | No hay GPS en segundo plano ni mapa de posición real |
| Fotos / firma de entrega | No |
| Notificaciones push con el teléfono bloqueado | No, solo sonido en web abierta |
| App nativa disponible en tiendas | Código Expo preparado; no publicada ni compilada para usuarios |
| Historial y arqueo de efectivo/tarjeta | Sí, cierre diario individual almacenado con detalle por pedido; requiere que el administrador clasifique las entregas anteriores |

## Siguiente orden recomendado

1. Terminar y probar el arqueo con dos riders reales; validación de cobros y casos especiales.
2. Geocodificación autorizada, rutas por tiempo real y secuenciación multientrega.
3. Push fiable, pruebas en iOS/Android y compilaciones firmadas.
4. Acceso API oficial de Last.app, ingestión, idempotencia, cancelaciones y sincronización de riders.
5. Chat, autodespacho, ETA y página de seguimiento de cliente.
6. Seguridad, auditoría, política de datos, RGPD y piloto paralelo a Shipday.

Enlaces públicos de referencia:
- https://www.shipday.com/es/precios
- https://www.shipday.com/features/mobile-app-for-drivers
- https://www.shipday.com/features/proof-of-delivery
- https://www.shipday.com/features/branded-tracking-and-customer-communication


## Nuevas funciones destacadas de Shipday: marca y fidelización

| Función | Estambul Delivery |
|---|---|
| Seguimiento personalizado con la marca | MVP web disponible: nombre, colores, logo externo y enlace privado por pedido |
| SMS de estado automático | Pendiente de proveedor de mensajería y consentimiento/avisos adecuados |
| Feedback tras cada entrega | Disponible mediante enlace de seguimiento; 1–5 estrellas y comentario, una valoración por pedido |
| Invitación a reseña Google | Disponible **si el administrador configura el enlace oficial**, mostrada a todos los clientes que recibieron su pedido |
| Recuperación automática de clientes insatisfechos | Pendiente de automatización; opiniones negativas destacadas y estados de atención manual |
| Recordatorios automáticos de repetición | No implementados; requieren consentimiento promocional explícito, proveedor y opción de baja |
