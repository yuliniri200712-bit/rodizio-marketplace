/* =========================================================
   PANEL DE ADMINISTRACIÓN — punto de entrada
   =========================================================
   Página separada del menú de clientes. Cualquiera con correo
   y contraseña puede crear una cuenta aquí, pero solo entra al
   panel quien esté marcado como administrador en Realtime
   Database (admins/{uid}: true) — eso se agrega a mano desde
   la consola de Firebase, nunca desde la app.
   ========================================================= */

import { auth, db } from './firebase-config.js';
import * as authApi from './auth.js';
import * as catalog from './catalog.js';
import * as settingsApi from './settings.js';
import * as errors from './errors.js';
import { confirmDialog, pickReasonDialog } from './confirm.js';
import { formatCOP } from './data.js';
import {
  ref,
  get,
  onValue,
  update,
  set,
  remove,
  push,
  serverTimestamp,
  query,
  orderByKey,
  limitToLast,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';

const $ = (id) => document.getElementById(id);

const STATUS_STEPS = [
  { id: 'recibido', label: 'Recibido' },
  { id: 'en_cocina', label: 'En cocina' },
  { id: 'en_camino', label: 'En camino' },
  { id: 'entregado', label: 'Entregado' },
];

// A partir de cuántos minutos sin avanzar de estado (o sin llegar
// la hora programada) un pedido se marca como "necesita atención".
const URGENT_MINUTES = 10;
const SEEN_ORDERS_KEY = 'rodizio_admin_seen_orders';

// A partir de cuántas unidades restantes un producto se marca con
// el aviso "quedan pocas" en el panel (no lo ve el cliente).
const LOW_STOCK_THRESHOLD = 3;
const ETA_OPTIONS = [15, 30, 45, 60];

// El panel ya no carga el nodo "orders" completo de una: pide solo
// los últimos N (por llave, que en Firebase ya vienen ordenadas por
// fecha de creación) — evita que un local con meses de historial se
// vuelva lento cada vez que alguien abre el panel. "Cargar pedidos
// anteriores" en la pestaña Pedidos sube este número.
const ORDERS_PAGE_SIZE = 400;

const state = {
  statusFilter: 'todos',
  orderSearchTerm: '',
  orders: [],
  ordersLimit: ORDERS_PAGE_SIZE,
  stock: {}, // outOfStock/{productId}: true (agotado) | número (unidades restantes)
  categories: [],
  products: [],
  settings: settingsApi.DEFAULT_SETTINGS,
  blockedUids: new Set(),
  errorLogs: [],
  drivers: {}, // { uid: { name, phone, available } } — de drivers/, para el selector "Domiciliario"
  driverRatings: {}, // { uid: { sum, count } } — agregado de driverRatings/, para el promedio por domiciliario
  cashSettlements: [],
  role: 'dueno', // 'dueno' | 'cajero' — decide qué pestañas ve cada quien
  seenOrderIds: loadSeenOrderIds(),
  newOrdersCount: 0,
  // Ids que acaban de llegar en el último snapshot de Firebase, solo
  // para destacar su tarjeta con un destello (ver renderOrderCard) —
  // se vacía apenas termina la animación, no es un estado persistente.
  justArrivedOrderIds: new Set(),
};

let unsubOrders = null;
let unsubStock = null;
let unsubCategories = null;
let unsubProducts = null;
let unsubSettings = null;
let unsubCustomerFlags = null;
let unsubErrors = null;
let unsubDrivers = null;
let unsubCashSettlements = null;
let unsubDriverRatings = null;
let ordersRefreshTimer = null;
let hasLoadedOrdersOnce = false;

function init() {
  errors.watchGlobalErrors('panel');
  registerServiceWorker();
  bindGateEvents();
  bindTabEvents();
  bindStatusFilterEvents();
  bindMenuEvents();
  bindSettingsEvents();
  $('btn-export-orders-csv').addEventListener('click', exportOrdersXLSX);
  $('btn-admin-clear-errors')?.addEventListener('click', handleClearErrorLog);

  authApi.onAuthChange(async (user) => {
    detachSubscriptions();

    if (!user) {
      showGate('signed-out');
      return;
    }

    $('btn-admin-signout').hidden = false;

    let isAdmin = false;
    try {
      const snap = await get(ref(db, `admins/${user.uid}`));
      const val = snap.val();
      isAdmin = val === true || val === 'dueno' || val === 'cajero';
      state.role = val === true || val === 'dueno' ? 'dueno' : 'cajero';
    } catch (err) {
      console.error('No se pudo verificar el acceso de administrador:', err);
    }

    if (!isAdmin) {
      $('gate-not-admin-text').textContent =
        `La cuenta ${user.email} inició sesión pero no está autorizada como administradora del panel.`;
      showGate('not-admin');
      return;
    }

    applyRoleUI(state.role);
    showGate('main');
    subscribeOrders();
    subscribeStock();
    subscribeCategories();
    subscribeProducts();
    subscribeSettings();
    subscribeCustomerFlags();
    subscribeDrivers();
    if (state.role === 'dueno') {
      unsubErrors = errors.onRecentErrors((logs) => {
        state.errorLogs = logs;
        renderErrorLog();
      });
      unsubCashSettlements = subscribeCashSettlements();
      unsubDriverRatings = subscribeDriverRatings();
    }
  });
}

/* Un cajero real de un restaurante maneja pedidos e inventario del
   día a día — no debería poder borrar el menú, cambiar precios ni
   tocar la configuración del negocio. Eso queda solo para "dueno". */
function applyRoleUI(role) {
  const restrictedTabs = document.querySelectorAll('#admin-tabs button[data-role="dueno"]');
  restrictedTabs.forEach((btn) => {
    btn.hidden = role !== 'dueno';
  });
  if (role !== 'dueno') {
    const activeTab = document.querySelector('#admin-tabs button.is-active');
    if (activeTab && activeTab.dataset.role === 'dueno') {
      document.querySelector('#admin-tabs button[data-tab="pedidos"]').click();
    }
  }
}

function detachSubscriptions() {
  if (unsubOrders) unsubOrders();
  if (unsubStock) unsubStock();
  if (unsubCategories) unsubCategories();
  if (unsubProducts) unsubProducts();
  if (unsubSettings) unsubSettings();
  if (unsubCustomerFlags) unsubCustomerFlags();
  if (unsubErrors) unsubErrors();
  if (unsubDrivers) unsubDrivers();
  if (unsubCashSettlements) unsubCashSettlements();
  if (unsubDriverRatings) unsubDriverRatings();
  if (ordersRefreshTimer) clearInterval(ordersRefreshTimer);
  if (renderOrdersTimer) clearTimeout(renderOrdersTimer);
  if (renderStockTimer) clearTimeout(renderStockTimer);
  renderOrdersTimer = null;
  renderStockTimer = null;
  unsubOrders = null;
  unsubStock = null;
  unsubCategories = null;
  unsubProducts = null;
  unsubSettings = null;
  unsubCustomerFlags = null;
  unsubErrors = null;
  unsubDrivers = null;
  unsubCashSettlements = null;
  unsubDriverRatings = null;
  ordersRefreshTimer = null;
  hasLoadedOrdersOnce = false;
}

/* ---------- Acceso (correo y contraseña) ---------- */
let authMode = 'signin'; // 'signin' | 'register'

function setAuthMode(mode) {
  authMode = mode;
  const isRegister = authMode === 'register';
  $('admin-auth-subtitle').textContent = isRegister
    ? 'Crea una cuenta. Después, quien administre el proyecto debe autorizarte.'
    : 'Inicia sesión con tu correo y contraseña de administrador.';
  $('btn-admin-auth-submit').textContent = isRegister ? 'Crear cuenta' : 'Iniciar sesión';
  $('btn-admin-toggle-mode').textContent = isRegister ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate';
  $('admin-password').autocomplete = isRegister ? 'new-password' : 'current-password';
  $('btn-admin-forgot').hidden = isRegister;
  $('admin-consent-row').hidden = !isRegister;
}

function bindGateEvents() {
  $('admin-auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('admin-email').value.trim();
    const password = $('admin-password').value;
    const submitBtn = $('btn-admin-auth-submit');
    submitBtn.disabled = true;

    if (authMode === 'register' && !$('admin-consent-checkbox').checked) {
      showToast('Debes aceptar la política de tratamiento de datos para crear tu cuenta');
      submitBtn.disabled = false;
      return;
    }

    try {
      if (authMode === 'register') {
        await authApi.registerWithEmail(email, password);
        await authApi.recordConsent('panel');
        await authApi.signOutUser();
        setAuthMode('signin');
        $('admin-auth-form').reset();
        showToast('Cuenta creada. Pídele a quien administra el proyecto que te dé acceso, luego inicia sesión.');
      } else {
        await authApi.signInWithEmail(email, password);
      }
    } catch (err) {
      showToast(err.message || 'No se pudo continuar');
    } finally {
      submitBtn.disabled = false;
    }
  });

  $('btn-admin-toggle-mode').addEventListener('click', () => {
    setAuthMode(authMode === 'signin' ? 'register' : 'signin');
  });

  $('btn-admin-forgot').addEventListener('click', async () => {
    const email = $('admin-email').value.trim();
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

  $('btn-admin-signout').addEventListener('click', async () => {
    if (!(await confirmDialog('¿Seguro que quieres cerrar sesión?'))) return;
    authApi.signOutUser();
  });
  $('btn-admin-signout-2').addEventListener('click', () => authApi.signOutUser());
}

function showGate(which) {
  $('gate-signed-out').hidden = which !== 'signed-out';
  $('gate-not-admin').hidden = which !== 'not-admin';
  $('admin-main').hidden = which !== 'main';
  $('btn-admin-signout').hidden = which === 'signed-out';

  if (which === 'signed-out') {
    $('admin-auth-form').reset();
  }
}

/* ---------- Tabs ---------- */
function bindTabEvents() {
  const buttons = document.querySelectorAll('#admin-tabs button');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const tab = btn.dataset.tab;
      $('tab-pedidos').hidden = tab !== 'pedidos';
      $('tab-inventario').hidden = tab !== 'inventario';
      $('tab-menu').hidden = tab !== 'menu';
      $('tab-domiciliarios').hidden = tab !== 'domiciliarios';
      $('tab-reportes').hidden = tab !== 'reportes';
      $('tab-config').hidden = tab !== 'config';

      if (tab === 'pedidos' && state.newOrdersCount > 0) {
        state.newOrdersCount = 0;
        updatePedidosBadge();
      }
      if (tab === 'domiciliarios') {
        renderCashSettlementsList();
      }
      if (tab === 'reportes') {
        renderReports();
      }
      if (tab === 'config') {
        renderErrorLog();
      }
    });
  });
}

