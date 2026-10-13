# Plan de pruebas — Estambul Delivery

## A. Demo local (sin datos reales)
1. Abrir `docs/index.html`, verificar 7 pedidos ficticios y 4 riders de ejemplo.
2. Cambiar filtro de canal entre Last.app / Uber Eats / Just Eat.
3. Asignar ED-1004 al Rider A; comprobar que desaparece de "Sin asignar".
4. Ir a "App Rider (vista demo)" y seleccionar Rider A; ED-1004 debe aparecer.
5. Confirmar recogida → iniciar reparto → completar entrega; comprobar cambio en "Entregados".
6. Reasignar ED-1002 al Rider C, regresar a la vista rider y comprobar movimiento de la lista.
7. Desactivar un rider; los pedidos no finalizados deben pasar a "Sin asignar".
8. Añadir un rider nuevo, filtrar por él, reactivar rider anterior.
9. Pulsar "Simular movimiento GPS"; comprobar cambio de posición en esquema.
10. Abrir "Seguimiento cliente" y seleccionar distintos pedidos ficticios.
11. Recargar el navegador: debe persistir la demo en ese mismo navegador. Pulsar "Reiniciar demo".
12. Abrir desde un segundo navegador/dispositivo: las demos NO se sincronizan entre sí (funcionamiento esperado de localStorage).

## B. API de desarrollo Next + Expo (mismo servidor)
- Arrancar Next en red local y conectar Expo configurando EXPO_PUBLIC_DEMO_API_URL.
- Cambiar asignación desde panel → verificar lista de rider en móvil tras refrescar.
- Cambiar estado en móvil → verificar reflejo en panel.
- Reiniciar servidor → los datos del demo Next vuelven a valores ficticios iniciales.
- Confirmar que /api/demo está deshabilitado en producción salvo si se habilita expresamente; NO habilitar en internet.
- Verificar manejo de servidor caído y riders desactivados.
- Nota: no hay autenticación; red controlada exclusivamente para pruebas.

## C. API Last.app — pendientes de permisos
- Crear 2 riders en sandbox de Last.app.
- Obtener catálogo con IDs únicos / teléfonos y comprobar los permisos.
- Asignar pedido A → Rider 1 desde LastPOS y consultar representación API real.
- Reasignar A → Rider 2; comprobar webhook o intervalo de refresco.
- Renombrar Rider 2 y eliminar Rider 1. Confirmar actualizaciones.
- Pedidos de Uber Eats / Just Eat con reparto propio: probar origen, rider y estado.
- Cancelaciones antes y después de recoger: no entregar pedidos cancelados.
- Duplicados y webhooks desordenados: preservar únicamente estado más reciente válido.
- Pérdida de internet: sincronización idempotente cuando se recupera.

## D. Antes de usarlo en el restaurante
- Roles, sesiones protegidas, registro de auditoría, datos cifrados, RGPD.
- GPS foreground/background en Android e iOS físico con consentimientos/permisos adecuados.
- Precisión/batería/red, reintentos y bloqueo de pantalla.
- Push APNs/FCM y notificaciones de reasignación/cancelación.
- Optimización de rutas real, tiempos de llegada e integración Google Maps autorizada.
- Verificar contrato con Last.app y no desactivar Shipday hasta 1-2 semanas de pilotaje paralelo estable.
