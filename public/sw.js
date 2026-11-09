'use strict';
// Uygulama kapalıyken telefon bildirimini gösterir. Bildirim içerik taşımaz (mesaj, ödev ya da not olabilir).
// Service Worker uygulamanın dil ayarını okuyamaz; dil kayıt adresinden gelir (/sw.js?lang=en).
const BODY = new URLSearchParams(self.location.search).get('lang') === 'en' ? 'You have something new' : 'Yeni bir bildirimin var';

// Dil değişince yeni sürüm, açık pencerelerin kapanmasını beklemeden devreye girsin.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Uygulama ekrandaysa sesi kendisi çalar, ayrıca bildirim gerekmez.
    if (windows.some((w) => w.visibilityState === 'visible')) return;
    await registration.showNotification('EDUCOM', {
      body: BODY,
      icon: '/icon-192.png',
      tag: 'yeni-bildirim',
      renotify: true,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.length) return windows[0].focus();
    return clients.openWindow('/');
  })());
});
