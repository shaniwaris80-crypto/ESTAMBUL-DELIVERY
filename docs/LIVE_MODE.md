# ESTAMBUL DELIVERY — Prueba real entre varios dispositivos

El modo conectado comparte pedidos y asignaciones mediante **Supabase Auth + PostgREST + políticas RLS**. El frontend está alojado en GitHub Pages, pero **no** puede funcionar hasta crear y configurar el backend en Supabase.

## Activación
1. Abre https://supabase.com/dashboard y crea un proyecto de pruebas (sin pedidos reales).
2. Supabase SQL Editor → ejecuta en orden \`supabase/migrations/001_delivery.sql\`.
3. Supabase Authentication → Users → crea tres usuarios con tres correos diferentes: **responsable**, **Rider A**, **Rider B**. Usa contraseñas únicas; confirma cuentas según la configuración de Auth. No publiques aquí esos datos.
4. Supabase SQL Editor → copia \`supabase/setup_example.sql\`, sustituye los tres correos marcados por los mismos que has creado. Ejecuta una única vez (crea organización y 3 pedidos ficticios).
5. Project Settings → API: copia Project URL y la **publishable key** (o clave \`anon\` legado). Jamás la \`service_role\` o claves secretas.
6. Edita \`docs/live-config.js\` en GitHub; rellena URL y clave publicable. No cambies el nombre de las variables.
7. Abre **https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/live.html**. Entra con el correo del responsable.
8. En dos teléfonos, puedes abrir esa misma web, iniciando sesión con usuarios Rider A y Rider B. En el código nativo Android/iPhone, la pantalla «modo conectado» ya está preparada; para pruebas nativas configurar \`apps/rider/.env.local\` y crear build de desarrollo con Expo.

## Validación esperada
- Responsable puede consultar los dos riders y los pedidos ficticios.
- Si asigna TEST-1002 al Rider A, Rider A lo verá en pocos segundos; Rider B no.
- Si lo reasigna a Rider B, Rider A deja de verlo y Rider B lo recibe.
- Los riders pueden avanzar **solo el estado** de pedidos propios asignados: asignado → recogido → en ruta → entregado.
- Cambios se guardan en la misma base de datos incluso al cerrar navegador.
- Un usuario no autenticado no puede leer registros; ni un rider ver pedidos de otro.
- La actualización se hace por **sondeo de cinco segundos**, todavía no por push/websocket.
- Si el admin no puede iniciar sesión: comprobar vinculación de usuario al account desde SQL, Auth activo y claves configuradas.
- Si hay un 401: iniciar sesión de nuevo; no copiar JWT a soporte ni repositorio.

## Seguridad
GitHub Pages es público. La clave **publishable** es pública por diseño, pero la seguridad depende de las políticas SQL. **Nunca** almacenar claves de servidor ni usuarios reales en repositorios. En Supabase Settings → API verificar que esté activo RLS en las tablas \`ed_*\`. Desactivar registro público si no hace falta. Para clientes reales hace falta revisar RGPD, avisos laborales de GPS, permisos y un backend servidor para integrar Last.app de manera autorizada.

## Lo que falta
- No hay tokens/API de Last.app: los pedidos todavía son de prueba introducidos por el usuario.
- No sincroniza el catálogo de riders de Last.app: vinculación de cuentas de prueba manual.
- No está activado GPS real/segundo plano ni se envían SMS, WhatsApp o push.
- No hay app firmada/TestFlight/APK aún; el código nativo requiere compilación con Expo EAS.
- No introducir clientes reales hasta superar pruebas de seguridad y permisos.


## Activación inicial del administrador (octubre 2026)
En el proyecto Supabase vinculado a esta aplicación ya hay una **organización de reparto pendiente de activar**.
El correo del administrador autorizado está reservado **en la base de datos, no en el código público**.

1. Abre `/live.html` y rellena el correo de administrador con una **contraseña nueva, exclusiva para esta app**.
2. Pulsa **Crear mi cuenta de administrador**. Si Supabase exige validación de email, confirma el mensaje recibido. Si la confirmación abre una página `localhost`, la verificación puede haberse completado igualmente; vuelve a `/live.html`.
3. Pulsa **Entrar** en `/live.html` con tus credenciales. El servidor comprobará que el email de la sesión está verificado y, solo entonces, concederá la función de administrador.
4. No compartas contraseñas por chat ni las guardes en GitHub. Es recomendable activar MFA para el administrador cuando el proyecto salga de pruebas.

La pantalla pública **no puede activar la organización sin verificación de correo**.
Después de validar el administrador, se crearán usuarios específicos para los riders.
