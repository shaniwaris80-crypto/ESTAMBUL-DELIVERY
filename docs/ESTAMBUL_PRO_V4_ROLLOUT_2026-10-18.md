# Estambul Delivery PRO v4 — Unificación segura
**18 de octubre de 2026** · Rama: `feature/estambul-pro-unified-safe-20261018` · PR principal #22 a `main`.

## Decisión operativa innegociable
Las **asignaciones de pedidos reales siguen siendo manuales en LastPOS**. El back office permite asignar solo pedidos de pruebas `channel='test'`; para los reales muestra «Gestionar en Last.app». El Rider únicamente lee pedidos con su propio `rider_id`, conforme RLS. Los cambios de orden de la ruta son recomendaciones locales, no afectan `rider_id`. No hay auto-dispatch.

Se ha verificado en el SQL real (solo lectura) de `public.ed_last_import_tab`: el repartidor se resuelve del `delivery.courier.id/externalId` o del nombre solamente si es único y está activado; cuando Last no tiene asignación verificable, el pedido queda `pendiente`. No cambiar este algoritmo sin staging, registros de casos reales y autorización separada.

## Incluido en la PR #22
1. **Back office v4 profesional**, `docs/live-pro-v4.css`, `live.html`: navegación lateral en escritorio, navegación horizontal en móvil, estado visual de reparto, indicadores, accesos rápidos, filtros, vista de 5 Riders, arqueos y GPS. Reutiliza la autorización, las funciones y los IDs existentes. No expone paneles marcados `hidden`.
2. **Rider PRO v4**, `docs/rider-pro-v4.css`, app PWA y Expo: cinco perfiles, UI de alto contraste, paneles de reparto, navegación, cobros y listado opcional de artículos. Solo las pizzas y bebidas muestran casillas no obligatorias.
3. **Refresco cada 5 segundos sin destruir el cobro** (web): conservar elección por pedido en memoria, no reconstruir la tarjeta durante la selección o gesto de entrega, mantener bloqueo condicional de actualización de estado ante reasignación.
4. **Datos de Last.app**: mostrar advertencia en importes a cero, sin inventar el total; diagnóstico puro de `bills.total`, preferencias de pago y dinero ya pagado. `docs/staging/ed_last_import_tab_review.sql` es un borrador de revisión, **no se ejecutó**.
5. **Cobros nativos configurables para staging**: selección manual de efectivo cobrado, tarjeta cobrada o pago ya realizado online. `online` no se añade falsamente a la caja del Rider; se deja `payment_method=null` hasta definir estado de prepago y conciliación oficial. No alterar este comportamiento en producción sin plan económico.
6. **GPS gerente**: posición de antigüedad superior a 45 segundos no se presenta como «reciente». La PWA no garantiza ubicación con pantalla bloqueada.
7. **Artículos Last.app**: extracción y lecturas de snapshots propuestas con RLS y flags apagados; no requiere casilla alguna para entregar; extras y combos se ven si están en el desglose; no se inventan productos faltantes.

## Flags apagados por defecto
| Flag | Función | Estado |
|---|---|---|
| `ED_RIDER_ITEMS_INGEST_ENABLED` | Guardar lista Last.app en snapshots | OFF |
| `window.ESTAMBUL_RIDER_ITEMS_ENABLED` | Mostrar productos web | OFF |
| `EXPO_PUBLIC_RIDER_ITEMS_ENABLED` | Mostrar productos en app nativa | OFF |
| `EXPO_PUBLIC_RIDER_PAYMENT_CONFIRM_ENABLED` | Confirmación económica nativa | OFF |

## Puntos pendientes antes de producción
- Probar inicio de sesión Rider 01–05 con usuarios autorizados; perfiles visuales sin cuenta Auth y membresía activa no son accesos reales.
- Validar RLS en un proyecto staging para `ed_order_item_snapshots`: otra cuenta/Rider no puede leer los productos; sin datos personales filtrados.
- Comprobar con JSON de Last.app redactados: pizzas, bebidas, menús, ingredientes, descuentos, pago online y pedidos con `products=[]` o `bills=[]`. Los 54 pedidos Last.app de la auditoría histórica incluían 52 sin forma de pago clasificada, y 2 con importe cero.
- Revisar en un móvil real durante varios minutos la selección de pago frente a múltiples actualizaciones de 5 segundos y gestos de deslizar.
- Validar en Android e iPhone la navegación externa, retorno a Rider, estados, notificaciones y arqueo. El export de Android y `tsc` no sustituyen pruebas con terminal físico.
- Para el GPS continuo y notificaciones push en segundo plano hace falta una futura integración nativa con consentimiento y pruebas de permisos. **No está implementada en la versión v4**.
- Diferenciar pagos ya liquidados online de tarjeta cobrada por Rider en un modelo contable nuevo; verificar caja y prepagos antes de automatizar conciliaciones.
- No habilitar SMS desde el código nuevo: mantener un envío por aceptación, evitar duplicidad de Edge Functions antes de producción.
- Mantener activación de módulos por entorno y procedimiento de rollback; no fusionar la PR #22 con cambios de las PR #19–21 por separado, pues ya están integrados.

## Validación automática
- `scripts/test-estambul-unified-pro.mjs`: fuente de asignaciones LastPOS, botones de prueba, pagos, GPS reciente, RLS y componentes UI.
- `scripts/test-rider-order-items.mjs`: pizzas/bebidas opcionales, items malformados, XSS y permiso solo lectura.
- `scripts/test-rider-profiles.mjs`: acceso individual y retención solo de correo.
- GitHub Actions: workflows aislados y pruebas de tipos/build/export Android.
- Revisar el último commit y los checks exitosos en `https://github.com/shaniwaris80-crypto/ESTAMBUL-DELIVERY/pull/22` antes de cualquier publicación.

**Estado: desarrollo en borrador; sin modificar `main`, despliegues, clientes, repartos reales, Supabase de producción, Twilio ni cobros.**
