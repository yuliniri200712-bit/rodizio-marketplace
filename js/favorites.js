/* =========================================================
   FAVORITOS
   =========================================================
   Igual que cart.js: estado en memoria + localStorage con
   patrón pub/sub. No requiere sesión iniciada: un favorito
   es una preferencia del dispositivo, no del pedido.
   ========================================================= */

const STORAGE_KEY = 'rodizio-cucuta-favorites';

let ids = loadFromStorage();
const listeners = new Set();

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

function notify() {
  persist();
  listeners.forEach((fn) => fn(new Set(ids)));
}

export function onFavoritesChange(fn) {
  listeners.add(fn);
  fn(new Set(ids));
  return () => listeners.delete(fn);
}

export function getFavoriteIds() {
  return new Set(ids);
}

export function isFavorite(id) {
  return ids.has(id);
}

export function toggleFavorite(id) {
  if (ids.has(id)) {
    ids.delete(id);
  } else {
    ids.add(id);
  }
  notify();
}
