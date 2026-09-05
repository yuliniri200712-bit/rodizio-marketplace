/* =========================================================
   APP DE DOMICILIARIOS — punto de entrada
   =========================================================
   Página aparte del panel y de la app de clientes (no comparte
   estado con ninguna). Cualquiera puede crear una cuenta aquí con
   correo y contraseña, pero solo entra quien el dueño haya
   habilitado a mano en drivers/{uid}/access — igual que admins/{uid}
   en el panel, nunca se auto-otorga acceso desde la app.

   Qué hace en la vida real:
   - Ve solo los pedidos que el panel le asignó a ÉL (nunca los de
     otro domiciliario).
   - Al marcar "Recogí el pedido" empieza a mandar su ubicación en
     vivo (para que el cliente la vea en la app de Marketplace) hasta
     que marca "Entregado".
   - Recibe un aviso sonoro/visual cuando le llega una asignación
     nueva mientras tiene la app abierta, y (si se despliega la Cloud
     Function) una notificación push aunque la tenga cerrada.
   ========================================================= */

import { auth, db } from './firebase-config.js';
import * as authApi from './auth.js';
import * as notifications from './notifications.js';
import { logOnValueError, watchGlobalErrors } from './errors.js';
import { formatCOP } from './data.js';
import { confirmDialog, pickReasonDialog, promptNumberDialog } from './confirm.js';
import {
  ref,
  get,
  onValue,
  update,
  set,
  serverTimestamp,
  push,
  query,
  orderByChild,
  equalTo,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';

const $ = (id) => document.getElementById(id);

const SEEN_KEY = 'rodizio_driver_seen_orders';
// Cada cuánto, como mínimo, se escribe la ubicación en Firebase
// mientras el domiciliario va en camino — evita mandar una escritura
// por cada evento de GPS (puede disparar varias veces por segundo).
const LOCATION_MIN_INTERVAL_MS = 10000;
// Cuántos puntos del recorrido se guardan por pedido (los más
// recientes) — a 10s por punto, ~13 minutos de recorrido reciente.
// No es el viaje completo si dura más que eso, es a propósito para
// no dejar crecer el dato sin límite.
const TRAIL_MAX_POINTS = 80;
const HISTORY_LIMIT = 20;

const state = {
  currentUser: null,
  profile: { name: '', phone: '', available: false },
  orders: [],
  filter: 'recoger', // 'recoger' | 'camino' | 'historial'
  seenOrderIds: loadSeenOrderIds(),
  newCount: 0,
};

let unsubOrders = null;
let unsubProfile = null;
let unsubCashHistory = null;
let hasLoadedOrdersOnce = false;

// Rastreo de ubicación: UN solo watchPosition del dispositivo (es el
// mismo domiciliario, la misma moto/bici), pero la posición se manda
// a TODOS los pedidos que tenga "en camino" al mismo tiempo — así
// puede llevar dos pedidos por la misma ruta y ambos clientes (y el
// panel) ven su ubicación en vivo, no solo el primero.
let geoWatchId = null;
let lastLocationWriteAt = 0;
// orderId -> [{lat, lng, at}, …] — recorrido reciente en memoria,
// capado por TRAIL_MAX_POINTS antes de mandarlo a Firebase.
const localTrails = {};

function init() {
  watchGlobalErrors('domiciliario');
  registerServiceWorker();
  bindGateEvents();
  bindTabEvents();
  bindProfileEvents();

  authApi.onAuthChange(async (user) => {
    detachSubscriptions();
    state.currentUser = user;

    if (!user) {
      showGate('signed-out');
      return;
    }

    $('btn-driver-signout').hidden = false;

    let hasAccess = false;
    try {
      const snap = await get(ref(db, `drivers/${user.uid}/access`));
      hasAccess = snap.val() === true;
    } catch (err) {
      console.error('No se pudo verificar el acceso de domiciliario:', err);
    }

    if (!hasAccess) {
      $('driver-gate-not-driver-text').textContent =
        `La cuenta ${user.email} inició sesión pero el restaurante todavía no te habilitó como domiciliario. Avísale al dueño para que te dé acceso.`;
      showGate('not-driver');
      return;
    }

    showGate('main');
    subscribeProfile(user.uid);
    subscribeOrders(user.uid);
    subscribeCashHistory(user.uid);
    subscribeRatings(user.uid);
    updatePushButtonState();
  });
}

function detachSubscriptions() {
  if (unsubOrders) unsubOrders();
  if (unsubProfile) unsubProfile();
  if (unsubCashHistory) unsubCashHistory();
  unsubOrders = null;
  unsubProfile = null;
  unsubCashHistory = null;
  hasLoadedOrdersOnce = false;
  stopTracking();
}

/* ---------- Acceso (correo y contraseña) ---------- */
let authMode = 'signin';

function setAuthMode(mode) {
  authMode = mode;
  const isRegister = authMode === 'register';
  $('driver-auth-subtitle').textContent = isRegister
    ? 'Crea tu cuenta. Después, el dueño del restaurante debe habilitarte como domiciliario.'
    : 'Inicia sesión con tu correo y contraseña de domiciliario.';
  $('btn-driver-auth-submit').textContent = isRegister ? 'Crear cuenta' : 'Iniciar sesión';
  $('btn-driver-toggle-mode').textContent = isRegister ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate';
  $('driver-password').autocomplete = isRegister ? 'new-password' : 'current-password';
  $('btn-driver-forgot').hidden = isRegister;
  $('driver-consent-row').hidden = !isRegister;
}

function bindGateEvents() {
  $('driver-auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('driver-email').value.trim();
    const password = $('driver-password').value;
    const submitBtn = $('btn-driver-auth-submit');
    submitBtn.disabled = true;

    if (authMode === 'register' && !$('driver-consent-checkbox').checked) {
      showToast('Debes aceptar la política de tratamiento de datos para crear tu cuenta');
      submitBtn.disabled = false;
      return;
    }

    try {
      if (authMode === 'register') {
        await authApi.registerWithEmail(email, password);
        await authApi.recordConsent('domiciliario');
        await authApi.signOutUser();
        setAuthMode('signin');
        $('driver-auth-form').reset();
        showToast('Cuenta creada. Pídele al dueño que te habilite, luego inicia sesión.');
      } else {
        await authApi.signInWithEmail(email, password);
      }
    } catch (err) {
      showToast(err.message || 'No se pudo continuar');
    } finally {
      submitBtn.disabled = false;
    }
  });

  $('btn-driver-toggle-mode').addEventListener('click', () => {
    setAuthMode(authMode === 'signin' ? 'register' : 'signin');
  });

  $('btn-driver-forgot').addEventListener('click', async () => {
    const email = $('driver-email').value.trim();
    if (!email) {
      showToast('Escribe tu correo arriba primero');
      return;
    }
    try {
      await authApi.resetPassword(email);
      showToast('Te enviamos un correo para restablecer tu contraseña');
    } catch (err) {
      showToast(err.message || 'No se pudo enviar el correo');
    }
  });

  $('btn-driver-signout').addEventListener('click', async () => {
    if (!(await confirmDialog('¿Seguro que quieres cerrar sesión?'))) return;
    authApi.signOutUser();
  });
  $('btn-driver-signout-2').addEventListener('click', () => authApi.signOutUser());
}

