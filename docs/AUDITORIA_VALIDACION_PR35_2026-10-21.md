# Auditoría de validación — Estambul Delivery PR #35
Fecha: 21 octubre 2026. Rama: `feat/estambul-blue-green-full-redesign`.
Commit sometido a las verificaciones: `07a4866a57bc4e9fec2238423fb615fb85a688f7`.

## Resultado y límite
- **CI: 12/12 trabajos correctos** en el commit indicado: compilación, typecheck, pruebas de integración/seguridad de código, sin mensajes reales, y paridad de vistas previas.
- **NO APROBADO PARA PRODUCCIÓN**: CI ≠ prueba real de Last.app, de SMS entregado, de geolocalización nativa, de arqueo, de usuarios ni de enlace privado con pedidos reales.
- **No se publicaron despliegues, se borraron datos ni se enviaron mensajes reales en esta auditoría.**

## Entornos verificados (solo lectura)
### Producción
Proyecto Supabase `wfrloqblbflltrjwdfmd`, sano/activo.
- Tablas: ed_riders=0; ed_orders=0; ed_members=1; ed_shift_closures=0.
- Funciones Last.app: `ed-last-webhook` v10 y `ed-last-auto-sync` v7 activas; esto **no acredita** intercambio de pedidos reciente.
- `ed_dashboard_assign_order(uuid,uuid)` no aparece entre las funciones consultadas de producción; `ed_last_import_tab` sí existe.

### Staging
Proyecto Supabase `rknxqlijcgpbecoophva`, sano/activo.
- ed_riders=6; ed_members=0; ed_orders=0; ed_shift_closures=0.
- Last.app staging: `ed_last_stage.events`=6; snapshots=6; queue_runs=87; **0 pedidos operativos**, por lo que no hay E2E de reparto con riders autenticados.
- Funciones `edv9-last-gateway` y `edv9-last-queue` activas, **diferentes** a las funciones de producción. No es un entorno gemelo y la paridad de integración debe verificarse antes de copiar cualquier configuración.
- `public.ed_dashboard_assign_order(uuid,uuid)` tiene EXECUTE para authenticated (con control de personal dentro de la función); modifica `ed_orders` y `private.ed_last_order_links` y permite una anulación interna. **Conflicto funcional potencial** con política solicitada de asignación exclusiva en LastPOS; no se invocó. Mantener congelado el uso en pedidos Last reales mientras se decide si desactivar o restringir esta vía.
- No hay cuentas `ed_members` de los seis riders. Las tarjetas/perfiles de staging NO acreditan acceso operativo.

### Seguridad y rendimiento
- Tablas públicas de ambos proyectos consultados tienen RLS. No constituye prueba de aislamiento por pedido/usuario.
- Los asesores reportan funciones públicas SECURITY DEFINER accesibles a anon por token (ed_public_track, ed_customer_chat_history, ed_customer_chat_send, ed_submit_feedback). Esto puede ser deliberado para seguimiento privado, pero hay que auditar comprobación de token, caducidad, permisos, rate limiting y acceso cruzado. No revocar a ciegas porque rompería seguimiento.
- Los asesores también indican varias funciones SECURITY DEFINER con EXECUTE para authenticated, y varias FK sin índice. Revisar caso por caso; los avisos automáticos no equivalen por sí solos a vulnerabilidades.
- No hay proyectos disponibles en la conexión Vercel consultada.

## Diseño
- Referencia aprobada: navy/emerald, Back Office (ES), Rider y Cliente (EN).
- Archivo Figma editable de referencia: https://www.figma.com/design/xRR9HgBV0nb1jE5LSS12r3
- Se crearon marcos editables de Operaciones, Rider y Cliente; son **esquemas de diseño**, no capturas verificadas de app compilada ni mapas GPS reales.
- La prueba `scripts/test-preview-parity.mjs` pasó; comprueba paridad de archivos y funciones, **no sustituye** capturas de navegador en tamaños móvil/tablet/escritorio.
- Validación visual en navegador/Android/iPhone real aún no terminada. Evitar afirmar identidad píxel a píxel con el mockup.

## Puertas de salida pendientes (obligatorias)
1. Probar acceso real de admin y seis riders en staging con cuentas propias. No guardar contraseñas en repositorio.
2. Verificar flujo LastPOS manual: evento válido, duplicado, retrasado, cambio de courier, cancelación, llegada a ed_orders y visibilidad para rider correcto sin asignación automática desde panel.
3. Probar dos pedidos/dos riders y RLS, enlaces de seguimiento privados, chat entre clientes, caducidad de token y GPS opt-in.
4. Probar varios pedidos, navegación, recogida, en_ruta, entrega y pagos en efectivo/tarjeta/online; arqueo provisional/cierre y reversibilidad.
5. Testar mensajes con números aprobados y registro de entrega de proveedor, máximo un enlace inicial y ninguna notificación duplicada. **No enviar mensajes en staging automático**.
6. Compilar Android e iOS y probar localización en segundo plano, bloqueo del teléfono, permisos revocados, caídas de red, navegación y alertas. No afirmar que el GPS funciona en segundo plano por superar el typecheck.
7. E2E visual en Chromium/móvil; comprobar accesibilidad, contraste, desbordamiento y botones reales.
8. Staging y producción con esquema/funciones compatibles, respaldo recuperable verificable y prueba de rollback antes de cualquier merge/despliegue.

## Decisión
**NO-GO para producción.** Conservar PR #35 en borrador; documentar/solucionar bloqueo de identidades y paridad staging, probar los flujos reales y repetir las 12 comprobaciones. Esta auditoría fue de solo lectura en Supabase y no alteró webhooks ni Last.app.
