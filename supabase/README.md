# ESTAMBUL DELIVERY — Backend compartido v1

Código para conectar **un back office y varios móviles diferentes al mismo backend** con cuentas individuales de Supabase Auth y reglas RLS. **Sin conexión con Last.app ni GPS real** en esta etapa.

## Configuración necesaria
1. Crear proyecto nuevo en https://supabase.com/dashboard.
2. Abrir SQL Editor y ejecutar TODO el archivo \`supabase/migrations/001_delivery.sql\`.
3. Crear 3 usuarios Auth (correo y contraseña): 1 supervisor y 2 riders. En desarrollo se pueden crear desde **Authentication → Users → Add user**; usar contraseñas diferentes. No publicarlas.
4. Ejecutar el SQL de \`supabase/setup_example.sql\` **sustituyendo los tres correos de ejemplo**. Esto crea la cuenta, asigna roles y crea riders/entregas ficticias. No repetirlo: usa idempotencia por nombre de cuenta de pruebas.
5. En Supabase → Project Settings → API copiar **Project URL** y **publishable/anon key**. **NO** la service_role ni otra clave secreta.
6. Rellenar \`docs/live/config.js\` con URL y clave publicable (esta clave ES pública por diseño, gracias a RLS). Subir el archivo y esperar GitHub Pages.
7. Abrir \`https://shaniwaris80-crypto.github.io/ESTAMBUL-DELIVERY/live.html\`.
8. En app Expo añadir \`EXPO_PUBLIC_SUPABASE_URL\` y \`EXPO_PUBLIC_SUPABASE_ANON_KEY\` a \`apps/rider/.env.local\` (nunca claves secretas); ejecutar \`npm install && npm run dev:rider\`.

## Seguridad
- Todos los datos están protegidos por policies RLS; **anon no puede leer ni escribir**.
- Supervisores ven todos los pedidos de su cuenta. Riders ven solo los suyos.
- El rider únicamente puede avanzar estado: asignado → recogido → en ruta → entregado.
- Rider no puede cambiar dueño, otro rider o importe; trigger SQL valida cada operación.
- No expone datos ni GPS de clientes reales. La demo pública anterior sigue separada en \`index.html\`.
- Supabase Auth requiere cuentas provisionadas; activar MFA según operación. Deshabilitar registro público si no se necesita.
- Las credenciales de inicio de sesión van solo en formulario del usuario, no en el código.

## Prueba multi-dispositivo
- Inicia como supervisor en web A.
- Rider A inicia sesión en teléfono A, Rider B en teléfono B.
- Supervisor crea pedido ficticio y asigna a Rider A.
- Rider A lo recibe tras actualización (sondeo de pocos segundos), Rider B no lo ve.
- Supervisor reasigna el pedido a Rider B: A deja de verlo y B lo recibe.
- Rider B confirma recogida/en ruta/entregado, el supervisor ve estado.
- Desactiva un rider sin pedidos pendientes, comprueba que su acceso queda bloqueado.

La web de GitHub Pages se mantiene pública como *frontend* pero los datos remotos están protegidos por autenticación y RLS.

## Fuera del alcance de esta entrega
Integración Last.app y sincronización de su catálogo de riders requieren autorización/endpoint; notificaciones push, GPS real y segundo plano, seguimiento privado para cliente, mensajería y despliegue nativo no están activos.
