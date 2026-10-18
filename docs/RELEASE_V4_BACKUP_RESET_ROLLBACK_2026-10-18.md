# Publicación Estambul Delivery PRO v4 — procedimiento reversible
Fecha de preparación: 18 de octubre de 2026
ÚNICA PR de publicación: https://github.com/shaniwaris80-crypto/ESTAMBUL-DELIVERY/pull/24

## Situación antes de publicar
- Código frontend anterior respaldado desde commit `b07a17bf07100e239f15d65712ffb0c5c2130fc8` en rama `backup/estambul-before-pro-v4-20261018`.
- Edge Functions desplegadas respaldadas en `backup-supabase-edge/` en la misma rama: avisos v12, aceptación con SMS v11, sincronización Last.app v6.
- El respaldo anterior no contiene los datos de Supabase ni asegura la restauración de esquemas, usuarios ni conversaciones.
- Supabase producción: `wfrloqblbflltrjwdfmd`. Se consultó en modo lectura y NO se ejecutaron migraciones ni resets.
- Auditoría previa: 67 pedidos, 18 entregados, 49 pendientes; 1 entregado sin asiento en cierre de caja. La cifra cambia con el reparto, así que volver a verificar antes del reinicio.
- No hay rama de desarrollo Supabase disponible. No crear una rama o proyecto con coste sin aprobación explícita del usuario.

## 0. Copia de seguridad RECUPERABLE de base de datos (bloqueante)
Entrar a Supabase Dashboard > Project ESTAMBUL DELIVERY > Database > Backups.
Confirmar existencia, fecha y retención de un backup reciente y estrategia de restauración. En caso de no disponer, generar/exportar respaldo lógico por método oficial y guardarlo en ubicación privada cifrada. NO escribir JSON de clientes en GitHub ni generar una falsa copia con exportación parcial.
No ejecutar la migración ni publicar antes de que esta condición esté validada.
Referencias: https://supabase.com/docs/guides/platform/backups

## 1. Validación en staging (bloqueante)
- Usar proyecto/branch Supabase aislado, con datos sintéticos, sin teléfonos ni SMS de clientes reales.
- Probar SQL de `docs/staging/operations-reset-soft-archive-review.sql`: SELECT RLS para dueño/Rider correcto, admin reset, Rider denegado, doble confirmación, bloqueo si reparto activo o caja sin cerrar, restauración y registro auditado.
- Probar el SQL de un único SMS de `docs/staging/one-sms-tracking-policy-review.sql`: dos claims concurrentes devuelven exactamente un TRUE; marcación de antiguos envíos; permisos service role.
- Probar `docs/staging/order-item-snapshots-review.sql` con Last.app sintético: pizzas, bebidas, extras, combos, vacío y reimportación. Asegurar RLS cruzado.
- Probar diagnóstico de importes/pagos Last.app `docs/staging/ed_last_import_tab_review.sql` sin aplicarlo hasta conciliar facturas reales y prepagos.
- No volver a enviar SMS por cambios de estado. Deshabilitar drenaje de cola antes de activar el nuevo aceptador SMS.
- Probar una única aceptación con teléfono expresamente autorizado y revisar estado Twilio y entrega final; simular timeout e intento repetido.
- Probar Rider web/Expo/gerencia, botón de reinicio, restauración, reasignación tardía desde LastPOS y cierres de caja.
- Verificar navegadores móviles con pantalla bloqueada; el GPS continuo nativo aún no está garantizado.
- Ejecutar los siete workflows GitHub hasta SUCCESS.

## 2. Publicación coordinada
No fusionar #22, #23 y #24 secuencialmente (causaría publicación parcial); la PR #24 integra las tres.
No publicar solo frontend antes de la política de SMS y SQL, ni solo SQL con antiguo cliente/funciones.
Planear ventana sin pedidos activos ni arqueos pendientes. Pausar drenes antiguos de notificaciones durante el cambio.
Efectuar copia/preflight, aplicar migraciones y Edge Functions revisadas y publicar la PR #24 coordinadamente.
Dejar flags de productos, cobranzas nativas y cualquier autobooking apagados hasta completar QA; el diseño puede coexistir con las funciones antiguas.
No activar envío SMS global sin probar aislamiento y autorización en staging.
Mantener LastPOS como único sistema para asignaciones reales.

## 3. Reinicio sin borrado (solo a petición del administrador)
**Nunca ejecutarlo automáticamente por publicar.**
Después de instalar la migración de reset, el administrador ve «Reiniciar operaciones».
Primero terminar pedidos asignados y cerrar caja de entregas pendientes; después pulsar y escribir `REINICIAR`.
Solo cambia el timestamp operativo: los anteriores dejan de contarse en pantallas; histórico intacto.
Si LastPOS asigna más tarde un pedido viejo, reaparece aunque sea previo al timestamp.
`RESTAURAR` devuelve la vista anterior auditada.
Esta función no borra clientes, usuarios, arqueos, mensajes, logs ni copias.

## 4. Vuelta atrás
En caso de fallo visible, reponer frontend de `backup/estambul-before-pro-v4-20261018` (SHA original arriba).
Las Edge Functions históricas se preservaron, pero **NO volver a activar la antigua cola de SMS** por riesgo de duplicados: mantener nuevo no-op mientras se repara.
La migración de reinicio es aditiva, de modo que volver al código anterior simplemente la ignora; si hace falta mostrar pedidos antiguos, usar el RPC de restauración desde administración.
No restaurar la base entera durante horas de operación sin comprobar si elimina pedidos nuevos.
Comprobar con pruebas reales controladas el enlace de seguimiento, LastPOS manual, pago Rider y sincronización antes de reabrir.

## Estado
Preparado en GitHub, NO implantado en Supabase producción ni `main`.
