# Instalación PRO v4 — registro de publicación
Fecha: 2026-10-18
Repo: shaniwaris80-crypto/ESTAMBUL-DELIVERY
PR integrada: #24 — https://github.com/shaniwaris80-crypto/ESTAMBUL-DELIVERY/pull/24
Commit de fusión main: 3523cfb6ddb29634d1fcaae584194671a3659544

## Estado realmente instalado
- GitHub main: Backoffice live.html con CSS live-pro-v4.css, Rider rider.html con rider-pro-v4.css, track.html con track-pro-v2.css.
- Supabase producción wfrloqblbflltrjwdfmd: migrações aplicadas:
  - one_tracking_sms_per_order_no_status_messages
  - reversible_admin_operations_epoch
  - rider_read_only_last_items_snapshots
- Edge Functions desplegadas:
  - ed-send-notifications versión 13 — NO envía avisos al cambiar de estado.
  - ed-rider-accept-sms versión 12 — 1 intento de SMS de enlace por pedido, con claim durable.
  - ed-last-auto-sync versión 7 — añade snapshot de artículos de manera opcional y aislada de la importación del pedido.
- Rider web tiene habilitada la visualización opcional de artículos; pizzas/bebidas con casillas NO obligatorias.
- Las asignaciones de pedidos reales siguen siendo manuales de LastPOS.

## Verificación posterior de base (solo cantidades, sin PII)
- 67 pedidos, 3 cierres de caja, 0 reinicios ejecutados.
- 6 pedidos históricamente contabilizados como intento de enlace SMS.
- 0 avisos SMS/WhatsApp de estado pendientes en cola.
- 0 snapshots de productos por el momento; se generarán con futuras actualizaciones de Last.app.
- 0 entregas asignadas en curso en el instante de la comprobación.
- Sigue existiendo 1 entrega sin cierre/arqueo, por lo que la función de reinicio la bloqueará hasta regularizarla.

## Copia y límites de validación
- Backup del código original en `backup/estambul-before-pro-v4-20261018`, con fuentes Edge anteriores en `backup-supabase-edge/` y `BACKUP_MANIFEST_2026-10-18.md`.
- El usuario confirmó que generó un respaldo manual en su ordenador. No se descargó ni verificó su restauración desde este entorno; conservar archivo cifrado y contraseña por separado.
- Los scripts fueron verificados por 7 comprobaciones GitHub Actions; la exportación Android pasó.
- NO se ha confirmado directamente la disponibilidad externa de GitHub Pages desde este entorno (restricción de acceso web); el commit main sí está verificado.
- No se enviaron SMS de prueba ni se verificó entrega física a un teléfono autorizado.
- El código Expo para Rider nativo está integrado; desplegar una nueva app instalada en dispositivos requiere proceso propio de compilación/distribución.

## Comprobaciones operativas recomendadas
1. Abrir https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/live.html y validar inicio admin, resumen Rider y módulo de reinicio.
2. Abrir https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/rider.html y revisar login Rider 01, pedido asignado manualmente en LastPOS, listado de artículos (si disponible), no repintado de pagos.
3. Con teléfono de prueba autorizado: aceptar 1 pedido nuevo → comprobar exactamente un intento de enlace; actualizar a recogido/en ruta/entregado → cero SMS adicionales. Verificar delivery status en Twilio, no solo provider accepted.
4. Abrir el enlace privado original y validar estados, mapa cuando GPS compartido y accesibilidad móvil.
5. Realizar arqueo pendiente antes de solicitar REINICIAR. El reinicio nunca se ejecuta por instalar.
6. Comprobar que los Riders 02–05 tengan identidad Supabase vinculada y contraseña propia; una tarjeta visual no activa su cuenta.
7. Probar la restauración del backup cifrado en entorno aislado cuando sea posible.

## Rollback operativo
- Para volver al frontend anterior, recuperar el contenido desde el SHA original preservado o la rama `backup/estambul-before-pro-v4-20261018`; publicar `main` con commit de restauración validado.
- Mantener `ed-send-notifications` v13 desactivada: **NO** restaurar su versión antigua de estados automáticamente, pues reactivaría SMS múltiples.
- La tabla de reinicio es aditiva y puede quedar instalada mientras se recupera UI. Para revertir un reinicio de pantalla usar la RPC administrada RESTAURAR.
- La copia de código NO sustituye copia/restauración real de datos Supabase.
