// Service worker de Drafters (12/10). Android solo deja instalar la web como
// app si hay uno registrado con manejador de "fetch". No guarda nada en caché:
// todo va siempre a la red, para que los datos en directo sean los actuales.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // Sin respondWith: el navegador hace la petición normal.
});

// 18/10: notificaciones push (las manda /api/cron/notificaciones).
self.addEventListener('push', (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch (e) {
    datos = { titulo: 'Drafters', cuerpo: event.data ? event.data.text() : '' };
  }
  const titulo = datos.titulo || 'Drafters';
  event.waitUntil(
    // 18/10: si Drafters está abierto en pantalla, que suene el sonido propio
    // de Drafters (con la app cerrada, el móvil usa su sonido de notificación).
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      ventanas.forEach((v) => v.postMessage({ tipo: 'drafters_sonido' }));
    }).then(() => self.registration.showNotification(titulo, {
      body: datos.cuerpo || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: datos.tag || undefined,
      data: { url: datos.url || '/v2' },
    }))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/v2';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if ('focus' in v) {
          v.navigate(url);
          return v.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
