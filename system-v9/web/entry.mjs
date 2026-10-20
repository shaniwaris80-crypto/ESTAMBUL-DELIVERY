import {installMapTextGuard} from './map-guard.mjs';
installMapTextGuard(window.L,document);
await import('./app.mjs');