function showGate(which) {
  $('driver-gate-signed-out').hidden = which !== 'signed-out';
  $('driver-gate-not-driver').hidden = which !== 'not-driver';
  $('driver-main').hidden = which !== 'main';
  $('btn-driver-signout').hidden = which === 'signed-out';
  if (which === 'signed-out') $('driver-auth-form').reset();
}

/* ---------- Perfil y disponibilidad ---------- */
function subscribeProfile(uid) {
  unsubProfile = onValue(
    ref(db, `drivers/${uid}`),
    (snapshot) => {
      const value = snapshot.val() || {};
      state.profile = { name: value.name || '', phone: value.phone || '', available: !!value.available };
      renderProfileForm();
    },
    logOnValueError('driver:profile')
  );
}

function renderProfileForm() {
  $('driver-name').value = state.profile.name;
  $('driver-phone').value = state.profile.phone;

  $('driver-greeting-name').textContent = state.profile.name || state.currentUser?.email || 'Domiciliario';

  const pill = $('driver-status-pill');
  pill.classList.toggle('is-available', state.profile.available);
  $('driver-status-pill-label').textContent = state.profile.available ? 'Disponible' : 'No disponible';
}

function bindProfileEvents() {
  $('btn-driver-save-profile').addEventListener('click', async () => {
    const uid = state.currentUser?.uid;
    if (!uid) return;
    try {
      await update(ref(db, `drivers/${uid}`), {
        name: $('driver-name').value.trim(),
        phone: $('driver-phone').value.trim(),
      });
      showToast('Datos guardados');
    } catch (err) {
      showToast(err.message || 'No se pudo guardar');
    }
  });

  $('driver-status-pill').addEventListener('click', async () => {
    const uid = state.currentUser?.uid;
    if (!uid) return;
    const next = !state.profile.available;
    try {
      await update(ref(db, `drivers/${uid}`), { available: next });
      showToast(next ? 'Ahora estás disponible' : 'Ya no estás disponible');
    } catch (err) {
      showToast(err.message || 'No se pudo actualizar');
    }
  });

  $('btn-driver-enable-push').addEventListener('click', handleEnablePush);

  $('btn-driver-close-shift').addEventListener('click', handleCloseShift);
}

