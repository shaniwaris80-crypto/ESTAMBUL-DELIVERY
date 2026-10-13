# ESTAMBUL DELIVERY 🚴

Aplicación propia para gestionar repartidores del restaurante: **app instalable Android/iOS**, **back office web**, seguimiento GPS y futura integración autorizada con **Last.app**.

> ⚠️ Estado: prototipo inicial con datos FICTICIOS. Sin integración activa con Last.app, sin tracking real, sin clientes reales. No sustituir Shipday aún.

## Objetivos funcionales
- **Last.app como fuente maestra** de pedidos, repartidores y asignaciones, si su API lo autoriza.
- Los pedidos de canales propios, Uber Eats y Just Eat que sean **repartidos por nuestro equipo** aparecen en un panel unificado cuando Last.app suministre los datos.
- Cada rider inicia sesión en la app y únicamente recibe sus pedidos.
- Back office: lista de pedidos, estados, riders, mapa, rutas, posiciones y pendientes.
- Seguimiento de ubicación mediante enlace efímero por pedido (fase posterior).
- Comunicación, Google Maps, notificaciones y liquidación de cobros (fases posteriores).

## Arquitectura inicial
```
apps/
  backoffice/    # Next.js: panel interactivo DEMO
  rider/         # Expo React Native: app rider DEMO para Android y iPhone
packages/
  shared/        # Tipos y datos de prueba sin información personal
docs/
  LAST_APP_INTEGRATION.md
  SECURITY_PRIVACY.md
  TEST_PLAN.md
```

## Empezar
Requiere Node.js 20 o superior.

```bash
npm install
npm run dev:backoffice
# En otra terminal
npm run dev:rider
```

El panel web suele abrir en http://localhost:3000. La app del rider puede abrirse en Expo Go mientras se desarrolla; las pruebas de GPS en segundo plano y notificaciones requieren **development build** en dispositivo físico.

## Próximo hito
Validar en el portal oficial de Last.app el listado de riders (ID/teléfono), cambios de asignación, webhooks y permisos de los pedidos de Uber Eats/Just Eat. NO introducir tokens en GitHub.

## Seguridad
El repositorio no debe contener tokens de Last.app, datos de clientes ni claves privadas. Se recomienda hacerlo **privado** desde Settings → General → Danger Zone → Change repository visibility.
