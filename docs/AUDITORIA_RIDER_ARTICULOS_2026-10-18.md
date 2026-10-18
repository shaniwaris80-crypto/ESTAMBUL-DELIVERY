# Auditoría Rider PRO: artículos, olvidos de pizzas y fiabilidad
**Fecha:** 2026-10-18 | **Rama:** feature/rider-pro-order-checklist-20261018 (partiendo de Rider PRO v3 / PR #20)  
**Ámbito:** inspección del código de GitHub + esquemas y agregados SQL de Supabase. No se consultaron datos personales de clientes. No se tocó el sistema desplegado.

## Hallazgo principal: los artículos ya llegan, pero Rider los descarta
- La Edge Function `ed-last-auto-sync` consulta de forma autenticada `GET https://api.last.app/v2/tabs/{id}` y llama a `ed_last_import_tab`.
- El importador persiste cliente, dirección, notas, importe, estado y Rider en `ed_orders`; **no tiene columna de artículos ni tabla de líneas**. Ni la PWA ni Expo consultan artículos.
- Inspección agregada de `private.ed_last_webhook_events`: **248** eventos; **96** incluyen campo `data.products` array; **23** con producto(s) no vacíos en ese campo; **53** eventos de tipo reparto propio con JSON estructurado; **22** tienen productos raíz no vacíos, **14** también incluyen facturas. Son eventos, no necesariamente pedidos únicos ni contenido completo del tab recuperado.
- Las líneas pueden contener `name`, `quantity`, `modifiers`, `comments`, `comboProducts`. Los combos, extras y cantidades exigen parseo estructurado.
- La API/documentación de Last.app contempla productos en el tab y en facturas. No combinar ciegamente ambas listas: podría duplicarse una pizza. La elección aquí prioriza lista raíz no vacía; si falta, facturas no borradas.
- Algunas respuestas están incompletas: NO marcar jamás «todo recogido» automáticamente ante una lista vacía; conservar el último snapshot válido de artículo y solicitar validación de ticket cuando no exista información.

## Hallazgos adicionales con impacto real
| Riesgo | Hallazgo | Acción segura |
|---|---|---|
| Alto | Pedido sin detalles visibles → pizzas/bebidas olvidadas | Lista con cantidades + extras + confirmación antes de recogida |
| Alto | Last.app en base: 54 pedidos, 52 sin método de pago, 2 con 0 € | Separar método sugerido, cobro pendiente y pedido ya pagado; integrar PR #19 después de staging |
| Alto | La PWA repinta tarjetas cada 5 s; pierde selección de pago | Integrar fix de borradores por pedido del PR #19; evaluar también UX/táctil |
| Alto | La app Expo conectada cambia a «entregado» sin seleccionar método de cobro | Añadir confirmación de efectivo/tarjeta/prepago y validación de caja antes de usarla operativamente |
| Medio-alto | PWA GPS se detiene cuando el navegador se oculta | GPS continuo exige módulo nativo, permisos de segundo plano, supervisión y pruebas físicas |
| Medio | Confirmación de artículos solo en memoria | Añadir registro por Rider, revisión/versionado y hora en backend cuando se apruebe |
| Medio | Last.app puede cambiar pedido tras marcar productos | Revisar snapshot/revisión, invalidar checklist y solicitar nueva confirmación |
| Medio | No hay garantía de entrega o lectura de SMS en Twilio | Mantener política de un SMS por aceptación y deduplicación al resolver PR #17 |
| Medio | Hasta 5 perfiles visuales no implican 5 identidades activas | Vinculación individual en Auth, pertenencia Rider y validación RLS |

## Implementación realizada SOLO EN RAMA
1. `docs/rider-items.js`: parseo puro, 80 líneas máximo, 30 extras y 30 componentes por línea; saneado de nombres, cantidad y comentarios; doble conteo evitado; control por `revision` y orden.
2. `docs/rider.js` + `rider.html` + `docs/rider-packing.css`: módulo nuevo de lectura opcional. Muestra checkboxes individuales de pizzas, bebidas, salsas y combos antes de confirmar recogida/iniciar reparto. Si falta el desglose, verificación MANUAL del ticket y las bolsas; no se simula ni inventa contenido.
3. `apps/rider/lib/connected.ts` + `apps/rider/app/connected.tsx`: paridad en la pantalla nativa Expo, con casillas por línea e indicación de la falta de información.
4. `supabase/functions/ed-last-auto-sync/index.ts`: llamada opcional para guardar snapshot tras el importador, sin dejar de importar pedidos si falla.
5. `docs/staging/order-item-snapshots-review.sql`: **propuesta SQL sin aplicar**: tabla de items con política RLS de Rider asignado/gerente y RPC solo service_role que extrae datos mínimos y evita guardar PII.
6. `scripts/test-rider-order-items.mjs` + workflow CI: tests sintéticos de duplicados, combos, cantidades, XSS, RLS, bloqueo/confirmación y flags.

## Todo DESACTIVADO por defecto
- PWA: `window.ESTAMBUL_RIDER_ITEMS_ENABLED === true` (no activado en `rider.html`).
- Expo: `EXPO_PUBLIC_RIDER_ITEMS_ENABLED=true` SOLO tras validar el backend; sin esta variable no consulta detalle.
- Worker: `ED_RIDER_ITEMS_INGEST_ENABLED=true` SOLO tras migración y validación. No se desplegó código ni se añadieron secretos.
- Ninguna migración aplicada a Supabase. Ningún SMS enviado. `main` intacta.
- Por tanto, los artículos **todavía NO aparecen en producción**. El código está listo para una ronda controlada de QA, no para publicarse directamente.

## Pruebas antes de publicar
1. Aplicar SQL en una **base staging** primero; verificar RLS: Rider A puede leer su pedido, Rider B no; rol sin autenticación no; no existe escritura de clientes.
2. Obtener JSON real redactado de Last.app/GloriaFood con pedido pizza+modificadores+combo, bebidas y un pedido sin desglose; comprobar datos, cantidades, revisiones y actualizaciones.
3. Pedido con pizzas, postres y bebidas: marcar todo antes de «Confirmar recogida». Verificar que no deja avanzar mientras falte alguna casilla.
4. Sin lista: mensaje «sin desglose» y casilla de confirmación de cocina/ticket; no bloquear al rider por caída del API.
5. Restaurar red, recarga, cancelación, reasignación, producto modificado y simulación de 3 pedidos simultáneos.
6. Revisar sincronización cada 5 s, cobro por tarjeta y efectivo, navegación a Google Maps, pantalla bloqueada y Rider Expo.
7. Antes del despliegue, decidir si la verificación de embalaje debe persistirse en un servidor: sin ello las marcas se pierden al cerrar o reinstalar la app.
8. Fusionar PR #20 y resolver conflictos de PR #19/17 con pruebas de integración; **no fusionar PR directamente en main sin QA**.

## Próximas mejoras profesionales
- «Bolsa 1 de 3», etiquetas grandes PIZZA/BEBIDAS/POSTRES y resumen de unidades por categoría.
- Dos fases: «Cocina lista» (preparador) y «Rider ha recogido» (repartidor). Registro con hora, operario y versión de pedido, evitando confirmar productos que no se han preparado.
- Alertas «pedido incompleto», chat interno con cocina y trazabilidad de faltantes, sin SMS nuevos.
- Confirmación final de método y estado real de pago/arqueo para la app Expo.
- KPI: incidencias por olvido, tiempo de preparación, errores por canal, percentiles de entrega y exactitud de cobros.