/* ---------- Cierre de turno / rendición de efectivo ----------
   Como no hay pasarela de pago activa, todo pedido a domicilio se
   paga en efectivo contra-entrega — lo que el domiciliario debería
   tener encima es la suma de lo que ha entregado y todavía no ha
   "rendido" (order.cashSettled). Al cerrar turno, se marcan esos
   pedidos como rendidos y se guarda un registro en
   cashSettlements/{id} para que el dueño lo revise en el panel. */
function unsettledDeliveredOrders() {
  return state.orders.filter((o) => o.status === 'entregado' && !o.cashSettled);
}

function renderCashCard() {
  const pending = unsettledDeliveredOrders();
  const expected = pending.reduce((sum, o) => sum + (o.total || 0), 0);
  const summary = $('driver-cash-summary');
  const field = $('driver-cash-field');
  const btn = $('btn-driver-close-shift');

  if (pending.length === 0) {
    summary.innerHTML = 'Sin pedidos pendientes por rendir.';
    field.hidden = true;
    btn.disabled = true;
    return;
  }
  summary.innerHTML = `Debes tener en efectivo: <strong>${formatCOP(expected)}</strong> (${pending.length} pedido${pending.length === 1 ? '' : 's'} entregado${pending.length === 1 ? '' : 's'} sin rendir).`;
  field.hidden = false;
  btn.disabled = false;
}

/* Historial de cierres propios — antes solo se podía consultar
   pidiéndoselo al dueño; ahora cada domiciliario ve sus últimos
   cierres con la misma query por driverId que ya usa "orders". */
function subscribeCashHistory(uid) {
  return onValue(
    query(ref(db, 'cashSettlements'), orderByChild('driverId'), equalTo(uid)),
    (snapshot) => {
      const value = snapshot.val() || {};
      const settlements = Object.values(value).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
      renderCashHistory(settlements);
    },
    logOnValueError('driver:cashHistory')
  );
}

/* Calificaciones que los clientes le dejan al domiciliario al
   entregar (ver rateDriver en auth.js) — hasta ahora se guardaban en
   driverRatings/{orderId} pero nada las mostraba en ningún lado, ni
   siquiera al propio domiciliario. Misma query por driverId que ya
   usa cashSettlements/orders (las reglas de RTDB ya la permiten). */
function subscribeRatings(uid) {
  return onValue(
    query(ref(db, 'driverRatings'), orderByChild('driverId'), equalTo(uid)),
    (snapshot) => {
      const value = snapshot.val() || {};
      const ratings = Object.values(value);
      renderRatingSummary(ratings);
    },
    logOnValueError('driver:ratings')
  );
}

function renderRatingSummary(ratings) {
  const el = $('driver-rating-summary');
  if (!el) return;
  if (ratings.length === 0) {
    el.hidden = true;
    return;
  }
  const avg = ratings.reduce((sum, r) => sum + (r.rating || 0), 0) / ratings.length;
  el.hidden = false;
  el.textContent = `★ ${avg.toFixed(1)} · ${ratings.length} calificación${ratings.length === 1 ? '' : 'es'}`;
}

