# ESTAMBUL DELIVERY 🚴

Plataforma propia de reparto para el restaurante con aplicación instalable de riders (**Android + iOS**), back office, vista de seguimiento y futura integración oficial con **Last.app** (con pedidos propios, Uber Eats y Just Eat servidos por riders propios).

## Estado actual — Octubre 2026
- ✅ **Demo web estática interactiva**: \`docs/index.html\`. Funciona sin backend. Permite ver riders, altas/bajas ficticias, cambiar asignaciones, simular posiciones, filtrar pedidos, navegar a Google Maps y alternar entre Back Office / Rider / Cliente. Almacena cambios solo en el navegador local.
- ✅ **Back office Next.js**: \`apps/backoffice\`, API local de pruebas, panel de despacho, listado, mapa simulado.
- ✅ **Rider App Expo / React Native**: \`apps/rider\`, Android e iOS, pantalla de pedidos y cambios de estado de DEMO.
- ✅ **Modelos compartidos**: \`packages/shared\`.
- ⏳ **Last.app real**: pendiente de tokens privados autorizados, prueba de endpoint de riders, confirmación de permisos y webhooks.
- ⏳ **Producción**: faltan identidad/autenticación, base de datos persistente, GPS protegido, permisos laborales y RGPD, notificaciones push, pruebas en dispositivo y despliegue seguro. No usar con datos reales.

**Ninguna demo comparte posiciones reales, envía WhatsApp o accede a clientes. No sustituir Shipday todavía.**

## Abrir la demo web ahora, sin instalar Node
En un servidor estático, abrir \`docs/index.html\`. Los datos están precargados. Para ponerla online gratis:
1. Abrir **Settings → Pages** de este repositorio en GitHub.
2. En **Source**, elegir **Deploy from a branch**.
3. Elegir rama \`main\`, carpeta \`/docs\` y pulsar **Save**.
4. Esperar la publicación que GitHub muestre en Pages. Nunca publicar datos reales aquí: GitHub Pages es público.

La demo es un sitio estático/PWA de ejemplo. **No es el backend de producción, ni un GPS real, ni sustituye la app nativa**.

## Desarrollo local
Requiere Node.js 22 (20+ compatible para la mayoría de paquetes).

\`\`\`bash
npm install
npm run dev:backoffice
# otro terminal, en la misma red para pruebas con móvil:
npm run dev:rider
\`\`\`

Back office: http://localhost:3000. Expo: abrir QR con herramientas de desarrollo. Para compartir cambios entre rider y back office durante la demo, copiar \`apps/rider/.env.example\` a \`apps/rider/.env.local\` y definir \`EXPO_PUBLIC_DEMO_API_URL=http://IP_LAN_DE_PC:3000/api/demo\`. No funciona en internet ni aporta seguridad; usar solo red de pruebas controlada.

\`\`\`bash
npm run typecheck:backoffice
npm run typecheck:rider
npm run check:demo
npm run build:backoffice
\`\`\`

**Importante:** el modo demo dinámico de Next no debe exponerse a internet con \`ENABLE_DEMO_API=true\`, porque no tiene login. En producción debe permanecer apagado.

## Arquitectura
\`\`\`
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
\`\`\`

## Limitaciones clave a validar con Last.app
1. Listado completo de riders propios con **ID estable**, nombre y teléfono.
2. Detección de altas, bajas y cambios de asignación.
3. Campos reales \`delivery.courier\` en pedidos de Last.app, Uber Eats y Just Eat.
4. Webhooks de cambio de rider, cancelación y entrega.
5. Autorización de Last.app para esta integración propia.

Consulta [plan de integración](docs/LAST_APP_INTEGRATION.md) y [plan de pruebas](docs/TEST_PLAN.md). No incluir claves API en GitHub ni en variables \`EXPO_PUBLIC_*\`.

## Propiedad y privacidad
Proyecto específico para operaciones con repartidores propios. El repositorio hoy puede ser público: mantenerlo sin secretos ni datos personales. Para la aplicación real se recomienda gestionar código e infraestructura privada, políticas de acceso, documentación laboral de geolocalización y acuerdos de tratamiento.
