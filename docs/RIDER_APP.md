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


## Activación de cuentas Rider preautorizadas

Los correos de los repartidores autorizados se guardan **únicamente en la tabla privada de invitaciones** de Supabase. No se guardan correos de invitados ni contraseñas en GitHub.

Cada repartidor debe:
1. Abrir la App Rider web en su móvil.
2. Introducir su propio correo autorizado y elegir una contraseña nueva de al menos 8 caracteres.
3. Pulsar **Crear cuenta Rider**.
4. Abrir el correo de confirmación enviado por Supabase, completar la verificación y volver a la app.
5. Pulsar **Iniciar sesión**. Una función protegida comprueba en Supabase que el email verificado coincide con una invitación privada y vincula únicamente esa ficha Rider.
6. Repetir para el otro rider, utilizando **un correo y contraseña distintos**.

Si el mensaje de confirmación abre una dirección de localhost, el administrador debe registrar la dirección pública de Rider como URL permitida en **Supabase → Authentication → URL Configuration**. La URL de destino prevista es:
https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/rider.html

La invitación no envía un correo automáticamente: el email de verificación se solicita al pulsar «Crear cuenta Rider».

El backend sigue usando datos de prueba y no sincroniza aún pedidos reales de Last.app.


## Activar las dos cuentas Rider sin SMTP (método actual)

El administrador inicia sesión en https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/live.html y pulsa «Crear y activar cuentas Rider». La función de servidor crea solamente usuarios previamente autorizados por la empresa y muestra contraseñas temporales distintas una sola vez. Deben copiarse a un gestor seguro y comunicarse privadamente a cada repartidor. Los riders entran por https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/rider.html y cambian su contraseña en el primer acceso.

No se envían emails. Este procedimiento es exclusivamente para pruebas internas y considera que el administrador ha verificado previamente a los empleados. En producción hace falta un proceso de identidad y recuperación de contraseñas adecuado.


## Versión Rider con avisos sonoros y datos de cliente (octubre de 2026)

Se han incorporado estas mejoras a la App Rider web, accesible en /rider.html:

- **Sonido al asignar un nuevo pedido**, detectado durante la consulta cada 5 s. Es necesario pulsar **Activar sonido** una vez con la app abierta y comprobarlo con **Probar sonido**. Sin activar el audio por interacción del usuario los navegadores móviles pueden bloquearlo.
- Aviso visual al recibir una asignación y vibración si el dispositivo lo soporta.
- Vista completa del cliente: nombre, teléfono (si existe), dirección, indicaciones, importe y estado.
- **Google Maps** abre instrucciones de navegación usando coordenadas cuando existan y, si no, **buscando por dirección**. La dirección debe incluir calle, número y población. Las direcciones antiguas incompletas pueden requerir corrección manual.
- Historial de pedidos entregados visible por defecto: los pedidos pendientes van arriba y los completados debajo.
- En el panel de administración (/live.html) se pueden crear pedidos con teléfono, dirección e instrucciones y **editar los datos de entregas anteriores**.
- El sistema se mantiene en pruebas: no se importan clientes ni pedidos reales de Last.app porque falta integración oficial.

**Límite importante:** NO hay push en segundo plano. El sonido está pensado para la app abierta; con el móvil bloqueado, la app cerrada o el navegador suspendido, no se puede garantizar aviso sonoro. Para sustituir a Shipday hacen falta notificaciones push y compilación/distribución nativa, además de integrar Last.app.

**Prueba recomendada:** abrir Rider en el móvil con su usuario, pulsar «Activar sonido» y «Probar sonido», mantener la app visible; desde el panel crear un pedido ficticio con dirección completa y asignarlo a ese rider. La tarjeta aparecerá tras sincronizar y sonará el aviso. El botón Google Maps deberá estar disponible aunque no haya coordenadas.
