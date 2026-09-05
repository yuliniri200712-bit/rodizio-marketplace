/* =========================================================
   NOTIFICACIONES PUSH — Firebase Cloud Messaging
   =========================================================
   Pide permiso al usuario, obtiene su token de este
   dispositivo/navegador y lo guarda en Realtime Database bajo
   su propio uid. Quien realmente ENVÍA la notificación cuando
   cambia el estado de un pedido es la Cloud Function en
   functions/index.js (ver ese archivo para desplegarla).
   ========================================================= */

import { auth, db, firebaseApp, VAPID_KEY } from './firebase-config.js';
import { ref, set, remove } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js';

export async function isPushSupported() {
  return (
    'Notification' in window &&
    'serviceWorker' in navigator &&
    (await isSupported().catch(() => false))
  );
}

export function getPermissionState() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

/* Pide permiso (si hace falta), obtiene el token FCM de este
   navegador y lo guarda en {scope}/{uid}/fcmTokens/{token} —
   `scope` es "users" para la app de clientes o "drivers" para la
   app de domiciliarios (driver.js), así cada Cloud Function puede
   avisarle solo a quien de verdad le corresponde.
   Lanza un Error con mensaje legible si algo falla. */
export async function enablePushNotifications(scope = 'users') {
  const user = auth.currentUser;
  if (!user) throw new Error('Debes iniciar sesión para activar notificaciones.');

  if (!(await isPushSupported())) {
    throw new Error('Este navegador no soporta notificaciones push.');
  }

  if (!VAPID_KEY || VAPID_KEY === 'TU_VAPID_KEY') {
    throw new Error('Falta configurar la clave VAPID en firebase-config.js.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('No diste permiso para recibir notificaciones.');
  }

  const registration = await navigator.serviceWorker.ready;
  const messaging = getMessaging(firebaseApp);
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  });

  if (!token) throw new Error('No se pudo generar el token de notificaciones.');

  await set(ref(db, `${scope}/${user.uid}/fcmTokens/${cleanKey(token)}`), true);
  return token;
}

/* Deja de guardar el token de este navegador (no revoca el
   permiso del navegador, eso el usuario lo controla desde su
   configuración). */
export async function disablePushNotifications(token, scope = 'users') {
  const user = auth.currentUser;
  if (!user || !token) return;
  await remove(ref(db, `${scope}/${user.uid}/fcmTokens/${cleanKey(token)}`));
}

/* Notificaciones que llegan mientras la app está ABIERTA y en
   primer plano (las que llegan en segundo plano las maneja
   sw.js directamente). */
export function onForegroundMessage(callback) {
  const messaging = getMessaging(firebaseApp);
  return onMessage(messaging, callback);
}

// Los tokens FCM pueden traer '.', '#', '$', '[' o ']', que
// Realtime Database no permite como parte de una key.
function cleanKey(token) {
  return token.replace(/[.#$/[\]]/g, '_');
}
