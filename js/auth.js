/* =========================================================
   AUTENTICACIÓN — inicio de sesión con Google
   =========================================================
   Envuelve Firebase Auth + Realtime Database para que el
   resto de la app solo hable con funciones simples:
   signIn(), signOutUser(), onAuthChange(), placeOrder(),
   onMyOrdersChange().
   ========================================================= */

import { auth, googleProvider, db } from './firebase-config.js';
import { logOnValueError } from './errors.js';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  ref,
  push,
  set,
  update,
  get,
  remove,
  onValue,
  query,
  orderByChild,
  equalTo,
  serverTimestamp,
  runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';

export async function signIn() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error('Error al iniciar sesión con Google:', error);
    throw mapAuthError(error);
  }
}

/* ---------- Registro de consentimiento (tratamiento de datos) ----------
   Deja constancia de que la persona aceptó la política de datos antes
   de crear su cuenta o iniciar sesión (app.js/admin.js/driver.js ya
   bloquean el botón hasta que marque la casilla — esto es la prueba
   de auditoría, no el bloqueo en sí). Nunca debe poder romper el
   flujo de login si falla: es solo un registro. */
export async function recordConsent(scope) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await set(ref(db, `consents/${user.uid}`), {
      accepted: true,
      scope,
      at: serverTimestamp(),
    });
  } catch (err) {
    console.warn('No se pudo registrar el consentimiento:', err);
  }
}

/* ---------- Correo y contraseña (panel de administración) ---------- */
export async function registerWithEmail(email, password) {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (error) {
    console.error('Error al crear la cuenta:', error);
    throw mapAuthError(error);
  }
}

export async function signInWithEmail(email, password) {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    throw mapAuthError(error);
  }
}

export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    console.error('Error al enviar el correo de recuperación:', error);
    throw mapAuthError(error);
  }
}

