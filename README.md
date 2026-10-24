# Estambul Delivery · Delivery Manager

Nueva implementación en una rama independiente del reinicio del 24/10/2026.

## Estado verificado

- Web adaptable: administración, Rider y seguimiento por enlace privado.
- API y esquema independientes (`dm_*`) desplegados en **ESTAMBUL DELIVERY STAGING** (`rknxqlijcgpbecoophva`).
- Una cuenta admin y cinco cuentas Rider creadas; inicio de sesión de las seis probado. Contraseñas entregadas fuera del repositorio.
- Flujo probado contra la API y base de datos reales de staging con un pedido ficticio: online → aceptar → empezar → GPS → entregar → arqueo.
- Aislamiento de pedidos por rider, rechazo de transiciones ajenas o repetidas, bloqueo de arqueo con pendientes y cierre del GPS público tras entrega comprobados.
- Last.app y Twilio **NO están conectados en este entorno**. No se ha recibido un pedido real ni enviado un SMS real. No usar todavía para operación comercial.
- GPS web y avisos requieren la aplicación abierta. No hay binarios Android/iOS ni ubicación garantizada con pantalla bloqueada.
- ETA orientativa por distancia, sin tráfico ni otras paradas. Google Maps se abre para consultar rutas; no se usa la API de Routes ni se integra en el mapa de Uber Eats.

## Flujo

1. Admin configura Last.app, local aprobado, unidad monetaria y vínculo exacto de cada courier.
2. Rider se conecta con su usuario individual.
3. Last.app asigna manualmente; el webhook consulta `GET /v2/tabs/{id}` y actualiza el pedido.
4. Rider acepta: cambio atómico a `accepted` y creación de una única salida SMS por pedido.
5. Con Twilio habilitado, se intenta enviar el enlace único. Un resultado ambiguo nunca se reintenta automáticamente. `sent` significa aceptado por Twilio, no entrega confirmada al teléfono.
6. «Empezar reparto» habilita la ubicación del rider en el enlace del cliente.
7. «Completar entrega» pide forma de pago e importe; deja de devolver GPS al cliente. El enlace caduca dos horas después.
8. El cierre archiva entregas, calcula efectivo/tarjeta/prepagado y desconecta al rider.

## Código

- `web/`: cliente sin framework, Leaflet vendorizado, cartografía IGN, manifiesto web.
- `backend/api.mjs`: API autenticada, seguimiento, chat, cuentas y ajustes.
- `backend/last.mjs`: recepción autenticada Last.app, local permitido y deduplicación.
- `backend/schema.sql`, `backend/credentials.sql`: esquema nuevo; no restauran ni alteran las tablas antiguas.
- `backend/runtime.mjs`: credenciales privadas cifradas AES-GCM. La clave reside en `DM_ENCRYPTION_KEY`, o en la clave de servicio del proyecto como alternativa. Una rotación requiere volver a configurar las conexiones.
- `backend/index.ts`, `backend/webhook.ts`: entradas de Supabase Edge Functions.
- `tests/`: pruebas unitarias. `scripts/test-staging.mjs`: prueba con cuentas y pedido ficticio, credenciales externas.

## Seguridad

Las tablas `dm_*` tienen RLS activo y no conceden acceso directo a anon/authenticated. La API comprueba el token con Supabase Auth y consulta la pertenencia activa en la base de datos. Todas las operaciones de dinero/estado ejecutan funciones transaccionales invoker reservadas a service_role. Los permisos de administrador no proceden de metadatos editables por el usuario.

Los avisos informativos del asesor sobre RLS sin políticas corresponden al cierre deliberado del acceso directo. Los avisos `ed_*` preexistentes pertenecen a la aplicación antigua y no se modificaron.

El enlace del cliente actúa como secreto de acceso: UUID aleatorio de alta entropía, caducidad, respuesta limitada al propio pedido, GPS reciente solo durante el reparto. No devuelve la lista de pedidos, teléfonos de otros clientes, claves ni posiciones de otros riders. La política de referrer solo comparte el origen con los proveedores del mapa.

El endpoint de provisión de cuentas se retiró del código desplegado tras crear las seis cuentas. No hay acceso de demostración ni bypass de autenticación publicado.

## Conectar desde Integraciones

1. Guardar token de integrador Last.app y los tres campos de Twilio (SID, Auth Token, número emisor). No pegarlos en el chat ni el repositorio.
2. Indicar Location ID permitido, unidad real de `total` (no se adivina), teléfono del restaurante y origen HTTPS de seguimiento.
3. Vincular cada rider a `delivery.courier.id` o, si no existe ID, al valor exacto de `delivery.courier.name` recibido. No hay coincidencias aproximadas ni reparto automático.
4. Suscribir en Last.app `tab:created`, `tab:updated`, `tab:delivery-status-updated`, `tab:cancelled`, `tab:closed` a `https://rknxqlijcgpbecoophva.supabase.co/functions/v1/dm-last`.
5. Consultar un pedido de prueba desde la sección Integraciones y confirmar dirección, coordenadas, artículos, importe y rider. Comprobar que una reasignación en Last.app emite un evento y llega aquí.
6. Habilitar SMS y comprobar una aceptación real con un teléfono autorizado. Confirmar recepción en el teléfono, no solamente HTTP 200 de la app.
7. Probar en Android e iPhone sobre HTTPS, permisos GPS y pérdida de conexión. No dar por terminado GPS en segundo plano ni push nativo: requieren aplicación nativa y validación propia.

La integración de producción antigua no se ha reemplazado. Cambiar su URL de webhook exige una puesta en marcha coordinada después de estas pruebas.

## Comandos

```
npm install
npm run check
npm test
ED_TEST_CREDENTIALS=/ruta/privada/credenciales.json node scripts/test-staging.mjs
```

La prueba de staging necesita una colección `accounts` con email/password y, para el flujo completo, un pedido ficticio `QA-FLOW` asignado al primer rider. No almacenar ese fichero en Git. Se borraron exclusivamente los registros ficticios creados durante la validación.

Fuentes técnicas: https://developers.last.app/docs/index.html · https://www.twilio.com/docs/messaging/api/message-resource · https://www.idee.es/resources/documentos/Cartociudad/CartoCiudad_ServiciosWeb.pdf
