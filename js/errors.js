/* =========================================================
   REGISTRO DE ERRORES — visibilidad básica en producción
   =========================================================
   Sin esto, si algo se rompe en el navegador de un cliente o del
   panel, nadie se entera hasta que alguien se queja. Este módulo
   manda un registro liviano a Realtime Database (nodo "errorLogs")
   cada vez que ocurre un error de JS no capturado, para que el
   dueño pueda revisarlos desde el panel (pestaña Reportes).

   A propósito NO usa try/catch alrededor de cada línea del resto de
   la app — solo escucha los errores globales (window.onerror /
   unhandledrejection) más los que se le pasen a mano con
   logClientError(). Nunca debe poder romper la app por sí mismo.
   ========================================================= */

import { db } from './firebase-config.js';
import {
  ref,
  push,
  onValue,
  query,
  limitToLast,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';

export function logClientError(context, error) {
  try {
    const message = (error && error.message) || String(error || 'Error desconocido');
    const stack = error && error.stack ? String(error.stack).slice(0, 500) : '';
    push(ref(db, 'errorLogs'), {
      context,
      message: String(message).slice(0, 300),
      stack,
      url: typeof location !== 'undefined' ? location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      at: serverTimestamp(),
    }).catch(() => {});
  } catch {
    // El registro de errores nunca debe generar un error nuevo.
  }
}

/* Pantalla de respaldo (#fatal-error-banner, ver base.css) para no
   dejar la app congelada/en blanco sin explicación si un error de JS
   la rompe de verdad. Solo ante 'error' (excepciones reales) — nunca
   ante 'unhandledrejection', que en este proyecto suele ser una falla
   menor y recuperable (una petición de red que falló, un permiso de
   Firebase desactualizado) y no amerita tapar toda la pantalla. Se
   muestra una sola vez — si el elemento no existe (página vieja en
   caché de un service worker sin actualizar) simplemente no hace nada.*/
let fatalBannerShown = false;
function showFatalBanner() {
  try {
    if (fatalBannerShown) return;
    const banner = document.getElementById('fatal-error-banner');
    if (!banner) return;
    banner.hidden = false;
    fatalBannerShown = true;
  } catch {
    // Nunca debe generar un error nuevo.
  }
}

/* Se llama una vez al arrancar cada app (cliente y panel) — engancha
   los dos eventos globales que cubren la gran mayoría de errores no
   capturados: excepciones normales y promesas rechazadas sin catch. */
export function watchGlobalErrors(context) {
  window.addEventListener('error', (event) => {
    logClientError(context, event.error || event.message);
    showFatalBanner();
  });
  window.addEventListener('unhandledrejection', (event) => {
    logClientError(context, event.reason);
  });
}

/* Atajo para pasarle como tercer argumento a onValue(...) — sin esto,
   si una suscripción en vivo falla (permisos desactualizados, una
   conexión que se cae a medio camino), el error queda solo en la
   consola del navegador y nadie se entera. Con más tráfico real, ese
   tipo de fallas intermitentes se vuelven más frecuentes y más
   importantes de detectar a tiempo. */
export function logOnValueError(context) {
  return (error) => logClientError(context, error);
}

/* Solo lo usa el panel (las reglas de RTDB ya exigen ser admin para
   leer este nodo) — los últimos N errores, más reciente primero. */
export function onRecentErrors(callback, count = 30) {
  return onValue(query(ref(db, 'errorLogs'), limitToLast(count)), (snapshot) => {
    const value = snapshot.val() || {};
    const logs = Object.entries(value).map(([id, data]) => ({ id, ...data }));
    logs.sort((a, b) => (b.at || 0) - (a.at || 0));
    callback(logs);
  });
}
