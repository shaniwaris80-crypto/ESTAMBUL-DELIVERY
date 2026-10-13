# Plan de pruebas — Estambul Delivery

## Fase A — demo local, sin datos reales
1. Iniciar `npm run dev:backoffice`, abrir localhost:3000 y verificar 4 riders y 7 pedidos ficticios.
2. Filtrar pedidos por Uber Eats, Just Eat y Last.app.
3. Asignar ED-1004 a Rider A y verificar que la tabla, los contadores y el mapa cambian.
4. Abrir `npm run dev:rider` en un móvil con la IP LAN configurada; elegir Rider A y comprobar que ED-1004 aparece en menos de ~5 s (polling).
5. Cambiar la asignación de ED-1004 a Rider B; debe desaparecer de A y aparecer en B tras actualización.
6. Pulsar Recogido → Iniciar reparto → Confirmar entrega desde Rider B y comprobar el estado en el back office.
7. Desactivar Rider B en back office: los pedidos no entregados deben quedar desasignados; probar la cuenta desactivada.
8. Añadir un rider demo y comprobar que aumenta el contador.
9. Pulsar 'Simular movimiento GPS' y ver que se mueve un marcador (datos ficticios).
10. Restablecer demo y comprobar que vuelven los datos originales.

## Fase B — integración sandbox de Last.app (sin datos reales)
11. Crear riders en el sandbox Last.app y verificar por API lectura de ID, nombre y teléfono **si está permitido**.
12. Crear, renombrar y eliminar un rider, verificar cambios y latencia.
13. Asignar y reasignar un pedido desde LastPOS y comprobar qué datos/eventos se reciben.
14. Validar pedidos propios y los originados en Uber/Just Eat, tanto entrega propia como cancelados.
15. Repetir webhooks y cortar temporalmente conexión: no debe haber duplicados ni pérdida de cambios.

## Fase C — dispositivos y privacidad (antes de producción)
16. Pruebas Android y iPhone reales: permisos GPS, pantalla bloqueada, reconexión, ahorro de batería y cambio de red.
17. Notificaciones push con la app cerrada, duplicaciones y pedidos reasignados.
18. Acceso por roles; rider A nunca ve datos reales de rider B.
19. Link de seguimiento: caduca y solo muestra un pedido; no expone teléfonos ni otras entregas.
20. Pruebas de seguridad, protección de datos y aceptación con usuarios internos.

## Criterios de salida
No retirar Shipday hasta disponer de asignaciones confirmadas, sincronización de riders, seguridad, GPS fiable y un piloto completo con reparto real consentido y supervisado.
