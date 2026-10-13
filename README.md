# ESTAMBUL DELIVERY 🚴

## Estado verificable del sistema conectado (14 octubre 2026)

El modo de prueba conectado **YA dispone de Supabase** y corre en `/live.html` y `/rider.html`:
- Administrador y Rider 1 activos; Rider 2 pendiente de terminar el alta.
- Formularios de pedidos y asignación manual, importe, efectivo/tarjeta, datos e instrucciones de cliente ficticio.
- La App Rider permite sonido con el navegador abierto, navegación en Google Maps al iniciar reparto y rutas de múltiples paradas.
- El Rider presenta un arqueo de cierre diario: detalle por pedido en efectivo, tarjeta y sin clasificar, total del día, efectivo realmente contado y diferencia. El cierre permanece guardado para consulta del administrador y deja al Rider offline.
- Rutas de varios pedidos: paradas reordenables a mano, enlaces por tramos a Google Maps; optimización aproximada por proximidad solo si todas las paradas tienen coordenadas. **No hay optimización automática real por carretera sin un servicio de geocodificación y rutas**.
- **Todavía NO hay** integración Last.app real, push con móvil bloqueado, GPS operativo continuo, app nativa instalada, chat, auto-despacho ni pagos bancarios. El proyecto sigue siendo de pruebas: no cargar clientes reales hasta completar seguridad, RGPD y piloto.

---


Plataforma propia de reparto para el restaurante con aplicación instalable de riders (**Android + iOS**), back office, vista de seguimiento y futura integración oficial con **Last.app** (con pedidos propios, Uber Eats y Just Eat servidos por riders propios).

## Estado actual — Octubre 2026
- ✅ **Demo web estática interactiva**: `docs/index.html`. Funciona sin backend. Permite ver riders, altas/bajas ficticias, cambiar asignaciones, simular posiciones, filtrar pedidos, navegar a Google Maps y alternar entre Back Office / Rider / Cliente. Almacena cambios solo en el navegador local.
- ✅ **Back office Next.js**: `apps/backoffice`, API local de pruebas, panel de despacho, listado, mapa simulado.
- ✅ **Rider App Expo / React Native**: `apps/rider`, Android e iOS, pantalla de pedidos y cambios de estado de DEMO.
- ✅ **Modelos compartidos**: `packages/shared`.
- ⏳ **Last.app real**: pendiente de tokens privados autorizados, prueba de endpoint de riders, confirmación de permisos y webhooks.
- ⏳ **Producción**: faltan identidad/autenticación, base de datos persistente, GPS protegido, permisos laborales y RGPD, notificaciones push, pruebas en dispositivo y despliegue seguro. No usar con datos reales.

**Ninguna demo comparte posiciones reales, envía WhatsApp o accede a clientes. No sustituir Shipday todavía.**

## Abrir la demo web ahora, sin instalar Node
En un servidor estático, abrir `docs/index.html`. Los datos están precargados. Para ponerla online gratis:
1. Abrir **Settings → Pages** de este repositorio en GitHub.
2. En **Source**, elegir **Deploy from a branch**.
3. Elegir rama `main`, carpeta `/docs` y pulsar **Save**.
4. Esperar la publicación que GitHub muestre en Pages. Nunca publicar datos reales aquí: GitHub Pages es público.

La demo es un sitio estático/PWA de ejemplo. **No es el backend de producción, ni un GPS real, ni sustituye la app nativa**.

## Desarrollo local
Requiere Node.js 22 (20+ compatible para la mayoría de paquetes).

```bash
npm install
npm run dev:backoffice
# otro terminal, en la misma red para pruebas con móvil:
npm run dev:rider
```

Back office: http://localhost:3000. Expo: abrir QR con herramientas de desarrollo. Para compartir cambios entre rider y back office durante la demo, copiar `apps/rider/.env.example` a `apps/rider/.env.local` y definir `EXPO_PUBLIC_DEMO_API_URL=http://IP_LAN_DE_PC:3000/api/demo`. No funciona en internet ni aporta seguridad; usar solo red de pruebas controlada.

```bash
npm run typecheck:backoffice
npm run typecheck:rider
npm run check:demo
npm run build:backoffice
```

**Importante:** el modo demo dinámico de Next no debe exponerse a internet con `ENABLE_DEMO_API=true`, porque no tiene login. En producción debe permanecer apagado.

## Arquitectura
```
apps/
  backoffice/       Next.js: panel y API DEMO en memoria
  rider/            Expo (Android/iPhone): vista nativa DEMO
packages/
  shared/           modelos y datos simulados
docs/
  index.html        web DEMO estática apta para GitHub Pages
  demo.css/demo.js  controles, mapa esquemático y localStorage
  LAST_APP_INTEGRATION.md
  TEST_PLAN.md
  SECURITY_PRIVACY.md
  RELEASE_CHECKLIST.md
```

