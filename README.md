# Estambul Delivery — base de reconstrucción Last.app

Esta rama contiene la limpieza del repositorio para construir el siguiente sistema. No contiene una nueva aplicación publicada ni un servidor de staging desplegado.

## Estado de esta fase

- Trabajo aislado en `rebuild/staging-first`; no fusionar ni desplegar a producción en esta fase.
- Retirados de esta rama el Back Office antiguo, Rider App, seguimiento web, demos, prototipos, recursos visuales y scripts de la aplicación anterior.
- Retiradas de esta rama las funciones `ed-rider-accept-sms` y `ed-send-notifications`, junto con los scripts antiguos de Twilio y los workflows anteriores.
- Conservados SIN cambiar su contenido `ed-last-webhook` y `ed-last-auto-sync`.
- Conservadas SIN cambios las 23 migraciones SQL históricas (001–023). Son dependencias heredadas compartidas; no constituyen un esquema nuevo independiente de Last.app.
- No se han modificado con esta limpieza bases de datos, cuentas, secretos, URL de webhook, integraciones externas ni funciones ya desplegadas. Eliminar código del repositorio no desactiva servicios externos existentes.

## Contenido conservado

```
supabase/functions/ed-last-webhook/index.ts
supabase/functions/ed-last-auto-sync/index.ts
supabase/migrations/                 # historial SQL íntegro; no ejecutar a ciegas
docs/LAST_APP_INTEGRATION.md         # documento histórico, no contrato verificado actual
docs/CLEANUP.md                     # alcance, dependencias y pendientes
integrations/lastapp/preservation-lock.json
scripts/verify_lastapp_preservation.py
tests/test_preservation.py
```

## Verificación sin conexión

Con Python 3.10 o superior y Git instalados:

```sh
python3 -m unittest discover -s tests -v
python3 scripts/verify_lastapp_preservation.py
```

El control compara hashes de objetos Git de los archivos de integración y del directorio completo de migraciones. No usa secretos ni hace peticiones a Last.app, Supabase o Twilio. El único workflow de esta rama ejecuta estas comprobaciones; no despliega.

Una comprobación de integridad NO verifica recepción de pedidos reales, autenticación del despliegue, entrega de SMS ni el esquema actualmente instalado en Supabase.

## Antes del sistema nuevo

Separar en staging el contrato de ingesta Last.app de las antiguas tablas operativas y probarlo con datos sintéticos. Mantener la asignación manual desde Last.app. Después construir los nuevos módulos solicitados sin recuperar por accidente la aplicación eliminada. No ejecutar las migraciones históricas sobre producción ni presentar esta base como una aplicación terminada.
