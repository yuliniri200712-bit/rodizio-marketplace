/* =========================================================
   ANALÍTICA — Firebase Analytics
   =========================================================
   Un solo punto de entrada (track) para no repetir el manejo
   de "puede que Analytics no esté disponible" en cada archivo.
   Si falla o no está soportado, no hace nada — nunca rompe la
   experiencia del cliente por esto.
   ========================================================= */

import { analyticsReady } from './firebase-config.js';
import { logEvent } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-analytics.js';

export async function track(eventName, params) {
  try {
    const analytics = await analyticsReady;
    if (analytics) logEvent(analytics, eventName, params);
  } catch {
    // Silencioso a propósito: la analítica nunca debe romper la app.
  }
}