function renderCashHistory(settlements) {
  const container = $('driver-cash-history-list');
  if (!container) return;
  if (settlements.length === 0) {
    container.innerHTML = `<p class="admin-hint">Sin cierres registrados todavía.</p>`;
    return;
  }
  container.innerHTML = settlements
    .map((s) => {
      const diff = s.difference || 0;
      const diffLabel = diff === 0 ? 'cuadrado' : diff > 0 ? `${formatCOP(diff)} de más` : `${formatCOP(Math.abs(diff))} de menos`;
      const time = s.closedAt ? new Date(s.closedAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '';
      return `<div class="driver-cash-history-row">${time} — <strong>${formatCOP(s.actualCash || 0)}</strong> entregados (${diffLabel}), ${s.ordersCount || 0} pedidos</div>`;
    })
    .join('');
}

async function handleCloseShift() {
  const uid = state.currentUser?.uid;
  if (!uid) return;
  const pending = unsettledDeliveredOrders();
  if (pending.length === 0) return;
  const expected = pending.reduce((sum, o) => sum + (o.total || 0), 0);
  const actualRaw = $('driver-cash-actual').value;
  const actual = Number(actualRaw);
  if (actualRaw === '' || Number.isNaN(actual) || actual < 0) {
    showToast('Escribe cuánto efectivo vas a entregar');
    return;
  }
  const difference = actual - expected;
  const ok = await confirmDialog(
    difference === 0
      ? `Vas a rendir ${formatCOP(actual)}, exacto a lo esperado. ¿Confirmar cierre de turno?`
      : `Vas a rendir ${formatCOP(actual)} (esperado ${formatCOP(expected)}, diferencia ${formatCOP(Math.abs(difference))} ${difference > 0 ? 'de más' : 'de menos'}). ¿Confirmar cierre de turno?`,
    { confirmLabel: 'Sí, cerrar turno', cancelLabel: 'Revisar' }
  );
  if (!ok) return;

  // Mismo remate "premium" que el checkout del cliente: spinner
  // mientras confirma contra Firebase, check verde antes de limpiar
  // el formulario — este botón (a diferencia de los de la lista de
  // pedidos) se queda en pantalla después de la acción, así que el
  // check sí llega a verse completo. `renderCashCard` (llamada por la
  // suscripción en vivo a `orders` apenas confirma el cierre) solo
  // toca `disabled`, nunca el texto — por eso es seguro restaurar la
  // etiqueta original en el `finally` sin pelear contra ese repintado.
  const btn = $('btn-driver-close-shift');
  const btnLabel = btn.textContent;
  btn.classList.add('is-loading');
  try {
    const updates = {};
    pending.forEach((o) => {
      updates[`orders/${o.id}/cashSettled`] = true;
    });
    await update(ref(db), updates);
    await push(ref(db, 'cashSettlements'), {
      driverId: uid,
      driverName: state.profile.name || state.currentUser?.email || 'domiciliario',
      expectedCash: expected,
      actualCash: actual,
      difference,
      ordersCount: pending.length,
      closedAt: serverTimestamp(),
    });
    await update(ref(db, `drivers/${uid}`), { available: false });
    $('driver-cash-actual').value = '';

    btn.classList.remove('is-loading');
    btn.classList.add('is-success');
    btn.textContent = '¡Turno cerrado!';
    await new Promise((resolve) => setTimeout(resolve, 650));

    showToast('Cierre de turno guardado. ¡Buen trabajo!');
  } catch (err) {
    showToast(err.message || 'No se pudo guardar el cierre de turno');
  } finally {
    btn.classList.remove('is-loading', 'is-success');
    btn.textContent = btnLabel;
  }
}

async function updatePushButtonState() {
  const btn = $('btn-driver-enable-push');
  const label = $('btn-driver-enable-push-label');
  const supported = await notifications.isPushSupported();
  if (!supported) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  const permission = notifications.getPermissionState();
  if (permission === 'granted') {
    btn.classList.add('is-enabled');
    btn.disabled = true;
    label.textContent = 'Avisos activados';
  } else if (permission === 'denied') {
    btn.classList.remove('is-enabled');
    btn.disabled = true;
    label.textContent = 'Avisos bloqueados (actívalos desde el navegador)';
  } else {
    btn.classList.remove('is-enabled');
    btn.disabled = false;
    label.textContent = 'Activar avisos de pedidos nuevos';
  }
}

async function handleEnablePush() {
  const label = $('btn-driver-enable-push-label');
  label.textContent = 'Activando…';
  try {
    await notifications.enablePushNotifications('drivers');
    showToast('¡Avisos activados!');
  } catch (err) {
    showToast(err.message || 'No se pudieron activar los avisos');
  } finally {
    updatePushButtonState();
  }
}

/* ---------- Pedidos asignados ---------- */
function bindTabEvents() {
  document.querySelectorAll('#driver-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#driver-tabs button').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.filter = btn.dataset.filter;
      if (state.filter === 'recoger') {
        state.newCount = 0;
        updateBadge();
      }
      renderOrders();
    });
  });
}

