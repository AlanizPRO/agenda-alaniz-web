# Agenda Alaniz · versión web

Versión para la computadora de la app Agenda Alaniz. Usa la misma base de datos (Firebase) que el celular.

- Página: https://alanizpro.github.io/agenda-alaniz-web/
- Se entra con la cuenta de Google. Los datos viven en Firebase y solo los ve su dueño y las personas que él comparta (solo lectura), según `firestore.rules`.
- `config.js` tiene la configuración pública de Firebase (no es secreta).
- Se publica sola con GitHub Pages en cada cambio a `main`.
