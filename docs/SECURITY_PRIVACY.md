# Privacidad, seguridad y condiciones para el piloto

> Documento técnico orientativo, **no asesoramiento jurídico definitivo**. Antes de usar datos reales, revisar la política y contratos con asesoría y las condiciones vigentes de proveedores.

## Estado actual
- Sin autenticación: el rider elige una identidad **ficticia**. No es seguro para empleados reales.
- API `/api/demo` sin autenticación, solo para entorno local, con datos de prueba.
- Sin acceso a GPS del dispositivo, sin seguimiento personal ni ubicación del cliente real.
- Sin credenciales de Last.app ni de Google Maps; tiles de OpenStreetMap solo en la demo.
- No desplegar la API de demo de forma pública con `ENABLE_DEMO_API=true`.

## Requisitos antes de producción
1. Autenticación personal por rider y administrador; roles, control de acceso por establecimiento y caducidad/revocación de sesiones.
2. Un administrador solamente puede consultar pedidos de su(s) restaurante(s). Rider solo los pedidos que tiene asignados.
3. HTTPS, separación de secretos, registro de eventos, backups y protección contra abuso.
4. Guardar un registro mínimo de pedidos y ubicación y eliminarlo según una política justificada; no guardar localización fuera de turno.
5. Información previa por escrito a los trabajadores sobre GPS y finalidades conforme al art. 90 de la LOPDGDD y al RGPD; garantizar ejercicio de derechos.
6. Usar ubicación en segundo plano solo para repartos activos, con indicadores de seguimiento claros, permisos adecuados y controles de pausa/fin de turno.
7. Enlaces de seguimiento con tokens aleatorios, caducidad breve, acceso por pedido, posibilidad de revocación y sin datos de otros clientes.
8. Revisar DPA/contratos de encargado de tratamiento y transferencias internacionales con hosting, mapas, mensajería y Last.app, cuando proceda.
9. Evaluar proporcionalidad y necesidad de una EIPD por seguimiento sistemático según el riesgo; llevar registro de actividades de tratamiento.
10. Validar términos y licencias para mapas, notificaciones, tiendas Android/iOS, Uber Eats y Just Eat, y no usar APIs no autorizadas.

## Importante
La promesa de 'GPS con móvil bloqueado' está sujeta a permisos, batería, política de Android/iOS y configuración nativa. Requiere ensayos con dispositivos reales. La versión demo no ofrece ese servicio.
