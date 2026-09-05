/* =========================================================
   CATÁLOGO — categorías y productos en Realtime Database
   =========================================================
   El menú del cliente se suscribe (onCategoriesChange /
   onProductsChange) y solo lee. Guardar/borrar lo usa
   admin.js — las reglas de Realtime Database ya exigen ser
   administrador para escribir aquí (ver firebase-config.js).
   ========================================================= */

import { db } from './firebase-config.js';
import { CATEGORIES as SEED_CATEGORIES, PRODUCTS as SEED_PRODUCTS } from './data.js';
import { logOnValueError } from './errors.js';
import {
  ref,
  onValue,
  set,
  remove,
  get,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';

export function onCategoriesChange(callback) {
  return onValue(
    ref(db, 'categories'),
    (snapshot) => {
      const value = snapshot.val() || {};
      const categories = Object.entries(value)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      callback(categories);
    },
    logOnValueError('catalog:categories')
  );
}

export function onProductsChange(callback) {
  return onValue(
    ref(db, 'products'),
    (snapshot) => {
      const value = snapshot.val() || {};
      const products = Object.entries(value).map(([id, data]) => ({ id, ...data }));
      callback(products);
    },
    logOnValueError('catalog:products')
  );
}

export async function saveCategory(category) {
  const id = category.id || slugify(category.name);
  if (!id) throw new Error('Ponle un nombre a la categoría.');
  const { id: _drop, ...data } = { ...category, id };
  await set(ref(db, `categories/${id}`), data);
  return id;
}

export function deleteCategory(id) {
  return remove(ref(db, `categories/${id}`));
}

export async function saveProduct(product) {
  const id = product.id || `${slugify(product.name)}-${Date.now().toString(36)}`;
  if (!product.name) throw new Error('Ponle un nombre al producto.');
  const { id: _drop, ...data } = { ...product, id };
  await set(ref(db, `products/${id}`), data);
  return id;
}

export function deleteProduct(id) {
  return remove(ref(db, `products/${id}`));
}

/* Copia el menú "de fábrica" (data.js) a Realtime Database,
   pero SOLO si products/ todavía está vacío — nunca pisa datos
   que ya hayan sido editados desde el panel. */
export async function seedCatalogIfEmpty() {
  const snapshot = await get(ref(db, 'products'));
  if (snapshot.exists()) return false;

  const categoriesData = {};
  SEED_CATEGORIES.forEach((cat, i) => {
    categoriesData[cat.id] = { name: cat.name, order: i };
  });

  const productsData = {};
  SEED_PRODUCTS.forEach((product) => {
    const { id, ...rest } = product;
    productsData[id] = rest;
  });

  await set(ref(db, 'categories'), categoriesData);
  await set(ref(db, 'products'), productsData);
  return true;
}

const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g');

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
