# ESTAMBUL DELIVERY — Rider App (Web + Expo)

## App web instalable en pantalla de inicio (fase de pruebas)
Abrir en el móvil: **https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/rider.html**

- iPhone / Safari: pulsa **Compartir** → **Añadir a pantalla de inicio**.
- Android / Chrome: menú ⋮ → **Instalar aplicación** o **Añadir a pantalla de inicio**.
- Algunas versiones de Android mostrarán un botón «Instalar» dentro de la página.
- Sin datos reales de Last.app. Requiere una cuenta individual creada y vinculada en Supabase como rider.

Las funciones actuales son login, estado online/offline, lista de pedidos asignados, avance del estado de entrega, Google Maps si el pedido tiene coordenadas y actualización cada 5 segundos mientras la app está abierta y visible.

**La app web no realiza GPS en segundo plano, push ni navegación offline.** La instalación en pantalla de inicio no es equivalente a una app nativa firmada.

## App nativa Expo (Android / iPhone)
Código disponible en apps/rider. Para una build de pruebas:

1. Desde el proyecto local: npm install.
2. Crear apps/rider/.env.local (usar la URL Supabase y su clave publicable, NUNCA claves secretas).
3. npm run dev:rider para iniciar Metro/Expo.
4. Configurar Expo EAS con tu propia cuenta, crear una Development Build o build interna.
5. En iOS la distribución de builds instalables requiere los mecanismos de firma/distribución de Apple; Android puede generar APK con configuración EAS interna.

Aún NO se ha generado un IPA o APK ni se ha instalado una build de producción. Notificaciones push y GPS real necesitan servicios, permisos y pruebas adicionales.

## Prueba entre tres dispositivos
1. Crear/confirmar primero el admin en live.html.
2. Dar de alta dos usuarios individuales en Supabase Auth, y vincularlos a ed_members y ed_riders.
3. Iniciar admin en /live.html y abrir /rider.html en los otros dos teléfonos.
4. Asignar un pedido ficticio al Rider A: solo Rider A podrá verlo.
5. Reasignar al Rider B: Rider A dejará de verlo tras sincronizar, Rider B lo tendrá.
6. Rider B cambia asignado → recogido → en ruta → entregado.
7. Verificar que el administrador ve los mismos cambios.

No usar datos de clientes ni GPS real hasta verificar permisos y protección de datos.
