# Integración con Last.app — Estambul Delivery

## Decisión de producto
**Last.app es la fuente maestra**: se crean, renombran y desactivan riders desde Last.app; las asignaciones se realizan allí. Estambul Delivery consume los datos y ofrece la app rider, rutas, GPS y back office. La app propia NO debe crear un segundo catálogo independiente en producción.

## No confirmado en la API pública
- Endpoint oficial para listar todos los riders de una tienda con ID, nombre, teléfono y estado.
- Eventos/webhooks de alta, baja, edición o reasignación de riders.
- Campo de identificador único del courier en todas las versiones/respuestas de pedidos.
- Si se exponen todas las asignaciones de Uber Eats y Just Eat cuando los reparte el propio restaurante.
- Si los cambios de estado de la app propia pueden reflejarse directamente en Uber Eats / Just Eat.

**No se implementa un conector de producción hasta obtener endpoints, permisos y un ejemplo de respuesta reales aprobados por Last.app.** Los cambios visibles en la demo son simulados y NO se transmiten a Last.app.

## Contrato objetivo (pendiente de validación)
```ts
interface LastAppRider { externalId: string; name: string; phone?: string; active: boolean; locationId: string }
interface AssignedDelivery { externalOrderId: string; externalRiderId: string | null; channel: "lastapp"|"uber"|"justeat"; deliveryAddress: string; latitude?: number; longitude?: number }
```

## Sincronización propuesta
1. Registrar integración oficial en el portal de desarrolladores de Last.app, usando su entorno de pruebas.
2. Importación inicial del catálogo de riders, asociando **ID externo**, nunca solo el nombre.
3. Consumir webhooks autorizados de pedidos/asignaciones si existen; validar origen/firma y registrar idempotencia.
4. Si falta evento de asignación, estudiar un polling moderado de endpoints aprobados y respetando límites publicados.
5. Al desactivar un rider, revocar su sesión y requerir reasignación segura de sus pedidos activos (mantener auditoría).
6. Consolidar las órdenes de tienda propia, Uber y Just Eat por IDs de fuente evitando duplicados y sin asumir equivalencia de estados entre plataformas.
7. Errores y cancelaciones deben recibir reconciliación periódica, especialmente cuando el canal de origen no sincronice cancelaciones automáticamente.

## Preguntas para integrations@last.app
- ¿Podemos listar riders propios, incluyendo ID inmutable, nombre, teléfono, estado, establecimiento y fecha de modificación?
- ¿Hay eventos fiables para crear, modificar, borrar o reasignar riders?
- ¿Qué campos devuelve v2 para el courier asignado a cada pedido, y con qué latencia?
- ¿Podemos utilizar la API con pedidos de Uber Eats y Just Eat de entrega propia que entren en LastPOS?
- ¿Cómo sincronizamos la confirmación de recogida/entrega y las cancelaciones?
- ¿Cómo se habilita una organización sandbox y cuáles son límites de rate, políticas de almacenamiento y firma de webhooks?

## URLs
- Documentación oficial: https://developers.last.app/
- Contacto oficial de integraciones: integrations@last.app

No añadir tokens ni credenciales a GitHub; usar exclusivamente variables de servidor y un gestor de secretos.