## Limitaciones clave a validar con Last.app
1. Listado completo de riders propios con **ID estable**, nombre y teléfono.
2. Detección de altas, bajas y cambios de asignación.
3. Campos reales `delivery.courier` en pedidos de Last.app, Uber Eats y Just Eat.
4. Webhooks de cambio de rider, cancelación y entrega.
5. Autorización de Last.app para esta integración propia.

Consulta [plan de integración](docs/LAST_APP_INTEGRATION.md) y [plan de pruebas](docs/TEST_PLAN.md). No incluir claves API en GitHub ni en variables `EXPO_PUBLIC_*`.

## Propiedad y privacidad
Proyecto específico para operaciones con repartidores propios. El repositorio hoy puede ser público: mantenerlo sin secretos ni datos personales. Para la aplicación real se recomienda gestionar código e infraestructura privada, políticas de acceso, documentación laboral de geolocalización y acuerdos de tratamiento.


## Modo conectado entre ordenador y varios riders — NUEVO
Además de la demo pública, hemos incorporado una **segunda aplicación web con autenticación y base de datos Supabase**, accesible desde \`live.html\` una vez que se configure un proyecto Supabase propio. También está añadido el modo conectado en la aplicación Expo de Android/iOS. Se sincroniza por sondeo cada ~5 segundos y los riders ven solo sus pedidos (RLS).

**Importante:** el proyecto Supabase aún no está aprovisionado y Last.app no está enlazado. En la web conectada aparece «Conexión pendiente» hasta configurar \`docs/live-config.js\` con la URL y clave PUBLICABLE (nunca secretas). Las instrucciones paso a paso se encuentran en [docs/LIVE_MODE.md](docs/LIVE_MODE.md) y [supabase/README.md](supabase/README.md).


## App Rider para abrir desde el móvil

- **App Rider web (PWA de pruebas):** https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/rider.html
- Inicio de sesión individual de un usuario con rol rider, protegido por Supabase RLS.
- Muestra solo sus pedidos; puede marcar recogida, iniciar reparto, confirmar entrega y cambiar disponibilidad.
- Se puede añadir a la pantalla de inicio del iPhone o Android desde el navegador.
- **No es un APK ni una app de App Store/TestFlight**. El código nativo Expo está en apps/rider/ y requiere compilación de desarrollo, firmado y pruebas en dispositivos.
- Falta dar de alta/activar al administrador y crear las cuentas individuales de cada rider para iniciar las pruebas.


### Provisión inmediata de Riders de prueba
Desde el panel autenticado `live.html`, el administrador puede pulsar **Crear y activar cuentas Rider**. Una función Supabase Edge (JWT obligatorio) genera credenciales temporales distintas para cada repartidor ya autorizado; deben cambiarlas en la app Rider al primer acceso. La activación requiere pulsar el botón con sesión de administrador y aún no equivale a integración de Last.app. Consulta [docs/RIDER_APP.md](docs/RIDER_APP.md).

## Seguimiento personalizado y opiniones (versión de prueba)

Se ha añadido una página de seguimiento por pedido en `/track.html#token=...`. El enlace se crea **desde el administrador autenticado** con el botón «🔗 Enlace» junto a cada pedido, y se copia al portapapeles para que el establecimiento pueda compartirlo manualmente. Un nuevo enlace invalida el anterior. Caduca a los 21 días.

El cliente puede comprobar **pedido recibido → asignado → recogido → en camino → entregado** sin iniciar sesión, y no se publica su nombre, teléfono, dirección ni la posición del rider. Cada enlace utiliza un token aleatorio fuerte guardado únicamente como hash en Supabase; evita enviarlo a personas ajenas.

En **Marca y experiencia del cliente** el administrador configura el nombre visible, color corporativo, logo mediante URL HTTPS y enlace oficial de reseñas de Google opcional. No se crea por defecto ningún enlace de Google Reviews: hay que introducir el real.

Después de la entrega, el cliente puede dejar una valoración del **1 al 5** y comentario. Se almacena una sola valoración por pedido y aparece en «Opiniones y seguimiento» del administrador, con estado **Pendiente / Contactado / Resuelto**. La invitación a reseña pública, si está configurada, se muestra a **todos los clientes entregados**, independientemente de la valoración que hayan dado; no hacer review gating.

**Todavía no implementados:** envío automático de SMS/WhatsApp, avisos al cliente sin abrir el enlace, recuperación automática de malas experiencias, campañas de repetición de pedidos, seguimiento GPS con ETA, automatización comercial y conectividad con pedidos reales de Last.app. Las comunicaciones promocionales futuras exigirán consentimiento específico verificable y baja sencilla; antes de activarlas se necesita un proveedor de mensajería apropiado (SMS/WhatsApp Business), políticas de privacidad y comprobaciones legales.

Seguridad: el enlace de seguimiento se trata como credencial privada y se puede revocar al generar uno nuevo; no se debe publicar en redes o loguear el token. La URL emplea el fragmento de la dirección para que no se transmita automáticamente en las solicitudes HTTP del sitio.