export function signOutUser() {
  return signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function placeOrder(order) {
  const user = auth.currentUser;
  if (!user) throw new Error('Debes iniciar sesión para confirmar el pedido.');

  const newOrderRef = push(ref(db, 'orders'));
  await set(newOrderRef, {
    uid: user.uid,
    customerName: user.displayName,
    customerEmail: user.email,
    ...order,
    scheduledFor: order.scheduledFor ? order.scheduledFor.getTime() : null,
    status: 'recibido',
    createdAt: serverTimestamp(),
  });

  // Best-effort: si el producto tiene conteo de unidades (ver panel,
  // pestaña Inventario), lo descuenta de forma atómica para evitar
  // sobrevender en horas pico con varios clientes pidiendo a la vez.
  // Nunca bloquea ni revierte el pedido si esto falla — es solo un
  // ajuste de inventario, el pedido ya quedó confirmado.
  decrementStockBestEffort(order.items || []);

  return newOrderRef.key;
}

function decrementStockBestEffort(items) {
  items.forEach((item) => {
    runTransaction(ref(db, `outOfStock/${item.id}`), (current) => {
      if (typeof current !== 'number') return current; // sin conteo: no se toca
      return Math.max(0, current - (item.qty || 1));
    }).catch(() => {
      // Las reglas de RTDB solo dejan decrecer (nunca subir ni tocar
      // "true"), así que un fallo aquí es inofensivo — en el peor
      // caso el conteo queda desactualizado hasta que el cajero lo
      // corrija a mano en el panel.
    });
  });
}

/* El cliente puede cancelar su propio pedido (lo permiten las
   reglas de RTDB porque es el dueño del pedido) — app.js solo deja
   mostrar el botón mientras el pedido sigue "recibido" y no han
   pasado más de unos minutos, para que no se pueda cancelar algo
   que la cocina ya está preparando. */
export async function cancelOrder(orderId) {
  const user = auth.currentUser;
  if (!user) throw new Error('Debes iniciar sesión.');
  await set(ref(db, `orders/${orderId}/status`), 'cancelado');
}

/* Calificar al domiciliario que entregó ESE pedido — aparte de la
   reseña de producto/pedido que ya existía. Solo una vez por pedido
   (las reglas de RTDB lo exigen). Además marca el propio pedido con
   `driverRatingSubmitted: true` para que la app sepa que ya se
   calificó sin tener que volver a leer driverRatings (el cliente ya
   tiene permiso de escribir el pedido completo, es el dueño). */
export async function rateDriver(orderId, driverId, rating) {
  const user = auth.currentUser;
  if (!user) throw new Error('Debes iniciar sesión.');
  await set(ref(db, `driverRatings/${orderId}`), {
    driverId,
    rating,
    customerName: user.displayName || 'Cliente',
    at: serverTimestamp(),
  });
  await update(ref(db, `orders/${orderId}`), { driverRatingSubmitted: true });
}

/* Se suscribe a los pedidos del usuario y llama a callback cada
   vez que cambian en Realtime Database (nuevo pedido, cambio de
   estado…). Devuelve una función para cancelar la suscripción.
   RTDB solo permite ordenar por un campo en la consulta, así
   que el orden por fecha (más reciente primero) se hace aquí. */
export function onMyOrdersChange(callback) {
  const user = auth.currentUser;
  if (!user) {
    callback([]);
    return () => {};
  }

  const ordersQuery = query(ref(db, 'orders'), orderByChild('uid'), equalTo(user.uid));
  return onValue(
    ordersQuery,
    (snapshot) => {
      const value = snapshot.val() || {};
      const orders = Object.entries(value).map(([id, data]) => ({ id, ...data }));
      orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      callback(orders);
    },
    logOnValueError('auth:myOrders')
  );
}

/* ---------- Direcciones guardadas ---------- */
export async function saveAddress({ address, reference, label }) {
  const user = auth.currentUser;
  if (!user) throw new Error('Debes iniciar sesión para guardar una dirección.');

  const newRef = push(ref(db, `users/${user.uid}/addresses`));
  await set(newRef, { address, reference: reference || '', label: label || '', createdAt: serverTimestamp() });
  return newRef.key;
}

export function onMyAddressesChange(callback) {
  const user = auth.currentUser;
  if (!user) {
    callback([]);
    return () => {};
  }
  return onValue(
    ref(db, `users/${user.uid}/addresses`),
    (snapshot) => {
      const value = snapshot.val() || {};
      const addresses = Object.entries(value)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      callback(addresses);
    },
    logOnValueError('auth:myAddresses')
  );
}

export function deleteAddress(addressId) {
  const user = auth.currentUser;
  if (!user) return Promise.resolve();
  return remove(ref(db, `users/${user.uid}/addresses/${addressId}`));
}

/* ---------- Inventario (lo escribe el panel de admin) ---------- */
/* outOfStock/{productId} ya no es solo "existe = agotado": ahora
   también puede guardar cuántas unidades quedan (número > 0), para
   que el cajero vea "quedan 3" sin tener que marcarlo agotado todavía.
   Para el cliente solo importa si de verdad está agotado: eso es
   `true` (agotado a mano) o `0` (se acabó el conteo). */
export function onOutOfStockChange(callback) {
  return onValue(
    ref(db, 'outOfStock'),
    (snapshot) => {
      const value = snapshot.val() || {};
      const outIds = Object.entries(value)
        .filter(([, v]) => v === true || v === 0)
        .map(([id]) => id);
      callback(new Set(outIds));
    },
    logOnValueError('auth:outOfStock')
  );
}

/* ---------- Clientes bloqueados ---------- */
/* Un cliente con muchas cancelaciones o pedidos no reclamados puede
   quedar marcado por el dueño (ver admin.js) — esto se revisa antes
   de dejarlo confirmar un pedido nuevo. No bloquea nada más de la
   cuenta (puede seguir viendo el menú, favoritos, etc.). */
export async function isCurrentUserBlocked() {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const snap = await get(ref(db, `customerFlags/${user.uid}`));
    const val = snap.val();
    return val && val.blocked ? val : null;
  } catch {
    return null;
  }
}

function mapAuthError(error) {
  const messages = {
    'auth/popup-closed-by-user': 'Cerraste la ventana de Google antes de terminar.',
    'auth/cancelled-popup-request': 'Ya había una ventana de inicio de sesión abierta.',
    'auth/network-request-failed': 'Revisa tu conexión a internet e intenta de nuevo.',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Inicia sesión en vez de crear una nueva.',
    'auth/invalid-email': 'Ese correo no es válido.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/missing-password': 'Escribe una contraseña.',
    'auth/user-not-found': 'No hay ninguna cuenta con ese correo.',
    'auth/wrong-password': 'Contraseña incorrecta.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/too-many-requests': 'Demasiados intentos. Espera un momento e intenta de nuevo.',
  };
  return new Error(messages[error.code] || 'No se pudo iniciar sesión. Intenta de nuevo.');
}