/* ---------- Pedidos ---------- */
function bindStatusFilterEvents() {
  const buttons = document.querySelectorAll('#admin-status-filter button');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.statusFilter = btn.dataset.filter;
      renderOrders();
    });
  });

  $('admin-order-search')?.addEventListener('input', (e) => {
    state.orderSearchTerm = e.target.value;
    renderOrders();
  });
}

function subscribeOrders() {
  if (unsubOrders) unsubOrders();
  const ordersQuery = query(ref(db, 'orders'), orderByKey(), limitToLast(state.ordersLimit));
  unsubOrders = onValue(
    ordersQuery,
    (snapshot) => {
    const value = snapshot.val() || {};
    const orders = Object.entries(value).map(([id, data]) => ({ id, ...data }));
    state.ordersMaybeMore = orders.length >= state.ordersLimit;
    state.orders = sortOrdersForQueue(orders);

    if (hasLoadedOrdersOnce) {
      const newOnes = orders.filter((o) => !state.seenOrderIds.has(o.id));
      if (newOnes.length > 0) {
        newOnes.forEach((o) => {
          state.seenOrderIds.add(o.id);
          state.justArrivedOrderIds.add(o.id);
        });
        saveSeenOrderIds(state.seenOrderIds);
        state.newOrdersCount += newOnes.length;
        updatePedidosBadge();
        playNewOrderSound();
        showToast(
          newOnes.length === 1
            ? `Nuevo pedido de ${newOnes[0].customerName || 'un cliente'}`
            : `${newOnes.length} pedidos nuevos`
        );
        // El destello (ver renderOrderCard/.is-new-order en
        // animations.css) solo tiene sentido en el primer repintado
        // tras llegar — se limpia después para que un repintado
        // posterior (otro cajero, un cambio de estado cualquiera) no
        // vuelva a destacar la misma tarjeta sin que de verdad haya
        // llegado un pedido nuevo.
        setTimeout(() => {
          newOnes.forEach((o) => state.justArrivedOrderIds.delete(o.id));
        }, 2000);
      }
    } else {
      orders.forEach((o) => state.seenOrderIds.add(o.id));
      saveSeenOrderIds(state.seenOrderIds);
      hasLoadedOrdersOnce = true;
    }

    scheduleRenderOrders();
    },
    errors.logOnValueError('admin:orders')
  );

  // Refresca "hace X min" y el resaltado de urgentes aunque no
  // llegue ningún cambio nuevo de Firebase.
  if (ordersRefreshTimer) clearInterval(ordersRefreshTimer);
  ordersRefreshTimer = setInterval(renderOrders, 45000);
}

/* En un turno pesado, varios domiciliarios mandan su ubicación cada
   pocos segundos y varios cajeros cambian estados a la vez — cada
   una de esas escrituras dispara un snapshot nuevo de "orders"
   completo. Sin agrupar, la lista se reconstruye varias veces por
   segundo (parpadeo, gasto de CPU, y le borra a alguien lo que
   estaba escribiendo en una nota). Se agrupan ráfagas cercanas en un
   solo repintado. */
let renderOrdersTimer = null;
function scheduleRenderOrders() {
  if (renderOrdersTimer) return;
  renderOrdersTimer = setTimeout(() => {
    renderOrdersTimer = null;
    renderOrders();
  }, 400);
}

/* Los pedidos que todavía necesitan trabajo (no entregados) van
   primero, del más viejo al más nuevo (el que lleva más tiempo
   esperando queda arriba, listo para atenderse). Los entregados
   quedan abajo, más reciente primero, solo como referencia. */
function sortOrdersForQueue(orders) {
  const isClosed = (o) => ['entregado', 'cancelado'].includes(o.status || 'recibido');
  const pending = orders.filter((o) => !isClosed(o)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const done = orders.filter(isClosed).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return [...pending, ...done];
}

/* Sugiere un tiempo estimado según cuántos pedidos activos hay en
   cola en este momento — así el cajero no tiene que calcular a ojo
   en horas pico. Es solo una sugerencia visual (marca el botón
   correspondiente con "· sugerido"): sigue siendo el cajero quien
   elige, esto nunca pone el ETA solo. Umbrales simples a propósito,
   no un cálculo de tiempos de cocina real (eso necesitaría datos
   históricos que el proyecto no tiene). */
function suggestedEtaMinutes() {
  const active = state.orders.filter((o) => !['entregado', 'cancelado', 'no_entregado'].includes(o.status || 'recibido')).length;
  if (active <= 3) return 15;
  if (active <= 6) return 30;
  if (active <= 10) return 45;
  return 60;
}

function isUrgent(order) {
  if (['entregado', 'cancelado'].includes(order.status || 'recibido')) return false;
  const now = Date.now();
  if (order.scheduledFor) {
    // Programado: urgente si ya casi es la hora (o ya pasó) y sigue sin avanzar.
    return order.scheduledFor - now <= URGENT_MINUTES * 60000;
  }
  return !!order.createdAt && now - order.createdAt >= URGENT_MINUTES * 60000;
}

function timeAgo(ms) {
  if (!ms) return '';
  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (diffMin < 1) return 'justo ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `hace ${h}h ${m}min`;
}

/* Busca por nombre o teléfono — encima del filtro de estado, así que
   "Todos" + un nombre te deja buscar sin importar en qué estado esté
   el pedido. Coincidencia simple por texto, sin acentos ni mayúsculas
   (mismo criterio que matchZone en settings.js). */
function normalizeSearchText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function applyOrderSearch(orders) {
  const term = normalizeSearchText(state.orderSearchTerm).trim();
  if (!term) return orders;
  return orders.filter((o) => {
    const haystack = normalizeSearchText(`${o.customerName || ''} ${o.phone || ''}`);
    return haystack.includes(term);
  });
}

function ordersForCurrentFilter() {
  if (state.statusFilter === 'todos') return applyOrderSearch(state.orders);
  if (state.statusFilter === 'programados') {
    // Vista tipo calendario: solo los que tienen hora programada,
    // ordenados por esa hora (no por cuándo se hizo el pedido).
    return applyOrderSearch(
      state.orders
        .filter((o) => !!o.scheduledFor && (o.status || 'recibido') !== 'cancelado')
        .sort((a, b) => (a.scheduledFor || 0) - (b.scheduledFor || 0))
    );
  }
  return applyOrderSearch(state.orders.filter((o) => (o.status || 'recibido') === state.statusFilter));
}

function renderOrders() {
  updateFilterCounts();
  renderQuickStats();

  const container = $('admin-orders-list');
  const orders = ordersForCurrentFilter();

  // Si alguien está a mitad de escribir una nota interna cuando llega
  // un repintado (otro cajero cambió algo, un domiciliario actualizó
  // su ubicación), se pierde lo que llevaba escrito al reconstruir el
  // HTML — se guarda antes de repintar y se restaura después.
  const draftNote = captureFocusedNoteDraft(container);

  if (orders.length === 0) {
    container.innerHTML = `<p class="admin-hint">No hay pedidos ${state.statusFilter === 'todos' ? '' : 'en este grupo '}todavía.</p>`;
    return;
  }

  container.innerHTML = orders.map((order) => renderOrderCard(order)).join('');

  // Solo tiene sentido "cargar más" en la vista "Todos" — los filtros
  // por estado ya casi siempre caben en la primera página, y cargar
  // más ahí no cambiaría lo que se ve (el filtro ya lo tenía todo).
  if (state.statusFilter === 'todos' && state.ordersMaybeMore) {
    const loadMore = document.createElement('button');
    loadMore.type = 'button';
    loadMore.className = 'admin-load-more-btn';
    loadMore.textContent = 'Cargar pedidos anteriores';
    loadMore.addEventListener('click', () => {
      state.ordersLimit += ORDERS_PAGE_SIZE;
      subscribeOrders();
    });
    container.appendChild(loadMore);
  }

  container.querySelectorAll('.admin-status-buttons button:not(.admin-retry-btn)').forEach((btn) => {
    btn.addEventListener('click', () => handleStatusButtonClick(btn));
  });

  container.querySelectorAll('.admin-retry-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleRetryDelivery(btn.dataset.orderId));
  });

  container.querySelectorAll('.admin-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy || '');
        showToast('Dirección copiada');
      } catch {
        showToast('No se pudo copiar la dirección');
      }
    });
  });

  container.querySelectorAll('.admin-print-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const order = state.orders.find((o) => o.id === btn.dataset.orderId);
      if (order) printOrder(order);
    });
  });

  container.querySelectorAll('.admin-eta-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleSetEta(btn.dataset.orderId, Number(btn.dataset.eta)));
  });

  container.querySelectorAll('.admin-note-save').forEach((btn) => {
    btn.addEventListener('click', () => {
      const textarea = container.querySelector(`.admin-note-input[data-order-id="${btn.dataset.orderId}"]`);
      handleSaveInternalNote(btn.dataset.orderId, textarea ? textarea.value.trim() : '');
    });
  });

  container.querySelectorAll('.admin-block-btn:not(.admin-cancel-order-btn)').forEach((btn) => {
    btn.addEventListener('click', () => handleBlockToggle(btn.dataset.uid, btn.dataset.block === '1', btn));
  });

  container.querySelectorAll('.admin-cancel-order-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleCancelOrderFromPanel(btn.dataset.orderId, btn));
  });

  container.querySelectorAll('.admin-driver-select').forEach((select) => {
    select.addEventListener('change', () => handleAssignDriver(select.dataset.orderId, select.value || null));
  });

  restoreFocusedNoteDraft(container, draftNote);
}

