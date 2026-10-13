# Lista de publicación

## Sitio demo público (sin backend)
- [x] Código estático en `docs/index.html`, `demo.css` y `demo.js`.
- [x] Vista Back Office + Rider + Seguimiento con información ficticia.
- [x] PWA ligera (manifest, service worker), acceso con navegador en móvil.
- [ ] Activar GitHub Pages en Settings → Pages → Deploy from branch → main → /docs → Save.
- [ ] Confirmar URL y carga en iPhone/Android/desktop.
- [ ] Revisar el demo tras cada actualización.

## Aplicaciones de prueba
- [x] Código React Native + Expo de ejemplo en `apps/rider`.
- [ ] Ejecutar `npm install`, `npm run dev:rider`.
- [ ] Instalar Development Build para Android/iPhone.
- [ ] Prueba real de navegación Google Maps y actualizaciones de pedidos en red local.
- [ ] Configurar perfiles EAS y credenciales Apple/Google.
- [ ] APNs/FCM push, permisos y GPS en segundo plano (no implementados todavía).

## Producto operativo
- [ ] Last.app autoriza y expone listado y asignaciones de riders.
- [ ] Datos reales provienen solo de API oficial / webhooks válidos.
- [ ] Servidor y BD persistente con roles y logs.
- [ ] Seguridad RGPD y seguimiento laboral validados.
- [ ] Seguimiento individual real con expiración y permisos.
- [ ] Piloto paralelo a Shipday y lanzamiento gradual.

No etiquetar la versión como «producción» hasta superar todas las pruebas.
