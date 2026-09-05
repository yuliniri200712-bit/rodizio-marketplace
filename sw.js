/* =========================================================
   Service Worker — cachea el "app shell" para que el menú
   abra al instante y funcione con conexión débil o sin ella.
   Los pedidos y el login SIEMPRE requieren red (Firebase).

   También recibe las notificaciones push que llegan con la
   app cerrada o en segundo plano (las que llegan con la app
   abierta las maneja notifications.js directamente).
   ========================================================= */

importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

// Mismos valores que firebase-config.js. Un service worker no
// puede importar ese módulo directamente, así que se repiten
// aquí — si cambias tu proyecto de Firebase, actualiza ambos.
firebase.initializeApp({
  apiKey: 'AIzaSyBTxf2ntMPTkYR5f45LMJC82bfexYAgtqI',
  authDomain: 'rodiziomarketplace.firebaseapp.com',
  databaseURL: 'https://rodiziomarketplace-default-rtdb.firebaseio.com',
  projectId: 'rodiziomarketplace',
  storageBucket: 'rodiziomarketplace.firebasestorage.app',
  messagingSenderId: '224063551054',
  appId: '1:224063551054:web:e8af60826b45b56a02b51f',
});

try {
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || 'Rodízio Cúcuta';
    self.registration.showNotification(title, {
      body: payload.notification?.body || '',
      icon: './icon.svg',
      badge: './icon.svg',
    });
  });
} catch (err) {
  console.warn('Firebase Messaging no se pudo inicializar en el service worker:', err);
}

const CACHE_NAME = 'rodizio-cucuta-v66';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/variables.css',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/animations.css',
  './js/firebase-config.js',
  './js/data.js',
  './js/cart.js',
  './js/auth.js',
  './js/ui.js',
  './js/app.js',
  './js/favorites.js',
  './js/notifications.js',
  './js/analytics.js',
  './js/catalog.js',
  './js/settings.js',
  './js/errors.js',
  './js/confirm.js',
  './icon.svg',
  './icon-512.png',
  './images/picanha.jpg',
  './images/ancho.jpg',
  './images/chorizo-bife.jpg',
  './images/pollo-parrilla.jpg',
  './images/alitas-bbq.jpg',
  './images/costillas.jpg',
  './images/lomo-cerdo.jpg',
  './images/chorizo-parrilla.jpg',
  './images/morcilla.jpg',
  './images/arroz-blanco.jpg',
  './images/yuca-frita.jpg',
  './images/ensalada-casa.jpg',
  './images/flan-casero.jpg',
  './images/brigadeiro.jpg',
  './images/jugo-natural.jpg',
  './images/gaseosa.jpg',
  './images/cerveza.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo interceptamos GET: los POST/PUT (login, pedidos) van directo a red.
  if (request.method !== 'GET') return;

  // La Cache API solo acepta peticiones http/https — una extensión del
  // navegador (gestor de contraseñas, bloqueador de anuncios, etc.)
  // puede disparar una petición chrome-extension:// que este listener
  // igual recibe; cachearla revienta con "Request scheme ... is
  // unsupported". Dejarla pasar sin cachear, directo a red.
  if (!request.url.startsWith('http://') && !request.url.startsWith('https://')) {
    return;
  }

  // Nunca cachear llamadas a Firebase/Google: necesitan estar siempre en vivo.
  if (request.url.includes('firebase') || request.url.includes('google')) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Promise.reject('offline y sin caché')))
  );
});