function subscribeOrders(uid) {
  const ordersQuery = query(ref(db, 'orders'), orderByChild('driverId'), equalTo(uid));
  unsubOrders = onValue(
    ordersQuery,
    (snapshot) => {
    const value = snapshot.val() || {};
    const orders = Object.entries(value).map(([id, data]) => ({ id, ...data }));

    if (hasLoadedOrdersOnce) {
      const newOnes = orders.filter(
        (o) => !state.seenOrderIds.has(o.id) && ['recibido', 'en_cocina'].includes(o.status || 'recibido')
      );
      if (newOnes.length > 0) {
        newOnes.forEach((o) => state.seenOrderIds.add(o.id));
        saveSeenOrderIds(state.seenOrderIds);
        state.newCount += newOnes.length;
        updateBadge();
        playNewOrderSound();
        showToast(newOnes.length === 1 ? 'Te asignaron un pedido nuevo para recoger' : `Te asignaron ${newOnes.length} pedidos nuevos`);
      }
    } else {
      orders.forEach((o) => state.seenOrderIds.add(o.id));
      saveSeenOrderIds(state.seenOrderIds);
      hasLoadedOrdersOnce = true;
    }

    state.orders = orders.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    resumeTrackingIfNeeded();
    renderOrders();
    },
    logOnValueError('driver:orders')
  );
}

function activeDeliveries() {
  return state.orders.filter((o) => o.status === 'en_camino');
}

/* Si la app se cerró/recargó mientras algún pedido seguía "en
   camino", retoma el envío de ubicación solo — el domiciliario no
   tiene que presionar nada de nuevo. Si ya no queda ningún pedido en
   camino asignado a él (los entregó todos, se los reasignaron,
   etc.), apaga el rastreo del todo. */
function resumeTrackingIfNeeded() {
  const hasActive = activeDeliveries().length > 0;
  if (hasActive && geoWatchId === null) {
    startTracking();
  } else if (!hasActive && geoWatchId !== null) {
    stopTracking();
  }
}

function ordersForFilter() {
  if (state.filter === 'recoger') {
    return state.orders.filter((o) => ['recibido', 'en_cocina'].includes(o.status || 'recibido'));
  }
  if (state.filter === 'camino') {
    return state.orders.filter((o) => o.status === 'en_camino');
  }
  return state.orders
    .filter((o) => ['entregado', 'cancelado', 'no_entregado'].includes(o.status))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, HISTORY_LIMIT);
}

/* Números reales del día — no hay nada inventado, se calculan de
   los mismos pedidos que ya trae la suscripción por driverId. */
function renderQuickStats() {
  const el = $('driver-quick-stats');
  if (!el) return;

  const startToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const deliveredTodayOrders = state.orders.filter(
    (o) => o.status === 'entregado' && (o.createdAt || 0) >= startToday
  );
  const deliveredToday = deliveredTodayOrders.length;
  const pending = state.orders.filter((o) => ['recibido', 'en_cocina', 'en_camino'].includes(o.status || 'recibido')).length;
  const tipsToday = deliveredTodayOrders.reduce((sum, o) => sum + (o.tipAmount || 0), 0);

  el.innerHTML = `
    <div class="driver-quick-stat">
      <span class="driver-quick-stat-value">${deliveredToday}</span>
      <span class="driver-quick-stat-label">Entregados hoy</span>
    </div>
    <div class="driver-quick-stat">
      <span class="driver-quick-stat-value">${pending}</span>
      <span class="driver-quick-stat-label">Pendientes</span>
    </div>
    <div class="driver-quick-stat">
      <span class="driver-quick-stat-value">${formatCOP(tipsToday)}</span>
      <span class="driver-quick-stat-label">Propinas hoy</span>
    </div>
  `;
}

function updateBadge() {
  const badge = $('driver-badge-recoger');
  badge.hidden = state.newCount === 0;
  badge.textContent = state.newCount > 9 ? '9+' : String(state.newCount);
}

