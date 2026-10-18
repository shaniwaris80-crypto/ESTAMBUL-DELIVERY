# Estambul Rider PRO v3 — 5 accesos, UI premium y seguridad
Fecha: 2026-10-18. Rama aislada desde main. Sin despliegue ni cambios de usuarios en producción.

## Estado constatado de Supabase (lectura únicamente)
- Rider 1: ficha activa, vinculada a un usuario y miembro autorizado, online en el momento de consulta.
- Rider 2: ficha inactiva, sin usuario vinculado. No puede acceder todavía.
- Rider 3, 4 y 5: no existen como usuarios/fichas en la cuenta comprobada.
- Por tanto, las cinco tarjetas son capacidad de acceso y no equivalen a cinco riders activados.

## Cómo funciona
1. La pantalla web o nativa muestra botones fijos RIDER 01–05.
2. Se toca el ID. Si es primer acceso desde ese dispositivo, se introduce también el correo autorizado (una vez) y contraseña individual.
3. Supabase Auth comprueba credenciales. RLS comprueba membresía y el Rider activo asignado.
4. El cliente verifica que el nombre real del Rider coincida EXACTAMENTE con el ID seleccionado; si no, destruye la sesión recién iniciada.
5. Solo si la autenticación ha sido correcta, la PWA recuerda el correo en localStorage de ese dispositivo, y la app nativa en SecureStore. La contraseña nunca queda almacenada por el selector de perfiles.
6. En accesos posteriores: tocar RIDER 01–05, escribir la contraseña y entrar. Se puede pulsar “Usar otro correo” y borrar el identificador.
7. El botón de cerrar sesión mantiene su funcionamiento. Las cuentas se mantienen independientes, con sus propias contraseñas y permisos.

## Requisitos para 5 riders *reales*
- Preparar en el administrador cinco registros vinculados a cinco cuentas Auth individuales, autorizadas, con correo verificado.
- Usar nombres de identificación consistentes con los botones: rider1, Rider 2, Rider 3, Rider 4, Rider 5.
- Asociar cada cuenta al miembro Rider de la cuenta comercial en ed_members y ed_riders. No activar un Rider sin usuario autorizado.
- Si se usa la función de invitaciones, debe contener los correos ya aprobados y generar contraseñas temporales de un solo uso que se comuniquen de manera privada.
- No inventar correos, no reutilizar contraseñas, no compartir sesiones entre trabajadores, no hacer una lista pública de cuentas.
- Comprobar que LastPOS asigna al rider correcto con una identidad externa inequívoca, sin tocar external_rider_id sin verificar.

## Diseño
- Web Rider: nuevo acceso a cinco perfiles; mejoras de contraste, jerarquía, tarjetas de pedidos, cobros, botones grandes y foco para móvil.
- Native Rider: pantalla de bienvenida y perfiles adaptados a táctil, almacenamiento del identificador en el llavero del dispositivo.
- Back office: visualización de cinco plazas con estados reales vinculados y el mismo lenguaje visual.
- Mantiene los flujos existentes de pedidos, pagos, arqueo, GPS, chats, estados y avisos.

## Seguridad y criterios de publicación
- No editar ni desplegar SQL, Edge Functions, SMS o secretos para este cambio visual y de entrada.
- Nunca marcar como activa una ficha que no tenga rider activo Y usuario vinculado.
- Probar Rider 1 correcto y un intento de login cruzado (seleccionar Rider 2 con credenciales de Rider 1) — debe rechazarse.
- Probar error de contraseña, recuperación, primer acceso, segundo acceso, olvidar dispositivo y cierre de sesión en iOS y Android.
- Revisar contraste, lectura con VoiceOver/TalkBack, teclado y teclado de contraseña.
- Confirmar que el cálculo de caja, selección de pagos y refresco de pedidos no se altera.
- PR siempre en borrador hasta completar pruebas de cuentas de staging y visuales.
