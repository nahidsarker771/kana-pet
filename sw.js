/* KanaPet service worker — offline web app + notification display. */
'use strict';
var CACHE = 'kanapet-v1.22';
var CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'css/fonts.css', 'css/style.css', 'css/charts.css',
  'js/n5words.js', 'js/data.js', 'js/i18n.js', 'js/translations_words.js',
  'js/translations_bn.js', 'js/charts.js', 'js/pet.js', 'js/app.js',
  'js/reminders.js', 'js/onboard.js',
  'icons/icon-192.png', 'icons/icon-512.png',
  'fonts/baloo2-400.woff2', 'fonts/baloo2-600.woff2', 'fonts/baloo2-700.woff2', 'fonts/baloo2-800.woff2',
  'fonts/noto-sans-jp-400.woff2', 'fonts/noto-sans-jp-700.woff2',
  'fonts/noto-sans-bengali-400.woff2', 'fonts/noto-sans-bengali-700.woff2'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(CORE.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Audio clips never change: cache them on first play.
  if (/\/audio\/[^/]+\.mp3$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      });
    }));
    return;
  }
  // App shell: network-first so updates land, cache is the offline fallback.
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) { return hit || caches.match('index.html'); });
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ('focus' in list[i]) return list[i].focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});