function renderOrders() {
  renderQuickStats();
  renderCashCard();
  const container = $('driver-orders-list');
  const orders = ordersForFilter();

  if (orders.length === 0) {
    const emptyMsg = {
      recoger: 'No tienes pedidos para recoger por ahora.',
      camino: 'No tienes ningún pedido en camino.',
      historial: 'Todavía no has entregado ningún pedido.',
    }[state.filter];
    container.innerHTML = `<p class="admin-hint">${emptyMsg}</p>`;
    return;
  }

  const multiHint =
    state.filter === 'camino' && orders.length > 1
      ? `<p class="driver-multi-hint">Llevas ${orders.length} pedidos activos por la misma ruta — tu ubicación se comparte con los ${orders.length}.</p>`
      : '';

  container.innerHTML = multiHint + orders.map((order) => renderOrderCard(order)).join('');

  container.querySelectorAll('.driver-pickup-btn').forEach((btn) => {
    btn.addEventListener('click', () => handlePickup(btn.dataset.orderId, btn));
  });
  container.querySelectorAll('.driver-deliver-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleDeliver(btn.dataset.orderId, btn));
  });
  container.querySelectorAll('.driver-fail-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleDeliveryFailed(btn.dataset.orderId, btn));
  });
  container.querySelectorAll('.driver-reject-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleRejectAssignment(btn.dataset.orderId, btn));
  });
}

function renderOrderCard(order) {
  const status = order.status || 'recibido';
  const itemsSummary = (order.items || []).map((item) => `${item.qty}× ${item.name}`).join(', ');
  const phoneDigits = (order.phone || '').replace(/[^\d+]/g, '');
  const address = order.address || 'sin dirección';
  // Si el cliente compartió su ubicación exacta al hacer el pedido
  // (botón "usar mi ubicación" en el checkout), navega directo a esas
  // coordenadas — más preciso que la dirección escrita a mano.
  const destination = order.customerLocation
    ? `${order.customerLocation.lat},${order.customerLocation.lng}`
    : address;
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
  const isTracking = status === 'en_camino' && geoWatchId !== null;
  const chip = order.scheduledFor
    ? `<span class="driver-order-chip">Programado ${new Date(order.scheduledFor).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>`
    : `<span class="driver-order-chip">${timeAgo(order.createdAt)}</span>`;

  let actionHtml = '';
  if (status === 'recibido' || status === 'en_cocina') {
    actionHtml = `
      <button type="button" class="driver-primary-btn driver-pickup-btn" data-order-id="${order.id}">Recogí el pedido — salir a domicilio</button>
      <button type="button" class="driver-secondary-btn driver-reject-btn" data-order-id="${order.id}">No puedo tomar este pedido</button>`;
  } else if (status === 'en_camino') {
    actionHtml = `
      <button type="button" class="driver-primary-btn driver-deliver-btn" data-order-id="${order.id}">Marcar como entregado</button>
      <button type="button" class="driver-secondary-btn driver-fail-btn" data-order-id="${order.id}">No se pudo entregar</button>
      ${
        isTracking
          ? `<div class="driver-tracking-indicator"><span class="driver-tracking-dot"></span> Compartiendo tu ubicación en vivo</div>`
          : `<div class="driver-tracking-indicator" style="color: var(--color-text-faint);">Activa tu ubicación para compartirla con el cliente</div>`
      }`;
  } else if (status === 'no_entregado') {
    actionHtml = `
      <span class="admin-order-chip admin-order-chip-cancelled">No se pudo entregar${order.deliveryFailureReason ? ' — ' + escapeHtml(order.deliveryFailureReason) : ''}</span>`;
  } else {
    const label = status === 'entregado' ? 'Entregado' : 'Cancelado';
    actionHtml = `<span class="admin-order-chip${status === 'cancelado' ? ' admin-order-chip-cancelled' : ''}">${label}</span>`;
  }

  return `
    <div class="driver-order${isTracking ? ' is-tracking' : ''}">
      ${chip}
      <div class="driver-order-top">
        <span class="driver-order-customer">${escapeHtml(order.customerName || 'Cliente')}</span>
        <span class="price">${formatCOP(order.total || 0)}</span>
      </div>
      <div class="driver-order-address">${escapeHtml(address)}${order.reference ? ' · ' + escapeHtml(order.reference) : ''}${order.customerLocation ? ' <span class="driver-precise-badge">Ubicación exacta</span>' : ''}</div>
      <div class="driver-order-items">${escapeHtml(itemsSummary)}</div>
      ${order.internalNote ? `<div class="driver-order-note">Nota del restaurante: ${escapeHtml(order.internalNote)}</div>` : ''}
      <div class="driver-order-actions">
        ${phoneDigits ? `<a class="driver-action-btn driver-call-btn" href="tel:${phoneDigits}">Llamar cliente</a>` : ''}
        <a class="driver-action-btn driver-map-btn" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Abrir en Maps</a>
      </div>
      ${actionHtml}
    </div>
  `;
}