function captureFocusedNoteDraft(container) {
  const el = document.activeElement;
  if (!el || !container.contains(el) || !el.classList.contains('admin-note-input')) return null;
  return {
    orderId: el.dataset.orderId,
    value: el.value,
    selectionStart: el.selectionStart,
    selectionEnd: el.selectionEnd,
  };
}

function restoreFocusedNoteDraft(container, draft) {
  if (!draft) return;
  const details = container.querySelector(`.admin-note-input[data-order-id="${draft.orderId}"]`)?.closest('details');
  const textarea = container.querySelector(`.admin-note-input[data-order-id="${draft.orderId}"]`);
  if (!textarea) return;
  if (details) details.open = true;
  textarea.value = draft.value;
  textarea.focus();
  try {
    textarea.setSelectionRange(draft.selectionStart, draft.selectionEnd);
  } catch {
    // Algunos navegadores no soportan setSelectionRange en ciertos
    // estados del textarea — no es crítico, ya quedó el texto y el foco.
  }
}

/* Al presionar un botón de estado: bloquea todo el grupo de
   inmediato (para que no se pueda hacer doble clic ni cambiar de
   estado por error mientras se está guardando), muestra que está
   guardando, y confirma con un mensaje claro cuando termina — sea
   que haya funcionado o que haya fallado. */
function handleStatusButtonClick(btn) {
  const { orderId, status } = btn.dataset;
  const group = btn.closest('.admin-status-buttons');
  const label = STATUS_STEPS.find((s) => s.id === status)?.label || status;

  group.classList.add('is-saving');
  group.querySelectorAll('button').forEach((b) => {
    b.disabled = true;
  });
  btn.classList.add('is-pending');

  update(ref(db, `orders/${orderId}`), { status })
    .then(() => {
      showToast(`Pedido marcado como "${label}"`);
      // Registro de quién cambió el estado y cuándo — útil cuando
      // hay más de una persona con acceso al panel.
      push(ref(db, `orders/${orderId}/statusHistory`), {
        status,
        byEmail: auth.currentUser?.email || 'admin',
        at: serverTimestamp(),
      }).catch(() => {});
      // No hace falta desbloquear a mano: la suscripción en vivo a
      // "orders" ya redibuja toda la tarjeta con el estado nuevo.
    })
    .catch((err) => {
      showToast(err.message || 'No se pudo actualizar el estado');
      group.classList.remove('is-saving');
      btn.classList.remove('is-pending');
      group.querySelectorAll('button').forEach((b) => {
        b.disabled = b.classList.contains('is-current');
      });
    });
}

function updateFilterCounts() {
  const counts = {
    todos: state.orders.length,
    recibido: 0,
    en_cocina: 0,
    en_camino: 0,
    entregado: 0,
    no_entregado: 0,
    cancelado: 0,
    programados: 0,
  };
  state.orders.forEach((o) => {
    const s = o.status || 'recibido';
    if (counts[s] !== undefined) counts[s]++;
    if (o.scheduledFor && s !== 'cancelado') counts.programados++;
  });
  document.querySelectorAll('.admin-filter-count').forEach((span) => {
    const n = counts[span.dataset.countFor] || 0;
    span.textContent = n > 0 ? String(n) : '';
    span.hidden = n === 0;
  });
}

/* Franja de números reales al abrir la pestaña Pedidos — nada
   inventado, se calcula de los mismos pedidos que ya están cargados
   (los últimos `state.ordersLimit`, ver subscribeOrders). */
function renderQuickStats() {
  const el = $('admin-quick-stats');
  if (!el) return;

  const startToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const todayOrders = state.orders.filter(
    (o) => (o.createdAt || 0) >= startToday && (o.status || 'recibido') !== 'cancelado'
  );
  const revenueToday = todayOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const activeCount = state.orders.filter((o) => !['entregado', 'cancelado'].includes(o.status || 'recibido')).length;
  const urgentCount = state.orders.filter(isUrgent).length;

  el.innerHTML = `
    <div class="admin-quick-stat">
      <span class="admin-quick-stat-value">${formatCOP(revenueToday)}</span>
      <span class="admin-quick-stat-label">Vendido hoy</span>
    </div>
    <div class="admin-quick-stat">
      <span class="admin-quick-stat-value">${activeCount}</span>
      <span class="admin-quick-stat-label">Pedidos activos</span>
    </div>
    <div class="admin-quick-stat${urgentCount > 0 ? ' is-alert' : ''}">
      <span class="admin-quick-stat-value">${urgentCount}</span>
      <span class="admin-quick-stat-label">Necesitan atención</span>
    </div>
  `;
}

function updatePedidosBadge() {
  const badge = $('admin-tab-badge-pedidos');
  if (!badge) return;
  badge.hidden = state.newOrdersCount === 0;
  badge.textContent = state.newOrdersCount > 9 ? '9+' : String(state.newOrdersCount);
}

