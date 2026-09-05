/* =========================================================
   CARRITO
   =========================================================
   Estado del carrito en memoria + localStorage, con un
   patrón pub/sub sencillo para que la UI se repinte sola
   cada vez que el carrito cambia.
   ========================================================= */

const STORAGE_KEY = 'rodizio-cucuta-cart';

let items = loadFromStorage();
const listeners = new Set();

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function notify() {
  persist();
  listeners.forEach((fn) => fn(getState()));
}

export function onCartChange(fn) {
  listeners.add(fn);
  fn(getState()); // entrega el estado actual de inmediato
  return () => listeners.delete(fn);
}

export function getState() {
  const count = items.reduce((sum, i) => sum + i.qty, 0);
  const subtotal = items.reduce((sum, i) => sum + i.qty * i.price, 0);
  return { items: [...items], count, subtotal };
}

export function addItem(product, qty = 1, notes = '') {
  const existing = items.find((i) => i.id === product.id && i.notes === notes);
  if (existing) {
    existing.qty += qty;
  } else {
    items.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      qty,
      notes,
    });
  }
  notify();
}

export function updateQty(id, notes, qty) {
  const item = items.find((i) => i.id === id && i.notes === notes);
  if (!item) return;
  item.qty = Math.max(0, qty);
  items = items.filter((i) => i.qty > 0);
  notify();
}

export function removeItem(id, notes) {
  items = items.filter((i) => !(i.id === id && i.notes === notes));
  notify();
}

export function clearCart() {
  items = [];
  notify();
}
