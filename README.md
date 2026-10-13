# ESTAMBUL DELIVERY 🚴

Aplicación propia para repartidores de restaurante: **Android/iPhone instalable**, **back office con mapa**, y futura integración oficial autorizada con **Last.app**.

> **ESTADO: DEMO v0.1**. Todas las personas, ubicaciones y pedidos son ficticios; no existen sesiones seguras, asignación de Last.app activa, GPS real en segundo plano ni notificaciones push. No sirve todavía para producción ni debe reemplazar Shipday.

## Qué puedes probar ya
- Back office responsive en español con mapa de Burgos (OpenStreetMap), pines de riders y pedidos, y rutas simuladas.
- Filtrar por canales Last.app / Uber Eats / Just Eat y por rider.
- Asignar y reasignar pedidos, cambiar estados y consultar conteos en tiempo real simulado (refresco cada 5 s).
- Dar de alta/desactivar riders demo (imitación del catálogo de Last.app).
- Simular movimiento de un rider y restablecer todos los datos de prueba.
- App Expo para Android/iPhone: elegir rider **ficticio**, ver solo sus pedidos asignados, abrir Google Maps y actualizar estado de entrega.

## Estructura
```
apps/
  backoffice/  # Next.js + API local demo + mapa Leaflet
  rider/       # React Native / Expo
packages/
  shared/      # Tipos y seed de datos ficticios
docs/
  LAST_APP_INTEGRATION.md
  SECURITY_PRIVACY.md
  TEST_PLAN.md
```

## Instalar y ejecutar
Necesitas **Node.js 20+** y una red de desarrollo. En la raíz del proyecto:

```bash
npm install
npm run dev:backoffice
```

En tu ordenador abre http://localhost:3000. En otra terminal:

```bash
# Copia apps/rider/.env.example a apps/rider/.env y pon la IP LAN de tu ordenador.
npm run dev:rider
```

Escanea el QR de Expo en Android/iPhone con Expo Go (en desarrollo). El ordenador y el teléfono tienen que estar en la misma Wi-Fi, y el puerto 3000 debe ser accesible desde el teléfono. **Desde un teléfono físico, localhost no apunta al ordenador.**

Al elegir Rider A en la app verás sus pedidos; desde el back office puedes cambiar ED-1004 de sin asignar a Rider A, y aparecerá en su app en aproximadamente cinco segundos. Para instalar una versión propia con notificaciones nativas y GPS de segundo plano se necesitan development builds, configuración y pruebas en dispositivos reales.

## Limitaciones importantes
- El estado de la demo es **volátil** y se reinicia al reiniciar Next.js. No hay persistencia real ni autenticación.
- No habilitar `ENABLE_DEMO_API=true` en ningún despliegue público; en desarrollo local funciona automáticamente.
- No hay integración de Last.app en esta versión: las altas, bajas y asignaciones hechas en back office son **simuladas**.
- Las direcciones y coordenadas son ficticias y las rutas del mapa son líneas, NO optimización de ruta real.
- Se requiere obtener de Last.app acceso autorizado al catálogo de riders (ID/nombre/teléfono), cambios y asignaciones de pedidos para sincronizar automáticamente.

## Documentación
- [Integración y dudas abiertas de Last.app](docs/LAST_APP_INTEGRATION.md)
- [Seguridad y privacidad](docs/SECURITY_PRIVACY.md)
- [Plan de pruebas completo](docs/TEST_PLAN.md)

## Seguridad de GitHub
**No subir secretos, datos reales o credenciales.** El repositorio está actualmente configurado como público; recomendamos cambiarlo a **privado** en Settings → General → Danger Zone → Change repository visibility antes de trabajar con información sensible.

## Hoja de ruta
1. Validar demo local en ambos móviles y en back office.
2. Obtener sandbox y permisos para sincronizar rider IDs, altas/bajas y asignaciones reales desde Last.app.
3. Añadir almacenamiento persistente, autenticación por rol y backend seguro.
4. GPS durante turno, push nativo, geocercas opcionales, auditoría y enlaces de seguimiento seguros.
5. Prueba piloto paralela a Shipday antes de reemplazarlo.