/* ---------- Acciones sobre un pedido ---------- */
async function handlePickup(orderId, btn) {
  // Solo el spinner de carga (sin el check de éxito de "Cerrar
  // turno"/checkout del cliente) — la tarjeta cambia de pestaña y
  // desaparece de esta lista apenas confirma Firebase, así que un
  // check con su propia pausa nunca llegaría a verse completo; el
  // spinner igual evita el doble toque mientras se confirma.
  btn?.classList.add('is-loading');
  try {
    await update(ref(db, `orders/${orderId}`), { status: 'en_camino' });
    push(ref(db, `orders/${orderId}/statusHistory`), {
      status: 'en_camino',
      byEmail: state.currentUser?.email || 'domiciliario',
      at: serverTimestamp(),
    }).catch(() => {});
    const otherActive = activeDeliveries().length; // antes de que llegue el snapshot con este pedido
    showToast(
      otherActive > 0
        ? `Pedido en camino — llevas ${otherActive + 1} pedidos activos`
        : 'Pedido en camino — compartiendo tu ubicación'
    );
    startTracking();
  } catch (err) {
    showToast(err.message || 'No se pudo actualizar el pedido');
    btn?.classList.remove('is-loading');
  }
}

/* Al entregar: además de cambiar el estado, se borra driverLocation
   y driverTrail de ESE pedido — así deja de compartirse su ubicación
   con ese cliente y con el panel de inmediato, sin depender solo de
   que la UI oculte una posición vieja. Los demás pedidos que siga
   llevando el domiciliario no se ven afectados. Antes de guardar se
   pregunta si le dieron propina (opcional, un toque para saltarla). */
async function finalizeDelivery(orderId, tipAmount, btn) {
  btn?.classList.add('is-loading');
  try {
    await update(ref(db, `orders/${orderId}`), {
      status: 'entregado',
      driverLocation: null,
      driverTrail: null,
      ...(tipAmount ? { tipAmount } : {}),
    });
    push(ref(db, `orders/${orderId}/statusHistory`), {
      status: 'entregado',
      byEmail: state.currentUser?.email || 'domiciliario',
      at: serverTimestamp(),
    }).catch(() => {});
    showToast('¡Pedido entregado! Ya no compartes tu ubicación con ese cliente.');
    delete localTrails[orderId];
  } catch (err) {
    showToast(err.message || 'No se pudo actualizar el pedido');
    btn?.classList.remove('is-loading');
  }
}

async function handleDeliver(orderId, btn) {
  const tip = await promptNumberDialog('¿El cliente le dio propina? Escribe cuánto (opcional).', {
    skipLabel: 'Sin propina',
  });
  await finalizeDelivery(orderId, tip, btn);
}

const DELIVERY_FAILURE_REASONS = [
  'Cliente no contesta',
  'Dirección incorrecta o no la encontré',
  'Cliente rechazó el pedido',
  'Tuve un imprevisto y no puedo continuar (moto, accidente, etc.)',
  'Otro motivo',
];

/* Cuando de verdad no se puede entregar (cliente no contesta,
   dirección mala, etc.) — un estado aparte de "entregado" y de
   "cancelado" (ese lo cancela el cliente antes de que salga a
   la calle), para que el panel sepa que el pedido ya salió, no
   llegó a su destino, y necesita decidir qué hacer (reintentar
   con otro domiciliario, reembolsar, etc.). Igual que al
   entregar, se deja de compartir la ubicación de inmediato. */
async function handleDeliveryFailed(orderId, btn) {
  const reason = await pickReasonDialog('¿Por qué no se pudo entregar este pedido?', DELIVERY_FAILURE_REASONS);
  if (!reason) return;
  btn?.classList.add('is-loading');
  try {
    await update(ref(db, `orders/${orderId}`), {
      status: 'no_entregado',
      driverLocation: null,
      driverTrail: null,
      deliveryFailureReason: reason,
      deliveryFailureAt: serverTimestamp(),
    });
    push(ref(db, `orders/${orderId}/statusHistory`), {
      status: 'no_entregado',
      byEmail: state.currentUser?.email || 'domiciliario',
      at: serverTimestamp(),
      note: reason,
    }).catch(() => {});
    showToast('Pedido marcado como no entregado — el panel decide qué sigue.');
    delete localTrails[orderId];
  } catch (err) {
    showToast(err.message || 'No se pudo actualizar el pedido');
    btn?.classList.remove('is-loading');
  }
}

