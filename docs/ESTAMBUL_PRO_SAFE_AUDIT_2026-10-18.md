# Estambul Delivery PRO — Auditoría inicial y Estambul Labs
Fecha: 2026-10-18. Rama: feature/estambul-labs-safe-20261018
Ámbito: auditoría del código de main y laboratorio de simulación. Sin leer datos de clientes, modificar Supabase o enviar SMS.

## Hallazgos sobre el código actual
- live.html y docs/live.js: back office conectado, estados, GPS por rider, notificaciones y arqueos.
- rider.html y docs/rider.js: PWA Rider, aceptación, navegación y caja. La PWA no garantiza GPS con móvil bloqueado.
- track.html y docs/track.js: seguimiento privado, ETA orientativa, posición autorizada y reciente, ayuda y valoración.
- ed-rider-accept-sms y ed-send-notifications son dos canales separados de mensajería; revisar cuando la regla es un SMS.
- La ETA actual no constituye una ruta real por carretera.
- El código del repositorio puede diferir del backend desplegado. La lectura estática no certifica funcionamiento de producción.

## Implementación aislada
- labs.html + docs/labs.js + docs/labs.css + docs/labs-core.mjs.
- Cliente: progreso y condiciones estrictas de vigencia para mostrar GPS y rutas, con datos inventados.
- Operaciones: avisos por pedidos sin rider, retrasos, GPS no reciente, pago sin clasificar y duplicado de origen.
- Economía: resumen simulado en céntimos de efectivo, tarjeta, importes sin clasificar y diferencia.
- Riders: carga de pedidos, entregas y promedio de tiempos de ejemplo.
- Labs: interruptores sensibles permanentemente desactivados y simulación interactiva.

## Protección
- No incluye claves, cookies, teléfonos, direcciones o coordenadas reales.
- No realiza peticiones de red, GPS, SMS, WhatsApp, consultas a Supabase, almacenamiento local ni modificaciones de pedidos.
- No cambia index.html, live.html, rider.html, track.html, SQL, Edge Functions ni arqueos.
- Todas las cifras se muestran como DEMO y no representan los resultados reales del negocio.
- Los avisos son recomendaciones de revisión, no ejecutan asignaciones.

## Comprobaciones
Ejecutar:
- node --check docs/labs-core.mjs
- node --check docs/labs.js
- node --check scripts/test-labs.mjs
- node --test scripts/test-labs.mjs

El workflow .github/workflows/estambul-labs.yml ejecuta pruebas sin credenciales.
Los tests no sustituyen el control visual, accesibilidad móvil y pruebas con servicios de staging.

## Antes de cualquier conexión real
1. Comprobar permisos por rol y RLS en staging, con datos de prueba.
2. Conectar sólo consultas de lectura mínimas; no filtrar datos personales a una página pública.
3. Distinguir efectivo, tarjeta en reparto, prepago y pago desconocido, sin cambiar el arqueo existente.
4. Probar política de un SMS al aceptar y enlace reutilizable con idempotencia de backend.
5. Verificar GPS autorizado y ETA por carretera en dispositivos reales, sin geolocalizar fuera del reparto.
6. Comprobar que fallos de nuevas vistas no afectan recepción, asignación, reparto ni pagos.
7. Revisar RGPD, límites de costes, monitorización, copia y rollback.

## Decisión
Dejar PR como borrador. Mantener main intacta. Sin despliegue automático.
