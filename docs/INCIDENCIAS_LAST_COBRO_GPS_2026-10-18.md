# Incidencias Last.app · Cobros Rider · GPS (18 octubre 2026)

## Diagnóstico sobre main y Supabase (solo lectura)
- En la muestra agregada de Supabase: 54 pedidos con canal lastapp; 52 sin payment_method y 2 con amount=0. No se consultaron datos personales.
- El importador SQL de Last.app calcula el importe exclusivamente desde bills[].total. Cuando la respuesta aún no incluye factura, el total queda en 0.
- El importador lee preferredPaymentMethod del tab o de facturas: es una preferencia de cobro, NO demuestra que el cliente haya pagado en efectivo o tarjeta. Los pagos reales se consultan en bills[].payments y pueden indicar prepago; la clasificación automática requiere modelar pagos ya realizados por separado.
- La PWA consulta pedidos cada 5 segundos y reconstruye el HTML de todas las tarjetas, destruyendo selectores activos. Corrección propuesta en docs/rider.js: borrador por pedido en memoria, protección del selector enfocado y deslizamientos, mismo PATCH condicional protegido para entrega.
- En el panel gerente, el umbral visual de GPS era de 120 segundos: ahora se propone mostrar "reciente" sólo cuando sea <=45 segundos. No significa que la posición esté continuamente actualizada.
- La PWA Rider deja de enviar GPS cuando el navegador queda oculto y puede pararse con el dispositivo bloqueado. No debe afirmarse que funciona en segundo plano.
- El proyecto Expo nativo conectado todavía no depende de expo-location ni expo-task-manager. No hay servicio de GPS de fondo configurado.

## Qué queda preparado en esta rama
1. docs/rider.js: preservar forma de pago durante refresco automático; conservar funciones y peticiones existentes. Etiqueta verificar importe cuando un pedido de origen Last aparezca con 0 EUR.
2. docs/live.js: no presentar un punto GPS de más de 45 segundos como ubicación en vivo.
3. docs/last-finance-diagnostic.mjs: comprobador aislado con datos sintéticos de facturas, pagos y preferencias.
4. docs/staging/ed_last_import_tab_review.sql: propuesta SQL sin ejecutar; excluye facturas borradas y evita que una respuesta de Last incompleta sobrescriba un importe previamente conocido.
5. tests de regresión y CI sin tokens.

## Diseño para corregir Last.app sin falsear caja
- Obtener en staging un pedido con pago pendiente en efectivo, otro con tarjeta a domicilio, otro ya pagado en plataforma y otro con descuentos. Guardar JSON redactado, sin datos del cliente.
- Confirmar en el endpoint v2/tabs la ubicación real de total, bills, payments, preferredPaymentMethod y deleted, para cada tipo. La documentación de Last.app define importes monetarios en unidades mínimas.
- Añadir al modelo de pedidos dos conceptos separados: importe total de venta y estado de cobro. No tratar un pago en línea como una nueva deuda al rider.
- Confirmar antes de entregar: efectivo recogido, tarjeta cobrada por rider o ya pagado. Esto requiere diseño del esquema y reconciliación de arqueos, no cambiar enums ni importes de producción a ciegas.
- Auditar diferencia por fuente: LastPOS, GloriaFood, Uber Eats, Just Eat; no crear cargos o entradas duplicadas.
- Tras pruebas de integración, preparar migración oficial y despliegue con rollback.

## Diseño de GPS real gerente y cliente
- **Staff**: autenticación por rol, geolocalización reciente solo para repartos activos, sello temporal y precisión; no mostrar posiciones caducadas. No publicar coordenadas fuera de permisos y turnos.
- **Cliente**: enlace privado firmado por token; solo pedido en ruta, rider autorizado, consentimiento explícito para compartir, GPS reciente <=45s; revocar al finalizar.
- **Android + iPhone**: implementar en app nativa con Expo Location y TaskManager y build de desarrollo, solicitud visible de permisos de ubicación en uso y en segundo plano, Android foreground service y permiso Always en iOS cuando proceda. Requiere pruebas físicas de bloqueo de pantalla, multitarea y batería.
- Iniciar solo cuando el rider está conectado y realizando una entrega; detener al entregar, desconectarse, revocar permiso o salir del turno. Frecuencia adaptativa, filtros de precisión y retención corta.
- Indicador de GPS: activo, esperando permiso, desconectado, señal antigua y error. NO reemplazar GPS con simulaciones ni dibujar una ruta por carretera sin proveedor de routing.
- **NO ACTIVADO**: actualmente no se ha añadido seguimiento continuo nativo, ni nuevos permisos, ni servicio de ubicación en segundo plano.

## Validaciones obligatorias
- CI JavaScript + tests de regresión y revisión táctil del selector durante al menos tres ciclos de sincronización.
- Pruebas con pedidos ficticios en staging: doble tap/deslizamiento, cambio de estado durante edición, fallo de red, abonos, pagos precobrados.
- SQL candidato evaluado en base de pruebas con funciones y restricciones reales, sin sobrescribir valores ni importes históricos.
- GPS móvil real en iOS y Android con permisos separados y consentimiento.
- No fusionar este PR hasta validar manualmente y aprobar despliegue.