function renderOrderHistory(order) {
  const entries = order.statusHistory ? Object.values(order.statusHistory) : [];
  if (entries.length === 0) return '';
  entries.sort((a, b) => (a.at || 0) - (b.at || 0));
  const rows = entries
    .map((h) => {
      const label = STATUS_STEPS.find((s) => s.id === h.status)?.label || (h.status === 'no_entregado' ? 'No se pudo entregar' : h.status);
      const time = h.at ? new Date(h.at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';
      return `<div class="admin-history-entry">${time} — ${escapeHtml(label)}${h.note ? ' (' + escapeHtml(h.note) + ')' : ''} · ${escapeHtml(h.byEmail || '')}</div>`;
    })
    .join('');
  return `<details class="admin-order-history"><summary>Historial (${entries.length})</summary>${rows}</details>`;
}

function renderOrderCard(order) {
  const currentStatus = order.status || 'recibido';
  const isCancelled = currentStatus === 'cancelado';
  const isFailedDelivery = currentStatus === 'no_entregado';
  const isDone = ['entregado', 'cancelado'].includes(currentStatus);
  const itemsSummary = (order.items || [])
    .map((item) => `${item.qty}× ${item.name}${item.notes ? ` (${item.notes})` : ''}`)
    .join(', ');
  const modeLabel = order.deliveryMode === 'recoger' ? 'Recoger en tienda' : 'A domicilio';
  const addressLine = order.deliveryMode === 'recoger' ? '' : order.address || 'sin dirección';
  const urgent = isUrgent(order);
  const isNewArrival = state.justArrivedOrderIds.has(order.id);
  const isBlocked = order.uid && state.blockedUids.has(order.uid);
  const phoneDigits = (order.phone || '').replace(/[^\d+]/g, '');
  const phoneHtml = phoneDigits
    ? `<a class="admin-order-phone" href="tel:${phoneDigits}">${escapeHtml(order.phone)}</a>`
    : escapeHtml(order.phone || 'sin teléfono');
  const timeChip = order.scheduledFor
    ? `<span class="admin-order-chip admin-order-chip-scheduled">Programado ${new Date(order.scheduledFor).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>`
    : `<span class="admin-order-chip">${timeAgo(order.createdAt)}</span>`;

  return `
    <div class="admin-order${urgent ? ' is-urgent' : ''}${isCancelled ? ' is-cancelled' : ''}${isNewArrival ? ' is-new-arrival' : ''}">
      <div class="admin-order-top">
        <div>
          <div class="admin-order-customer">${escapeHtml(order.customerName || 'Cliente')}</div>
          <div class="admin-order-meta">${phoneHtml} · ${modeLabel}</div>
        </div>
        <div class="admin-order-top-actions">
          <span class="price">${formatCOP(order.total || 0)}</span>
          <button type="button" class="admin-print-btn" data-order-id="${order.id}" aria-label="Imprimir comanda">${printSvg()}</button>
        </div>
      </div>
      ${
        addressLine
          ? `<div class="admin-order-address">${escapeHtml(addressLine)}<button type="button" class="admin-copy-btn" data-copy="${escapeHtml(addressLine)}" aria-label="Copiar dirección">${copySvg()}</button></div>`
          : ''
      }
      <div class="admin-order-items">${escapeHtml(itemsSummary)}${order.reference ? ` — Ref: ${escapeHtml(order.reference)}` : ''}</div>
      <div class="admin-order-chips">
        ${timeChip}
        ${urgent ? '<span class="admin-order-chip admin-order-chip-urgent">Necesita atención</span>' : ''}
        ${isCancelled ? '<span class="admin-order-chip admin-order-chip-cancelled">Cancelado por el cliente</span>' : ''}
        ${isFailedDelivery ? `<span class="admin-order-chip admin-order-chip-cancelled">No se pudo entregar — ${escapeHtml(order.deliveryFailureReason || 'sin motivo')}</span>` : ''}
        ${isBlocked ? '<span class="admin-order-chip admin-order-chip-cancelled">Cliente bloqueado</span>' : ''}
        ${order.etaMinutes && order.etaSetAt && !isDone ? `<span class="admin-order-chip">Estimado ${order.etaMinutes} min</span>` : ''}
        ${order.tipAmount ? `<span class="admin-order-chip admin-order-chip-tip">Propina ${formatCOP(order.tipAmount)}</span>` : ''}
      </div>
      ${
        isCancelled
          ? ''
          : isFailedDelivery
            ? `<div class="admin-status-buttons">
          <button type="button" class="admin-retry-btn" data-order-id="${order.id}">Reintentar entrega</button>
        </div>`
            : `<div class="admin-status-buttons">
        ${STATUS_STEPS.map(
          (step) => `
          <button
            type="button"
            data-order-id="${order.id}"
            data-status="${step.id}"
            class="${step.id === currentStatus ? 'is-current' : ''}"
            ${step.id === currentStatus ? 'disabled' : ''}
          >${step.label}</button>`
        ).join('')}
      </div>`
      }
      ${
        isDone || isFailedDelivery
          ? ''
          : `<div class="admin-eta-row">
        <span class="admin-eta-label">Tiempo estimado:</span>
        ${ETA_OPTIONS.map(
          (m) =>
            `<button type="button" class="admin-eta-btn${m === suggestedEtaMinutes() ? ' is-suggested' : ''}" data-order-id="${order.id}" data-eta="${m}">${m} min${m === suggestedEtaMinutes() ? ' · sugerido' : ''}</button>`
        ).join('')}
      </div>`
      }
      ${
        isDone || order.deliveryMode === 'recoger'
          ? ''
          : `<div class="admin-driver-row">
        <label class="admin-driver-label" for="driver-select-${order.id}">Domiciliario:</label>
        <select class="admin-driver-select" id="driver-select-${order.id}" data-order-id="${order.id}">
          <option value="">Sin asignar</option>
          ${Object.entries(state.drivers)
            .map(
              ([uid, d]) =>
                `<option value="${uid}" ${order.driverId === uid ? 'selected' : ''}>${escapeHtml(d.name || uid.slice(0, 6))}${d.available ? ' · disponible' : ''}</option>`
            )
            .join('')}
        </select>
        ${
          order.driverId && order.driverLocation
            ? isDriverLocationStale(order.driverLocation)
              ? `<span class="admin-driver-map-link admin-driver-map-stale">Sin señal del domiciliario (${timeAgo(order.driverLocation.updatedAt)}) — sigue en camino</span>`
              : `<a class="admin-driver-map-link" href="${trailMapsUrl(order.driverTrail, order.driverLocation)}" target="_blank" rel="noopener noreferrer">Ver ${Array.isArray(order.driverTrail) && order.driverTrail.length > 1 ? 'recorrido' : 'ubicación'} (${timeAgo(order.driverLocation.updatedAt)})</a>`
            : ''
        }
        ${
          order.customerLocation
            ? `<a class="admin-driver-map-link admin-customer-map-link" href="https://www.google.com/maps?q=${order.customerLocation.lat},${order.customerLocation.lng}" target="_blank" rel="noopener noreferrer">Ver ubicación del cliente</a>`
            : ''
        }
      </div>`
      }
      <details class="admin-order-note">
        <summary>Nota interna (solo la ve el panel)</summary>
        <textarea class="admin-note-input" data-order-id="${order.id}" rows="2" placeholder="Ej: cliente llamó, cambia la dirección…">${escapeHtml(order.internalNote || '')}</textarea>
        <button type="button" class="btn btn-ghost admin-note-save" data-order-id="${order.id}">Guardar nota</button>
      </details>
      ${
        !isCancelled && currentStatus !== 'entregado'
          ? `<button type="button" class="admin-block-btn admin-cancel-order-btn" data-order-id="${order.id}">Cancelar pedido</button>`
          : ''
      }
      ${
        state.role === 'dueno' && order.uid
          ? `<button type="button" class="admin-block-btn${isBlocked ? ' is-blocked' : ''}" data-uid="${order.uid}" data-block="${isBlocked ? '0' : '1'}">${isBlocked ? 'Desbloquear cliente' : 'Bloquear cliente'}</button>`
          : ''
      }
      ${renderOrderHistory(order)}
    </div>
  `;
}

/* ---------- Aviso de pedidos nuevos ---------- */
function loadSeenOrderIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_ORDERS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveSeenOrderIds(ids) {
  try {
    localStorage.setItem(SEEN_ORDERS_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage no disponible (modo privado, etc.): no rompe el panel.
  }
}

/* Dos "beeps" cortos con el sintetizador del navegador — no depende
   de ningún archivo de audio. Si el navegador bloquea el audio
   (autoplay) simplemente no suena, sin romper el panel. */
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

/* ---------- Inventario ---------- */
/* outOfStock/{productId} ahora puede ser: ausente (disponible, sin
   conteo), un número > 0 (unidades restantes, sigue disponible) o
   0/true (agotado para el cliente). */
function subscribeStock() {
  unsubStock = onValue(
    ref(db, 'outOfStock'),
    (snapshot) => {
      state.stock = snapshot.val() || {};
      scheduleRenderStockList();
    },
    errors.logOnValueError('admin:stock')
  );
}

let renderStockTimer = null;
function scheduleRenderStockList() {
  if (renderStockTimer) return;
  renderStockTimer = setTimeout(() => {
    renderStockTimer = null;
    renderStockList();
  }, 400);
}

function isOutOfStock(value) {
  return value === true || value === 0;
}

function renderStockList() {
  const container = $('admin-stock-list');

  // Mismo riesgo que las notas de pedido: si otro cajero marca un
  // producto distinto como agotado mientras alguien está a mitad de
  // escribir un conteo, el repintado no debe borrarle lo que llevaba.
  const draft = document.activeElement?.classList.contains('admin-stock-count')
    ? { productId: document.activeElement.dataset.productId, value: document.activeElement.value }
    : null;

  container.innerHTML = state.products.map((product) => {
    const value = state.stock[product.id];
    const isOut = isOutOfStock(value);
    const count = typeof value === 'number' && value > 0 ? value : '';
    const isLow = typeof value === 'number' && value > 0 && value <= LOW_STOCK_THRESHOLD;
    return `
      <div class="admin-stock-row">
        <img src="${product.image}" alt="" />
        <span class="admin-stock-name">${escapeHtml(product.name)}${isLow ? '<span class="admin-stock-low-badge">Quedan pocas</span>' : ''}</span>
        <input type="number" min="0" class="admin-stock-count" data-product-id="${product.id}" placeholder="∞" value="${count}" aria-label="Unidades restantes de ${escapeHtml(product.name)}" />
        <button type="button" class="admin-stock-toggle${isOut ? ' is-out' : ''}" data-product-id="${product.id}" aria-label="Marcar ${escapeHtml(product.name)} como agotado" aria-pressed="${isOut}"></button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.admin-stock-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const productId = btn.dataset.productId;
      const isOut = isOutOfStock(state.stock[productId]);
      const op = isOut ? remove(ref(db, `outOfStock/${productId}`)) : set(ref(db, `outOfStock/${productId}`), true);
      op.catch((err) => showToast(err.message || 'No se pudo actualizar el inventario'));
    });
  });

  container.querySelectorAll('.admin-stock-count').forEach((input) => {
    input.addEventListener('change', () => {
      const productId = input.dataset.productId;
      const raw = input.value.trim();
      const op = raw === '' ? remove(ref(db, `outOfStock/${productId}`)) : set(ref(db, `outOfStock/${productId}`), Math.max(0, Number(raw) || 0));
      op.catch((err) => showToast(err.message || 'No se pudo actualizar el inventario'));
    });
  });

  if (draft) {
    const input = container.querySelector(`.admin-stock-count[data-product-id="${draft.productId}"]`);
    if (input) {
      input.value = draft.value;
      input.focus();
    }
  }
}

/* ---------- Menú: categorías ---------- */
function subscribeCategories() {
  unsubCategories = catalog.onCategoriesChange((categories) => {
    state.categories = categories;
    renderCategoriesList();
    renderProductCategoryOptions();
    updateSeedBanner();
  });
}

function renderCategoriesList() {
  const container = $('admin-categories-list');
  if (state.categories.length === 0) {
    container.innerHTML = `<p class="admin-hint">Sin categorías todavía.</p>`;
    return;
  }
  container.innerHTML = state.categories
    .map(
      (cat) => `
      <div class="admin-item-row">
        <div class="admin-item-info">
          <div class="admin-item-name">${escapeHtml(cat.name)}</div>
          <div class="admin-item-meta">orden: ${cat.order ?? 0}</div>
        </div>
        <div class="admin-item-actions">
          <button type="button" data-edit-category="${cat.id}" aria-label="Editar">${pencilSvg()}</button>
          <button type="button" class="admin-delete-btn" data-delete-category="${cat.id}" aria-label="Eliminar">${trashSvg()}</button>
        </div>
      </div>`
    )
    .join('');

  container.querySelectorAll('[data-edit-category]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = state.categories.find((c) => c.id === btn.dataset.editCategory);
      if (cat) openCategoryForm(cat);
    });
  });
  container.querySelectorAll('[data-delete-category]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.deleteCategory;
      const productsInCategory = state.products.filter((p) => p.categoryId === id).length;
      const msg = productsInCategory
        ? `Esta categoría tiene ${productsInCategory} producto(s). Bórralos o cámbialos de categoría primero.`
        : null;
      if (msg) {
        showToast(msg);
        return;
      }
      catalog.deleteCategory(id).catch((err) => showToast(err.message || 'No se pudo eliminar'));
    });
  });
}

function openCategoryForm(category) {
  $('category-form-id').value = category ? category.id : '';
  $('category-form-name').value = category ? category.name : '';
  $('category-form-order').value = category ? category.order ?? 0 : state.categories.length;
  $('category-form').hidden = false;
}

function closeCategoryForm() {
  $('category-form').hidden = true;
  $('category-form').reset();
}

/* ---------- Menú: productos ---------- */
function subscribeProducts() {
  unsubProducts = catalog.onProductsChange((products) => {
    state.products = products;
    renderProductsList();
    renderStockList();
    updateSeedBanner();
  });
}

function renderProductsList() {
  const container = $('admin-products-list');
  if (state.products.length === 0) {
    container.innerHTML = `<p class="admin-hint">Sin productos todavía.</p>`;
    return;
  }
  const categoryName = (id) => state.categories.find((c) => c.id === id)?.name || id;

  container.innerHTML = state.products
    .map(
      (product) => `
      <div class="admin-item-row">
        <img src="${product.image || ''}" alt="" />
        <div class="admin-item-info">
          <div class="admin-item-name">${escapeHtml(product.name)}</div>
          <div class="admin-item-meta">${escapeHtml(categoryName(product.categoryId))} · ${formatCOP(product.price || 0)}</div>
        </div>
        <div class="admin-item-actions">
          <button type="button" data-edit-product="${product.id}" aria-label="Editar">${pencilSvg()}</button>
          <button type="button" class="admin-delete-btn" data-delete-product="${product.id}" aria-label="Eliminar">${trashSvg()}</button>
        </div>
      </div>`
    )
    .join('');

  container.querySelectorAll('[data-edit-product]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const product = state.products.find((p) => p.id === btn.dataset.editProduct);
      if (product) openProductForm(product);
    });
  });
  container.querySelectorAll('[data-delete-product]').forEach((btn) => {
    btn.addEventListener('click', () => {
      catalog.deleteProduct(btn.dataset.deleteProduct).catch((err) => showToast(err.message || 'No se pudo eliminar'));
    });
  });
}

function renderProductCategoryOptions() {
  const select = $('product-form-category');
  const current = select.value;
  select.innerHTML = state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if (current) select.value = current;
}

function openProductForm(product) {
  $('product-form-id').value = product ? product.id : '';
  $('product-form-name').value = product ? product.name : '';
  $('product-form-desc').value = product ? product.description || '' : '';
  $('product-form-price').value = product ? product.price || 0 : '';
  $('product-form-image').value = product ? product.image || '' : '';
  $('product-form-badge').value = product ? product.badge || '' : '';
  renderProductCategoryOptions();
  if (product) $('product-form-category').value = product.categoryId;
  $('product-form').hidden = false;
}

function closeProductForm() {
  $('product-form').hidden = true;
  $('product-form').reset();
}

/* ---------- Menú: eventos ---------- */
function bindMenuEvents() {
  $('btn-add-category').addEventListener('click', () => openCategoryForm(null));
  $('btn-cancel-category').addEventListener('click', () => closeCategoryForm());
  $('category-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await catalog.saveCategory({
        id: $('category-form-id').value || null,
        name: $('category-form-name').value.trim(),
        order: Number($('category-form-order').value) || 0,
      });
      closeCategoryForm();
      showToast('Categoría guardada');
    } catch (err) {
      showToast(err.message || 'No se pudo guardar la categoría');
    }
  });

  $('btn-add-product').addEventListener('click', () => openProductForm(null));
  $('btn-cancel-product').addEventListener('click', () => closeProductForm());
  $('product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('product-form-name').value.trim();
    const price = Number($('product-form-price').value);
    if (!name || !price) {
      showToast('Ponle nombre y precio al producto');
      return;
    }
    try {
      await catalog.saveProduct({
        id: $('product-form-id').value || null,
        name,
        categoryId: $('product-form-category').value,
        description: $('product-form-desc').value.trim(),
        price,
        image: $('product-form-image').value.trim(),
        badge: $('product-form-badge').value.trim() || null,
      });
      closeProductForm();
      showToast('Producto guardado');
    } catch (err) {
      showToast(err.message || 'No se pudo guardar el producto');
    }
  });

  $('btn-seed-catalog').addEventListener('click', async () => {
    try {
      const seeded = await catalog.seedCatalogIfEmpty();
      showToast(seeded ? 'Menú inicial cargado' : 'Ya había productos, no se tocó nada');
    } catch (err) {
      showToast(err.message || 'No se pudo cargar el menú inicial');
    }
  });
}

function updateSeedBanner() {
  $('admin-seed-banner').hidden = state.products.length > 0;
}

function pencilSvg() {
  return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M4 20l1-4L16.5 4.5a1.5 1.5 0 012 2L7 18l-4 1z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
}
function trashSvg() {
  return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m1 0-1 13a1 1 0 01-1 1H9a1 1 0 01-1-1L7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function copySvg() {
  return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" stroke="currentColor" stroke-width="1.8"/></svg>';
}
function printSvg() {
  return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M6 9V4h12v5M6 18H4a1 1 0 01-1-1v-5a1 1 0 011-1h16a1 1 0 011 1v5a1 1 0 01-1 1h-2M6 14h12v6H6v-6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
}

/* ---------- Imprimir comanda ---------- */
/* Usa el diálogo de impresión normal del navegador (@media print
   en admin.css oculta todo menos #print-ticket) — funciona con
   cualquier impresora que ya tengas configurada en el computador,
   térmica o normal, sin necesitar un driver especial. */
async function printOrder(order) {
  const itemsHtml = (order.items || [])
    .map(
      (item) => `
      <div class="ticket-item">${item.qty}× ${escapeHtml(item.name)}</div>
      ${item.notes ? `<div class="ticket-notes">Nota: ${escapeHtml(item.notes)}</div>` : ''}`
    )
    .join('');

  const orderNumber = (order.id || '').slice(-6).toUpperCase();

  $('print-ticket').innerHTML = `
    <div class="ticket">
      <div class="ticket-brand">
        <img src="icon.svg" alt="" class="ticket-logo" />
        <h2>Rodízio Cúcuta</h2>
      </div>
      ${orderNumber ? `<p class="ticket-order-number">Pedido #${escapeHtml(orderNumber)}</p>` : ''}
      <p>${order.createdAt ? new Date(order.createdAt).toLocaleString('es-CO') : ''}</p>
      <hr />
      <p><strong>${escapeHtml(order.customerName || 'Cliente')}</strong></p>
      <p>${escapeHtml(order.phone || '')}</p>
      <p>${order.deliveryMode === 'recoger' ? 'Recoger en tienda' : `A domicilio${order.address ? ' — ' + escapeHtml(order.address) : ''}`}</p>
      ${order.reference ? `<p>Ref: ${escapeHtml(order.reference)}</p>` : ''}
      ${order.scheduledFor ? `<p>Programado: ${new Date(order.scheduledFor).toLocaleString('es-CO')}</p>` : ''}
      ${order.internalNote ? `<p>Nota: ${escapeHtml(order.internalNote)}</p>` : ''}
      <hr />
      ${itemsHtml}
      <hr />
      ${order.tipAmount ? `<p>Propina: ${formatCOP(order.tipAmount)}</p>` : ''}
      <p><strong>Total: ${formatCOP(order.total || 0)}</strong></p>
    </div>
  `;

  // El logo se acaba de insertar con innerHTML — en computador,
  // window.print() puede disparar la vista previa antes de que el
  // navegador termine de cargar esa imagen (llamada síncrona, sin
  // darle tiempo a un solo frame de pintarla), y sale en blanco. En
  // celular casi nunca pasa porque abrir la hoja de compartir/imprimir
  // nativa ya toma más tiempo, de sobra para que cargue. Se espera a
  // que la imagen cargue (o a que fallen/pasen 800ms de margen) antes
  // de imprimir, para que salga siempre, sin importar el dispositivo.
  const logo = $('print-ticket').querySelector('.ticket-logo');
  await new Promise((resolve) => {
    if (!logo || logo.complete) {
      resolve();
      return;
    }
    const done = () => resolve();
    logo.addEventListener('load', done, { once: true });
    logo.addEventListener('error', done, { once: true });
    setTimeout(done, 800);
  });

  window.print();
}

/* ---------- Reportes ---------- */
function renderReports() {
  const startToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const startWeek = startToday - 6 * 86400000;
  const start30 = startToday - 29 * 86400000;

  const counted = state.orders.filter((o) => (o.status || 'recibido') !== 'cancelado');
  const sumRevenue = (list) => list.reduce((sum, o) => sum + (o.total || 0), 0);
  const todayOrders = counted.filter((o) => (o.createdAt || 0) >= startToday);
  const weekOrders = counted.filter((o) => (o.createdAt || 0) >= startWeek);

  const todayAll = state.orders.filter((o) => (o.createdAt || 0) >= startToday);
  const todayDelivered = todayAll.filter((o) => (o.status || 'recibido') === 'entregado').length;
  const todayCancelled = todayAll.filter((o) => (o.status || 'recibido') === 'cancelado').length;
  const todayActive = todayAll.length - todayDelivered - todayCancelled;

  $('admin-report-cards').innerHTML = `
    <div class="admin-report-card">
      <span class="admin-report-value">${formatCOP(sumRevenue(todayOrders))}</span>
      <span class="admin-report-label">Ventas de hoy · ${todayOrders.length} pedido${todayOrders.length === 1 ? '' : 's'}</span>
    </div>
    <div class="admin-report-card">
      <span class="admin-report-value">${formatCOP(sumRevenue(weekOrders))}</span>
      <span class="admin-report-label">Últimos 7 días · ${weekOrders.length} pedido${weekOrders.length === 1 ? '' : 's'}</span>
    </div>
    <div class="admin-report-card">
      <span class="admin-report-value">${todayDelivered}</span>
      <span class="admin-report-label">Entregados hoy</span>
    </div>
    <div class="admin-report-card">
      <span class="admin-report-value">${todayActive}</span>
      <span class="admin-report-label">Pendientes hoy</span>
    </div>
    <div class="admin-report-card">
      <span class="admin-report-value">${todayCancelled}</span>
      <span class="admin-report-label">Cancelados hoy</span>
    </div>
  `;

  const productCounts = {};
  counted
    .filter((o) => (o.createdAt || 0) >= start30)
    .forEach((o) => {
      (o.items || []).forEach((item) => {
        productCounts[item.name] = (productCounts[item.name] || 0) + (item.qty || 0);
      });
    });
  const top = Object.entries(productCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  $('admin-report-top-products').innerHTML = top.length
    ? top
        .map(
          ([name, qty], i) => `
      <div class="admin-item-row">
        <div class="admin-item-info">
          <div class="admin-item-name">${i + 1}. ${escapeHtml(name)}</div>
        </div>
        <div class="admin-item-meta">${qty} vendidos</div>
      </div>`
        )
        .join('')
    : '<p class="admin-hint">Todavía no hay suficientes pedidos para mostrar un top.</p>';
}

/* ---------- Exportar pedidos del día a Excel ---------- */
/* Antes era un CSV crudo (números sin formato de moneda, la columna
   de productos como un solo texto largo sin ajustar, sin nada de
   marca) — se veía "desordenado" al abrirlo. Ahora genera un .xlsx de
   verdad con ExcelJS (librería externa, cargada solo cuando hace
   falta — no vale la pena sumarla al App Shell para algo que se usa
   una vez cada tanto): encabezado con el logo y el nombre del
   restaurante, columnas con ancho fijo y ajuste de texto, montos con
   formato de pesos colombianos, y la fila de títulos congelada para
   poder desplazarse por muchos pedidos sin perderla de vista. */
let exceljsReady = null;
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve();
  if (!exceljsReady) {
    exceljsReady = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('No se pudo cargar la librería de Excel (revisa tu conexión a internet)'));
      document.head.appendChild(script);
    });
  }
  return exceljsReady;
}

const MONEY_FORMAT = '"$"#,##0';

async function exportOrdersXLSX() {
  const startToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const todayOrders = state.orders
    .filter((o) => (o.createdAt || 0) >= startToday)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  if (todayOrders.length === 0) {
    showToast('No hay pedidos de hoy para exportar');
    return;
  }

  const exportBtn = $('btn-export-orders-csv');
  exportBtn.disabled = true;
  exportBtn.classList.add('is-loading');
  try {
    await loadExcelJS();
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = 'Rodízio Cúcuta';
    const sheet = workbook.addWorksheet('Pedidos', {
      views: [{ state: 'frozen', ySplit: 4 }],
    });

    const columns = [
      { header: 'Hora', width: 9 },
      { header: 'Cliente', width: 22 },
      { header: 'Teléfono', width: 15 },
      { header: 'Modo', width: 16 },
      { header: 'Dirección', width: 28 },
      { header: 'Productos', width: 40 },
      { header: 'Subtotal', width: 13 },
      { header: 'Domicilio', width: 12 },
      { header: 'Total', width: 13 },
      { header: 'Propina', width: 12 },
      { header: 'Estado', width: 14 },
    ];
    sheet.columns = columns.map((c) => ({ width: c.width }));

    // --- Encabezado de marca: logo + nombre + fecha, en una franja
    // roja que ocupa todas las columnas de la tabla. ---
    sheet.mergeCells(1, 1, 1, columns.length);
    sheet.mergeCells(2, 1, 2, columns.length);
    const titleRow = sheet.getRow(1);
    titleRow.height = 26;
    titleRow.getCell(1).value = 'Rodízio Cúcuta';
    titleRow.getCell(1).font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 6 };
    titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9342A' } };
    columns.forEach((_, i) => {
      if (i > 0) titleRow.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9342A' } };
    });

    const subtitleRow = sheet.getRow(2);
    subtitleRow.height = 18;
    const todayLabel = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
    subtitleRow.getCell(1).value = `Pedidos del ${todayLabel} — ${todayOrders.length} pedido${todayOrders.length === 1 ? '' : 's'}`;
    subtitleRow.getCell(1).font = { name: 'Calibri', size: 11, italic: true, color: { argb: 'FFFFFFFF' } };
    subtitleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 6 };
    columns.forEach((_, i) => {
      subtitleRow.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8A2016' } };
    });

    // Logo — solo si se puede leer el archivo local (nunca bloquea la
    // exportación si falla: la tabla igual sirve sin el logo).
    try {
      const logoBuffer = await fetch('icon-512.png').then((r) => r.arrayBuffer());
      const imageId = workbook.addImage({ buffer: logoBuffer, extension: 'png' });
      sheet.addImage(imageId, { tl: { col: 0.05, row: 0.05 }, ext: { width: 40, height: 40 } });
    } catch {
      // Sin logo, sin problema — el resto del archivo se genera igual.
    }

    // --- Fila de encabezados de columna ---
    const headerRow = sheet.getRow(3);
    headerRow.values = columns.map((c) => c.header);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2A1E17' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });

    // --- Filas de datos ---
    todayOrders.forEach((o) => {
      const row = sheet.addRow([
        o.createdAt ? new Date(o.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '',
        o.customerName || '',
        o.phone || '',
        o.deliveryMode === 'recoger' ? 'Recoger en tienda' : 'A domicilio',
        o.address || '',
        (o.items || []).map((i) => `${i.qty}x ${i.name}${i.notes ? ` (${i.notes})` : ''}`).join('\n'),
        o.subtotal || 0,
        o.shipping || 0,
        o.total || 0,
        o.tipAmount || 0,
        STATUS_STEPS.find((s) => s.id === (o.status || 'recibido'))?.label ||
          (o.status === 'no_entregado' ? 'No entregado' : o.status === 'cancelado' ? 'Cancelado' : o.status || 'Recibido'),
      ]);
      row.getCell(6).alignment = { wrapText: true, vertical: 'top' };
      [7, 8, 9, 10].forEach((col) => {
        row.getCell(col).numFmt = MONEY_FORMAT;
      });
      row.eachCell((cell) => {
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE0D2BD' } } };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pedidos-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message || 'No se pudo generar el archivo de Excel');
  } finally {
    exportBtn.disabled = false;
    exportBtn.classList.remove('is-loading');
  }
}

/* ---------- Cierres de turno de domiciliarios ---------- */
/* Antes solo se podían revisar a mano desde la consola de Firebase
   (nodo cashSettlements) — cada domiciliario crea uno al cerrar
   turno en driver.js. Solo lectura acá: el registro es un historial
   de auditoría, nunca se edita desde el panel (ver reglas de RTDB en
   firebase-config.js — solo se puede crear uno nuevo, no tocar uno
   que ya existe). */
function subscribeCashSettlements() {
  return onValue(
    query(ref(db, 'cashSettlements'), limitToLast(50)),
    (snapshot) => {
      const value = snapshot.val() || {};
      state.cashSettlements = Object.entries(value)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
      renderCashSettlementsList();
    },
    errors.logOnValueError('admin:cashSettlements')
  );
}

function renderCashSettlementsList() {
  const container = $('admin-cash-settlements-list');
  if (!container) return;
  if (state.cashSettlements.length === 0) {
    container.innerHTML = `<p class="admin-hint">Sin cierres de turno registrados todavía.</p>`;
    return;
  }
  container.innerHTML = state.cashSettlements
    .map((s) => {
      const diff = s.difference || 0;
      const diffLabel =
        diff === 0 ? 'cuadrado' : diff > 0 ? `${formatCOP(diff)} de más` : `${formatCOP(Math.abs(diff))} de menos`;
      const time = s.closedAt ? new Date(s.closedAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '';
      return `
      <div class="admin-item-row">
        <div class="admin-item-info">
          <div class="admin-item-name">${escapeHtml(s.driverName || 'Domiciliario')}<span class="admin-order-chip${diff === 0 ? '' : ' admin-order-chip-cancelled'}" style="margin-left:6px;">${escapeHtml(diffLabel)}</span></div>
          <div class="admin-item-meta">${time} · ${s.ordersCount || 0} pedido${s.ordersCount === 1 ? '' : 's'} · esperado ${formatCOP(s.expectedCash || 0)} · entregó ${formatCOP(s.actualCash || 0)}</div>
        </div>
      </div>`;
    })
    .join('');
}

/* Calificaciones que los clientes le dejan al domiciliario al
   entregar (rateDriver en auth.js, botón en el detalle del pedido del
   cliente) — se guardaban en driverRatings/{orderId} desde hace rato
   pero no se mostraban en NINGÚN lado, ni al domiciliario ni acá. El
   dueño lee el nodo completo (las reglas ya lo permiten) y se agrega
   por driverId para sacar el promedio de cada uno. */
function subscribeDriverRatings() {
  return onValue(
    ref(db, 'driverRatings'),
    (snapshot) => {
      const value = snapshot.val() || {};
      const byDriver = {};
      Object.values(value).forEach((r) => {
        if (!r || !r.driverId || typeof r.rating !== 'number') return;
        if (!byDriver[r.driverId]) byDriver[r.driverId] = { sum: 0, count: 0 };
        byDriver[r.driverId].sum += r.rating;
        byDriver[r.driverId].count += 1;
      });
      state.driverRatings = byDriver;
      renderDriverRatingsList();
    },
    errors.logOnValueError('admin:driverRatings')
  );
}

function renderDriverRatingsList() {
  const container = $('admin-driver-ratings-list');
  if (!container) return;
  const driverIds = Object.keys(state.drivers);
  if (driverIds.length === 0) {
    container.innerHTML = `<p class="admin-hint">Sin domiciliarios habilitados todavía.</p>`;
    return;
  }
  container.innerHTML = driverIds
    .map((uid) => {
      const driver = state.drivers[uid];
      const agg = state.driverRatings[uid];
      const summary = agg
        ? `★ ${(agg.sum / agg.count).toFixed(1)} · ${agg.count} calificación${agg.count === 1 ? '' : 'es'}`
        : 'Sin calificaciones todavía';
      return `
      <div class="admin-item-row">
        <div class="admin-item-info">
          <div class="admin-item-name">${escapeHtml(driver.name || 'Domiciliario')}</div>
          <div class="admin-item-meta">${escapeHtml(summary)}</div>
        </div>
      </div>`;
    })
    .join('');
}

/* ---------- Errores recientes del cliente y del panel ---------- */
/* Sin esto, un error de JS en producción solo se sabe si alguien se
   queja. Muestra los últimos registrados por errors.js (cualquier
   sesión, con o sin login) — solo el dueño los ve. */
function renderErrorLog() {
  const container = $('admin-error-log');
  if (!container) return;
  if (state.errorLogs.length === 0) {
    container.innerHTML = `<p class="admin-hint">Sin errores registrados — buena señal.</p>`;
    return;
  }
  container.innerHTML = state.errorLogs
    .map((log) => {
      const time = log.at ? new Date(log.at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '';
      return `
      <div class="admin-error-row">
        <div class="admin-error-top">
          <span class="admin-error-context">${escapeHtml(log.context || '?')}</span>
          <span class="admin-error-time">${time}</span>
        </div>
        <div class="admin-error-message">${escapeHtml(log.message || '')}</div>
      </div>`;
    })
    .join('');
}

/* Borra TODO el historial de errores registrados (errorLogs) — para
   cuando ya se resolvió lo que los causaba y solo quedan como ruido
   viejo en la lista. No hace falta ser dueño (las reglas de RTDB
   solo exigen ser admin para leer/borrar ese nodo, cualquier rol
   puede escribir ahí), pero como es una acción irreversible se
   confirma primero. */
async function handleClearErrorLog() {
  if (state.errorLogs.length === 0) return;
  const ok = await confirmDialog(`¿Borrar los ${state.errorLogs.length} errores registrados? No se puede deshacer.`, {
    confirmLabel: 'Sí, borrar todo',
    cancelLabel: 'Cancelar',
  });
  if (!ok) return;
  try {
    await remove(ref(db, 'errorLogs'));
    showToast('Historial de errores borrado');
  } catch (err) {
    showToast(err.message || 'No se pudo borrar el historial');
  }
}

/* ---------- Configuración del negocio ---------- */
function subscribeSettings() {
  unsubSettings = settingsApi.onSettingsChange((settings) => {
    state.settings = settings;
    renderSettingsForm();
    renderZonesList();
  });
}

function renderSettingsForm() {
  const s = state.settings;
  $('settings-is-open').checked = s.isOpen !== false;
  $('settings-closed-message').value = s.closedMessage || '';
  $('settings-phone').value = s.restaurantPhone || '';
  $('settings-closing-time').value = s.closingTime || '';
  $('settings-min-order').value = s.minOrderDomicilio || 0;
  $('settings-default-fee').value = s.defaultShippingFee || 0;
  $('settings-restrict-zones').checked = !!s.restrictToZones;
}

function bindSettingsEvents() {
  $('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await settingsApi.saveSettings({
        ...state.settings,
        isOpen: $('settings-is-open').checked,
        closedMessage: $('settings-closed-message').value.trim(),
        restaurantPhone: $('settings-phone').value.trim(),
        closingTime: $('settings-closing-time').value,
        minOrderDomicilio: Number($('settings-min-order').value) || 0,
        defaultShippingFee: Number($('settings-default-fee').value) || 0,
        restrictToZones: $('settings-restrict-zones').checked,
      });
      showToast('Configuración guardada');
    } catch (err) {
      showToast(err.message || 'No se pudo guardar la configuración');
    }
  });

  $('btn-add-zone').addEventListener('click', () => openZoneForm(null));
  $('btn-cancel-zone').addEventListener('click', () => closeZoneForm());
  $('zone-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('zone-form-name').value.trim();
    const fee = Number($('zone-form-fee').value);
    const keywords = $('zone-form-keywords')
      .value.split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    if (!name || keywords.length === 0) {
      showToast('Ponle nombre y al menos una palabra clave a la zona');
      return;
    }
    const idx = $('zone-form-idx').value;
    const zones = [...(state.settings.coverageZones || [])];
    const zone = { name, keywords, fee: fee || 0 };
    if (idx !== '') {
      zones[Number(idx)] = zone;
    } else {
      zones.push(zone);
    }
    try {
      await settingsApi.saveSettings({ ...state.settings, coverageZones: zones });
      closeZoneForm();
      showToast('Zona guardada');
    } catch (err) {
      showToast(err.message || 'No se pudo guardar la zona');
    }
  });

}

function renderZonesList() {
  const container = $('admin-zones-list');
  const zones = state.settings.coverageZones || [];
  if (zones.length === 0) {
    container.innerHTML = `<p class="admin-hint">Sin zonas registradas.</p>`;
    return;
  }
  container.innerHTML = zones
    .map(
      (zone, idx) => `
      <div class="admin-item-row">
        <div class="admin-item-info">
          <div class="admin-item-name">${escapeHtml(zone.name)}</div>
          <div class="admin-item-meta">${escapeHtml((zone.keywords || []).join(', '))} · ${formatCOP(zone.fee || 0)}</div>
        </div>
        <div class="admin-item-actions">
          <button type="button" data-edit-zone="${idx}" aria-label="Editar">${pencilSvg()}</button>
          <button type="button" class="admin-delete-btn" data-delete-zone="${idx}" aria-label="Eliminar">${trashSvg()}</button>
        </div>
      </div>`
    )
    .join('');

  container.querySelectorAll('[data-edit-zone]').forEach((btn) => {
    btn.addEventListener('click', () => openZoneForm(zones[Number(btn.dataset.editZone)], Number(btn.dataset.editZone)));
  });
  container.querySelectorAll('[data-delete-zone]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.deleteZone);
      const zones = (state.settings.coverageZones || []).filter((_, i) => i !== idx);
      try {
        await settingsApi.saveSettings({ ...state.settings, coverageZones: zones });
        showToast('Zona eliminada');
      } catch (err) {
        showToast(err.message || 'No se pudo eliminar la zona');
      }
    });
  });
}

function openZoneForm(zone, idx) {
  $('zone-form-idx').value = zone ? idx : '';
  $('zone-form-name').value = zone ? zone.name : '';
  $('zone-form-keywords').value = zone ? (zone.keywords || []).join(', ') : '';
  $('zone-form-fee').value = zone ? zone.fee || 0 : '';
  $('zone-form').hidden = false;
}

function closeZoneForm() {
  $('zone-form').hidden = true;
  $('zone-form').reset();
}

/* ---------- Domiciliarios ---------- */
/* Cualquier admin (dueño o cajero) puede leer la lista y asignar —
   es una tarea operativa del día a día, no de gestión del negocio.
   Solo el dueño puede habilitar el acceso de un domiciliario nuevo
   (eso se sigue haciendo a mano en la consola, como con admins/). */
function subscribeDrivers() {
  unsubDrivers = onValue(
    ref(db, 'drivers'),
    (snapshot) => {
      const value = snapshot.val() || {};
      state.drivers = Object.fromEntries(
        Object.entries(value)
          .filter(([, d]) => d && d.access === true)
          .map(([uid, d]) => [uid, { name: d.name || '', phone: d.phone || '', available: !!d.available }])
      );
      renderOrders();
      renderDriverRatingsList();
    },
    errors.logOnValueError('admin:drivers')
  );
}

/* "Reintentar entrega" — el pedido quedó en "no_entregado" (el
   domiciliario avisó que no pudo entregarlo). El cajero/dueño puede
   cambiar el domiciliario asignado con el selector de arriba antes
   de esto si hace falta; este botón vuelve a mandarlo a la calle
   ("en_camino") con quien haya quedado asignado en ese momento. */
async function handleRetryDelivery(orderId) {
  const ok = await confirmDialog('¿Reintentar la entrega de este pedido?', {
    confirmLabel: 'Sí, reintentar',
    cancelLabel: 'Cancelar',
    danger: false,
  });
  if (!ok) return;
  try {
    await update(ref(db, `orders/${orderId}`), {
      status: 'en_camino',
      deliveryFailureReason: null,
      deliveryFailureAt: null,
    });
    push(ref(db, `orders/${orderId}/statusHistory`), {
      status: 'en_camino',
      byEmail: auth.currentUser?.email || 'panel',
      at: serverTimestamp(),
      note: 'Reintento de entrega',
    }).catch(() => {});
    showToast('Pedido reenviado — en camino de nuevo');
  } catch (err) {
    showToast(err.message || 'No se pudo reintentar la entrega');
  }
}

const CANCEL_REASONS = [
  'El cliente llamó a cancelar',
  'Producto no disponible',
  'Pedido duplicado o de prueba',
  'No se pudo contactar al cliente',
  'Otro motivo',
];

/* Cancelar un pedido desde el panel — a diferencia del botón del
   cliente (solo disponible los primeros minutos), esto lo puede
   hacer el cajero/dueño en cualquier momento mientras el pedido no
   esté ya "entregado". Pide un motivo (mismo patrón que "No se pudo
   entregar" del domiciliario) y lo deja en el historial — no
   restaura inventario, mismo comportamiento que ya tenía cancelar
   desde el lado del cliente. */
async function handleCancelOrderFromPanel(orderId, btn) {
  const reason = await pickReasonDialog('¿Por qué se cancela este pedido?', CANCEL_REASONS);
  if (!reason) return;
  // Mismo patrón que los botones de acción de domiciliarios: solo
  // spinner, sin check de éxito — la tarjeta se repinta apenas
  // confirma Firebase (cambia de pestaña/estado), así que un check
  // con pausa propia nunca llegaría a verse completo.
  btn?.classList.add('is-loading');
  try {
    await update(ref(db, `orders/${orderId}`), { status: 'cancelado', driverLocation: null, driverTrail: null });
    push(ref(db, `orders/${orderId}/statusHistory`), {
      status: 'cancelado',
      byEmail: auth.currentUser?.email || 'panel',
      at: serverTimestamp(),
      note: reason,
    }).catch(() => {});
    showToast('Pedido cancelado');
  } catch (err) {
    showToast(err.message || 'No se pudo cancelar el pedido');
    btn?.classList.remove('is-loading');
  }
}

function handleAssignDriver(orderId, driverId) {
  const patch = driverId
    ? { driverId, driverName: state.drivers[driverId]?.name || '', driverPhone: state.drivers[driverId]?.phone || '' }
    : { driverId: null, driverName: null, driverPhone: null };
  update(ref(db, `orders/${orderId}`), patch)
    .then(() => showToast(driverId ? 'Domiciliario asignado' : 'Asignación quitada'))
    .catch((err) => showToast(err.message || 'No se pudo asignar el domiciliario'));
}

/* ---------- Clientes bloqueados ---------- */
/* Solo el dueño puede marcar/desmarcar (las reglas de RTDB también lo
   exigen); un cajero puede ver la etiqueta "cliente bloqueado" en un
   pedido pero no tiene el botón. Sirve para clientes con muchas
   cancelaciones o pedidos no reclamados: no borra su cuenta ni sus
   pedidos anteriores, solo evita que confirme pedidos nuevos. */
function subscribeCustomerFlags() {
  unsubCustomerFlags = onValue(
    ref(db, 'customerFlags'),
    (snapshot) => {
      const value = snapshot.val() || {};
      state.blockedUids = new Set(
        Object.entries(value)
          .filter(([, v]) => v && v.blocked)
          .map(([uid]) => uid)
      );
      renderOrders();
    },
    errors.logOnValueError('admin:customerFlags')
  );
}

function handleBlockToggle(uid, block, btn) {
  if (state.role !== 'dueno' || !uid) return;
  btn?.classList.add('is-loading');
  const op = block
    ? set(ref(db, `customerFlags/${uid}`), { blocked: true, byEmail: auth.currentUser?.email || 'admin', at: serverTimestamp() })
    : remove(ref(db, `customerFlags/${uid}`));
  op.then(() => showToast(block ? 'Cliente bloqueado' : 'Cliente desbloqueado')).catch((err) => {
    showToast(err.message || 'No se pudo actualizar');
    btn?.classList.remove('is-loading');
  });
}

/* ---------- Tiempo estimado de entrega/recogida ---------- */
function handleSetEta(orderId, minutes) {
  update(ref(db, `orders/${orderId}`), { etaMinutes: minutes, etaSetAt: serverTimestamp() })
    .then(() => showToast(`Tiempo estimado: ${minutes} min`))
    .catch((err) => showToast(err.message || 'No se pudo guardar el tiempo estimado'));
}

/* ---------- Nota interna del cajero ---------- */
/* Nunca se muestra al cliente — solo vive en el panel, para dejar
   contexto a quien atienda después ("cliente llamó, cambió la
   dirección", "pagó por transferencia", etc.). */
function handleSaveInternalNote(orderId, note) {
  update(ref(db, `orders/${orderId}`), { internalNote: note })
    .then(() => showToast('Nota guardada'))
    .catch((err) => showToast(err.message || 'No se pudo guardar la nota'));
}

/* ---------- PWA: instalar el panel como app aparte ---------- */
/* Mismo service worker que la app de clientes (un solo sw.js con
   scope raíz controla todo el sitio) — lo que hace instalable esta
   página en concreto es que ella misma también lo registre (no
   basta con que lo haya hecho index.html en otra visita) más el
   manifest-admin.json enlazado en admin.html, con su propio
   start_url para que abra el panel y no el menú de clientes. */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('No se pudo registrar el service worker:', err);
      });
    });
  }
}

/* Arma un enlace de Google Maps "Cómo llegar" encadenando los puntos
   del recorrido del domiciliario como paradas (hasta 25, la muestra
   pareja si el recorrido tiene más) — sin librería de mapas ni clave
   de API, mismo enlace público usado en toda la app. */
// Mismo umbral que ui.js (GPS_STALE_MS) — si el domiciliario lleva
// más de esto sin mandar una posición nueva, se lo avisamos al
// panel en vez de mostrarle en silencio una ubicación vieja.
const DRIVER_GPS_STALE_MS = 5 * 60 * 1000;
function isDriverLocationStale(loc) {
  const updatedMs = typeof loc?.updatedAt === 'number' ? loc.updatedAt : 0;
  return updatedMs > 0 && Date.now() - updatedMs > DRIVER_GPS_STALE_MS;
}

function trailMapsUrl(trail, current) {
  const points = (Array.isArray(trail) ? trail : [])
    .filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number')
    .map((p) => `${p.lat},${p.lng}`);
  const currentStr = current ? `${current.lat},${current.lng}` : null;
  if (currentStr && points[points.length - 1] !== currentStr) points.push(currentStr);
  if (points.length <= 1) return `https://www.google.com/maps?q=${points[0] || currentStr}`;
  const sampled = points.length > 25 ? sampleEvenly(points, 25) : points;
  return `https://www.google.com/maps/dir/${sampled.join('/')}`;
}

function sampleEvenly(points, max) {
  const step = (points.length - 1) / (max - 1);
  const result = [];
  for (let i = 0; i < max; i++) {
    result.push(points[Math.round(i * step)]);
  }
  return result;
}

/* ---------- Utilidades ---------- */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function showToast(message) {
  const toast = $('admin-toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('is-visible'), 2500);
}

init();
