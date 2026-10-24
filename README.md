# ESTAMBUL DELIVERY — REINICIO LIMPIO

**Fecha del reinicio:** 24 de octubre de 2026.

La aplicación anterior ha sido retirada por completo de la rama `main`. Este repositorio se ha dejado con una base mínima para **reprogramar el sistema desde cero**, sin arrastrar archivos, configuraciones, dependencias ni flujos antiguos.

## Estado actual

- No existe todavía una nueva aplicación operativa.
- GitHub Pages muestra una página informativa, **no** un panel de administración, una aplicación Rider ni un seguimiento funcional.
- El repositorio no contiene claves privadas, tokens, contraseñas, conexiones activas ni datos de clientes.
- Los servicios externos (Supabase, Last.app, mensajería y cualquier app instalada en teléfonos) son independientes del código borrado y **no se han desactivado ni eliminado**. Es necesario inventariarlos antes de comenzar una nueva integración.
- No ejecutar operaciones de producción desde esta base hasta construir y validar autenticación, permisos, trazabilidad, pedidos, GPS, cobros y mensajería.

## Próxima implementación

Construir una arquitectura pequeña y comprobable, **primero en staging** y posteriormente en producción, con versiones y pruebas reales. Definir por separado:
1. Conector seguro de Last.app y asignación manual desde LastPOS.
2. Back Office con autenticación y cinco riders.
3. App Rider móvil.
4. Seguimiento privado del cliente.
5. Pruebas de pedidos, RLS, GPS, caja y envío de un único enlace.

Ninguna de estas funcionalidades debe darse por completada hasta tener implementación y pruebas que lo acrediten.

## Desarrollo

Este repositorio aún no necesita instalar dependencias. Abrir `index.html` para ver el estado de reinicio. Los enlaces antiguos (`live.html`, `rider.html`, `track.html`) dejan de formar parte de la rama `main`.

*La eliminación de archivos de una rama no elimina el historial Git ni el repositorio GitHub.*
