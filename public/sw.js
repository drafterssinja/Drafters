// Service worker mínimo de Drafters (12/10). Android solo deja instalar la
// web como app si hay uno registrado con manejador de "fetch". No guarda nada
// en caché: todo va siempre a la red, para que los datos en directo sean
// siempre los actuales.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // Sin respondWith: el navegador hace la petición normal.
});
