# Respaldo manual gratuito antes de publicar PRO v4

**Fecha:** 18/10/2026 · **Estado:** herramientas preparadas y probadas con datos ficticios. **NO existe todavía un volcado real descargado ni una restauración verificada.** No fusionar PR #24 hasta superar ese requisito.

## Decisión
El propietario ha elegido **respaldo manual gratuito**. El entorno de Supabase está en plan Free y no tiene copias automáticas ni rama de staging. No contratar planes sin autorización adicional.

## Kit preparado
En la conversación del usuario se generó un ZIP descargable llamado `estambul_respaldo_manual_gratis.zip`, con:
- `hacer_respaldo_estambul.sh`: Supabase CLI `db dump` de roles, esquema, datos, historial de migraciones; verifica tablas y crea un archivo AES-256 con GPG.
- `verificar_respaldo_estambul.sh`: comprueba SHA256, descifrado y archivo sin escribir registros del usuario a un repositorio.
- `INSTRUCCIONES.txt`: instalación y comandos para ejecutarlo en un ordenador.

El ZIP se verificó estructuralmente y el circuito completo se probó únicamente con ficheros SQL **sintéticos**. **No** contiene contraseñas, datos personales ni copias reales.

## Comprobaciones iniciales de datos (solo totales)
- Proyecto: `wfrloqblbflltrjwdfmd` (ESTAMBUL DELIVERY), PostgreSQL 17.
- Antes del volcado, contar/confirmar: 67 pedidos, 6 usuarios de Auth, 3 cierres de caja, 7 comprobantes de intentos SMS, 38 migraciones. Las cantidades pueden aumentar con la actividad.
- Supabase Storage tiene 0 objetos en el momento de la revisión. Un volcado de PostgreSQL no incluye objetos binarios de Storage aunque aparecieran después.
- Las fuentes de Edge Functions previas están guardadas en la rama `backup/estambul-before-pro-v4-20261018`; secretos de Twilio/Last.app siguen gestionados externamente.

## Condición bloqueante para publicar
1. Ejecutar el kit desde un equipo del propietario, autenticando Supabase localmente; nunca compartir la contraseña ni ficheros SQL en el chat o GitHub.
2. Guardar el `.tar.gz.gpg` y la huella SHA256 en ubicación privada; clave de cifrado guardada por separado.
3. Validar el descifrado **y la restauración real** de las tablas de negocio, permisos, Auth y migraciones en un entorno local/aislado. Evitar que un staging real mande SMS a clientes.
4. Volver a revisar LastPOS manual, pagos, rutas y Twilio 1 SMS con teléfono autorizado antes de activar producción.
5. No reiniciar los pedidos antiguos antes de cerrar entregas y arqueos pendientes.

Guía oficial: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
