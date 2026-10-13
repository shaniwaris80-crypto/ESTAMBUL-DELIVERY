# Seguridad y privacidad — requisitos antes de producción

**Este código es de demostración, NO apto para datos de clientes ni geolocalización laboral real.**

1. **Autorización y finalidad.** Verificar condiciones de Last.app, contratos con proveedores y disponibilidad de API para integración. Nunca utilizar robots, scraping o credenciales embebidas en el móvil.
2. **GPS de empleados (España).** Evaluar base legal y proporcionalidad, cumplir RGPD y art. 90 LOPDGDD, información previa clara a trabajadores y representantes cuando corresponda. Tracking solo durante turno/reparto; controles y registro auditable de quién accede y cuándo.
3. **Mínima información.** No enviar teléfono del rider al cliente. El enlace de tracking debe permitir ver solo su entrega, no la lista de pedidos.
4. **Tokens de tracking.** Aleatorios y largos, guardados por hash en servidor, expiran tras la entrega, revocables y restringidos por tiempo; no poner IDs secuenciales públicos.
5. **Autenticación y roles.** Login individual y MFA para responsables; autorización de acceso a datos por rider, establecimiento y empresa; no confiar en riderId enviado por cliente.
6. **Almacenamiento.** Base de datos persistente con aislamiento multiempresa, cifrado en tránsito, retención corta de ubicación exacta y backups protegidos.
7. **Secretos.** En el backend/secret manager, nunca en GitHub ni EXPO_PUBLIC_* ni localStorage. GitHub Pages únicamente con datos DEMO.
8. **Proveedores.** Revisión de acuerdos de encargado de tratamiento con hosting, mapas, notificaciones y mensajes; transferencias internacionales si proceden.
9. **Solicitudes.** Política de privacidad, ejercicio de derechos, incidencias y control de acceso a la ubicación.
10. **Validación.** Evaluación de riesgos y, si es necesaria, evaluación de impacto previa con asesoría de privacidad y laboral.

Para testing, los nombres de clientes son ficticios (Cliente A, etc.), las coordenadas son posiciones de ejemplo y nunca se rastrean trabajadores reales.