/* El domiciliario devuelve una asignación que no puede tomar (le
   queda muy lejos, ya lleva demasiados pedidos, se le dañó la
   moto, etc.) — se desasigna el pedido (vuelve a "Sin asignar" en
   el panel) en vez de quedar atascado esperando a que alguien más
   se dé cuenta. Se deja un rastro en statusHistory con el motivo,
   para que el panel entienda por qué volvió a aparecer sin
   domiciliario. */
async function handleRejectAssignment(orderId, btn) {
  const ok = await confirmDialog('¿Devolver este pedido para que el panel lo asigne a otro domiciliario?', {
    confirmLabel: 'Sí, devolver',
    cancelLabel: 'Seguir con él',
  });
  if (!ok) return;
  btn?.classList.add('is-loading');
  try {
    const driverLabel = state.profile.name || state.currentUser?.email || 'domiciliario';
    await update(ref(db, `orders/${orderId}`), { driverId: null, driverName: null, driverPhone: null });
    push(ref(db, `orders/${orderId}/statusHistory`), {
      status: (state.orders.find((o) => o.id === orderId) || {}).status || 'recibido',
      byEmail: state.currentUser?.email || 'domiciliario',
      at: serverTimestamp(),
      note: `${driverLabel} devolvió la asignación`,
    }).catch(() => {});
    showToast('Pedido devuelto — ya no aparece en tu lista.');
  } catch (err) {
    showToast(err.message || 'No se pudo actualizar el pedido');
    btn?.classList.remove('is-loading');
  }
}

/* ---------- Rastreo de ubicación en vivo ---------- */
/* Un solo watchPosition para todo el dispositivo — en cada posición
   nueva, la reparte entre TODOS los pedidos que sigan "en camino" en
   ese momento (se relee state.orders, no una lista fija), y va
   acumulando el recorrido de cada uno por separado. Así, si el
   domiciliario lleva dos pedidos por la misma ruta, ambos clientes
   (y el panel) ven la posición y el recorrido actualizarse juntos. */
function startTracking() {
  if (geoWatchId !== null) return; // ya está corriendo

  if (!navigator.geolocation) {
    showToast('Tu navegador no soporta compartir ubicación');
    return;
  }

  lastLocationWriteAt = 0;
  geoWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const now = Date.now();
      if (now - lastLocationWriteAt < LOCATION_MIN_INTERVAL_MS) return;
      lastLocationWriteAt = now;
      const { latitude, longitude } = position.coords;
      const point = { lat: latitude, lng: longitude, at: now };

      activeDeliveries().forEach((order) => {
        const trail = localTrails[order.id] || (localTrails[order.id] = []);
        trail.push(point);
        if (trail.length > TRAIL_MAX_POINTS) trail.splice(0, trail.length - TRAIL_MAX_POINTS);

        update(ref(db, `orders/${order.id}`), {
          driverLocation: { lat: latitude, lng: longitude, updatedAt: serverTimestamp() },
          driverTrail: trail,
        }).catch(() => {});
      });
    },
    () => {
      showToast('No pudimos acceder a tu ubicación — actívala para que el cliente pueda seguir el pedido');
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
  renderOrders();
}

function stopTracking() {
  if (geoWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId);
  }
  geoWatchId = null;
}

/* ---------- Aviso de pedido nuevo asignado ---------- */
function loadSeenOrderIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveSeenOrderIds(ids) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage no disponible: no rompe la app, solo no recuerda.
  }
}

function playNewOrderSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const beep = (freq, startDelay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = ctx.currentTime + startDelay;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.35);
    };
    beep(880, 0);
    beep(1046, 0.18);
  } catch {
    // Sin soporte de Web Audio o bloqueado por el navegador: silencioso.
  }
}

/* ---------- PWA: instalar la app de domiciliarios aparte ---------- */
/* Mismo service worker de siempre (sw.js, scope raíz) — se registra
   también desde aquí (no basta con que otra página ya lo haya hecho)
   para que esta página en concreto sea instalable, junto con
   manifest-driver.json enlazado en driver.html (su propio start_url,
   para que abra esta app y no el menú de clientes ni el panel). */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('No se pudo registrar el service worker:', err);
      });
    });
  }
}

/* ---------- Utilidades ---------- */
function timeAgo(ms) {
  if (!ms) return '';
  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (diffMin < 1) return 'justo ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `hace ${h}h ${m}min`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function showToast(message) {
  const toast = $('driver-toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('is-visible'), 2500);
}

init();
