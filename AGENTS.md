# Reglas de esta reconstrucción

La fase actual es limpieza del repositorio, no despliegue ni borrado de datos externos.

1. Trabajar en `rebuild/staging-first`. No modificar `main`, fusionar PR, publicar Pages ni desplegar funciones o migraciones sin una autorización posterior específica.
2. Mantener las dos funciones Last.app y su historial SQL byte a byte en esta fase. Consultar `integrations/lastapp/preservation-lock.json` y ejecutar las comprobaciones antes de cualquier cambio.
3. Conservar la integración externa Last.app: secretos, identificadores, URL del webhook y mapeos existentes. Nunca copiar credenciales a este repositorio, a logs ni a aplicaciones cliente.
4. La asignación del rider debe seguir siendo manual desde Last.app. El nombre `ed-last-auto-sync` significa sincronización, no permiso para autoasignar.
5. No enviar SMS/WhatsApp, crear pedidos reales ni borrar cuentas/datos como efecto de una prueba. Pruebas nuevas con datos sintéticos y servicios simulados.
6. El historial `supabase/migrations` contiene dependencias compartidas, triggers y funcionalidades antiguas, incluida mensajería. No considerarlo un esquema Last.app aislado ni ejecutarlo a ciegas. Separarlo exige otro cambio revisado y pruebas de base de datos en staging.
7. `docs/LAST_APP_INTEGRATION.md` es una referencia heredada. Distinguir propuestas de capacidades verificadas. No afirmar firma criptográfica, API de riders, escritura de estados o entrega de SMS sin comprobar su implementación.
8. No afirmar que una app está publicada, una prueba está superada o una integración está funcionando sin evidencia de esa operación concreta.
