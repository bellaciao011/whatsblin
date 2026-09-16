// Service Worker - WhatsHub PWA & Push Notifications
const CACHE_NAME = 'whatshub-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/manifest.json',
  '/assets/icon-192.png',
  '/assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Clique na notificação abre o painel
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// Evento Push para notificações do sistema
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'WhatsHub Pro', body: event.data ? event.data.text() : 'Nova atividade!' };
  }

  const title = data.title || 'WhatsHub Pro';
  const options = {
    body: data.body || 'Atualização no sistema',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    vibrate: data.type === 'sale' ? [300, 100, 300, 100, 300] : [200, 100, 200],
    data: data,
    tag: data.tag || 'whatshub-notification'
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
