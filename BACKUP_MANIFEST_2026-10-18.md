# ESTAMBUL DELIVERY — INVENTARIO DE COPIA PRE-PRO V4
Fecha de referencia: 2026-10-18.

## Código base
- Repositorio: `shaniwaris80-crypto/ESTAMBUL-DELIVERY`
- `main` en el momento de crear la copia: `b07a17bf07100e239f15d65712ffb0c5c2130fc8`
- Copia original: rama `backup/estambul-before-pro-v4-20261018`.
- Páginas originales: `live.html`, `rider.html`, `track.html`, ficheros de `docs/` y app Expo, sin cambios de nueva versión.

## Funciones ACTUALMENTE desplegadas que se preservaron por separado
Las siguientes fuentes se leyeron **directamente del Supabase del restaurante**, no solo del código GitHub, y se guardaron en `backup-supabase-edge/`:
- `ed-send-notifications/index.ts`: versión Supabase **12**.
- `ed-rider-accept-sms/index.ts`: versión Supabase **11**.
- `ed-last-auto-sync/index.ts`: versión Supabase **6**.

## Alcance y restricciones del backup
- Se conserva la versión de código web y fuentes de las tres funciones. Esto NO es un snapshot completo del proyecto Supabase ni de la base de datos.
- Usuarios, pedidos, contactos, mensajes, tickets, pagos, historia contable, almacenamiento y secretos de entorno **NO se copiaron a GitHub** por seguridad.
- Para poder restaurar también la base de datos, verificar un backup real en Supabase: **Database > Backups** y, cuando corresponda, PITR. La disponibilidad depende del plan del proyecto.
- No asumir que restaurar una base de datos antigua es inocuo: podría perder pedidos aceptados después de la copia. Priorizar rollback del frontend/Edge y migraciones aditivas cuando sea posible.
- Si una versión nueva elimina SMS por estado, **no reactivar `ed-send-notifications` antiguo automáticamente**, pues podría generar SMS repetidos de la cola; mantenerlo apagado durante un rollback operativo y revisar estado de la cola.

## Pasos de vuelta atrás
1. Detener una nueva publicación y registrar su SHA.
2. Preparar una restauración de las páginas originales desde el SHA base o rama `backup/...`, validando los cambios de configuración de hospedaje GitHub Pages.
3. Restaurar solo las funciones afectadas desde `backup-supabase-edge/` tras revisar permisos y compatibilidad de esquema; mantener desactivada mensajería de estados para evitar duplicados.
4. No borrar, deshacer ni restaurar indiscriminadamente filas reales. La vista operativa se puede deshacer con `ed_restore_operations_view` si la migración de reinicio ya está instalada.
5. Confirmar LastPOS manual, pedidos reales, Rider, arqueos, tracking privado y SMS con prueba controlada.
