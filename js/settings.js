/* =========================================================
   CONFIGURACIÓN DEL NEGOCIO — nodo "settings" en Realtime Database
   =========================================================
   Un solo objeto con lo que el dueño puede ajustar sin tocar
   código: si está abierto, pedido mínimo a domicilio, teléfono
   de contacto, y las zonas de cobertura (con su costo de
   domicilio cada una). Lo lee toda la app; lo escribe solo el
   panel (admin.js, y solo el rol "dueno").
   ========================================================= */

import { db } from './firebase-config.js';
import { logOnValueError } from './errors.js';
import { ref, onValue, set } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';

// Valor por defecto mientras carga, o si "settings" todavía no
// existe en la base de datos — la app nunca debe romperse por
// falta de configuración.
export const DEFAULT_SETTINGS = {
  isOpen: true,
  closedMessage: 'Estamos cerrados en este momento. Vuelve a intentarlo más tarde.',
  restaurantPhone: '',
  minOrderDomicilio: 0,
  restrictToZones: false,
  defaultShippingFee: 5000,
  coverageZones: [],
  // Hora de cierre del día (formato "HH:MM", 24h) — opcional. Solo se
  // usa para avisar al cliente si falta poco para cerrar; no controla
  // "isOpen" automáticamente (eso lo sigue prendiendo/apagando el dueño
  // a mano, porque un restaurante real cierra antes por lluvia, se le
  // acaba la carne, etc.).
  closingTime: '',
};

export function onSettingsChange(callback) {
  return onValue(
    ref(db, 'settings'),
    (snapshot) => {
      const value = snapshot.val();
      callback(value ? { ...DEFAULT_SETTINGS, ...value } : { ...DEFAULT_SETTINGS });
    },
    logOnValueError('settings')
  );
}

export function saveSettings(settings) {
  return set(ref(db, 'settings'), settings);
}

/* Compara la dirección escrita por el cliente contra las palabras
   clave de cada zona (barrio, sector) — coincidencia simple de
   texto, no geolocalización real. Devuelve la primera zona que
   coincida, o null si ninguna coincide. */
export function matchZone(address, coverageZones) {
  if (!address) return null;
  const normalized = address
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return (
    (coverageZones || []).find((zone) =>
      (zone.keywords || []).some((kw) => {
        const k = kw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
        return k && normalized.includes(k);
      })
    ) || null
  );
}
