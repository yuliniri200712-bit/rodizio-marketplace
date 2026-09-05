/* =========================================================
   APP — punto de entrada
   =========================================================
   No contiene reglas de negocio ni HTML: solo conecta los
   módulos (data, cart, auth, ui) entre sí y responde a
   eventos del usuario.
   ========================================================= */

import { CATEGORIES, PRODUCTS, setCategories, setProducts, formatCOP } from './data.js';
import * as cart from './cart.js';
import * as auth from './auth.js';
import * as ui from './ui.js';
import * as favorites from './favorites.js';
import * as notifications from './notifications.js';
import * as catalog from './catalog.js';
import * as settingsApi from './settings.js';
import { watchGlobalErrors } from './errors.js';
import { confirmDialog, pickReasonDialog } from './confirm.js';
import { track } from './analytics.js';
import { FAVORITES_ID } from './ui.js';

const $ = (id) => document.getElementById(id);

const SHIPPING_FEE = 5000;
const MIN_SCHEDULE_MINUTES = 30;
const LAST_PHONE_KEY = 'rodizio_last_phone';

const state = {
  activeCategoryId: CATEGORIES[0].id,
  searchTerm: '',
  deliveryMode: 'domicilio',
  scheduleMode: 'asap',
  currentUser: null,
  favoriteIds: favorites.getFavoriteIds(),
  outOfStockIds: new Set(),
  settings: settingsApi.DEFAULT_SETTINGS,
  portionPeople: 2,
  // Coordenadas exactas SOLO si el cliente usó "usar mi ubicación" en
  // este checkout — se manda con el pedido para que el domiciliario
  // (y el panel) puedan navegar directo al punto, no solo al texto
  // de la dirección. Se borra si edita la dirección a mano después
  // (ya no correspondería con el texto) o al abrir un checkout nuevo.
  pendingCustomerLocation: null,
};

let unsubscribeOrders = null;
let unsubscribeAddresses = null;
let savedAddresses = [];

/* ---------- Arranque ---------- */
function init() {
  watchGlobalErrors('cliente');
  registerServiceWorker();
  hideSplashWhenReady();

  ui.renderCategoryNav(state.activeCategoryId, selectCategory);
  renderMenu();

  catalog.onCategoriesChange((categories) => {
    if (categories.length === 0) return; // aún no hay nada en la base (o se está sembrando)
    setCategories(categories);
    if (!categories.some((c) => c.id === state.activeCategoryId)) {
      state.activeCategoryId = categories[0].id;
    }
    ui.renderCategoryNav(state.activeCategoryId, selectCategory);
    ui.renderBottomNavState(state.activeCategoryId);
    renderMenu();
  });

  catalog.onProductsChange((products) => {
    if (products.length === 0) return; // aún no hay nada en la base (o no se puede leer todavía)
    setProducts(products);
    renderMenu();
  });

  favorites.onFavoritesChange((ids) => {
    state.favoriteIds = ids;
    renderMenu();
  });

  auth.onOutOfStockChange((ids) => {
    state.outOfStockIds = ids;
    renderMenu();
  });

  cart.onCartChange((cartState) => {
    ui.renderCartBadge(cartState);
    ui.renderCartDrawer(cartState, {
      onQtyChange: cart.updateQty,
      onRemove: cart.removeItem,
    });
    ui.renderCheckoutTotals(cartState.subtotal, currentShippingFee());
    renderMinOrderHint(cartState.subtotal);
  });

  auth.onAuthChange((user) => {
    state.currentUser = user;
    ui.renderAccountButton(user);
    if (user) ui.renderProfile(user);
    startOrdersTracking(user);
  });

  settingsApi.onSettingsChange((settings) => {
    state.settings = settings;
    ui.renderClosedBanner(settings);
    ui.renderCallButton();
    ui.renderClosingSoonBanner(settings);
    updateZoneInfo();
  });
  // Revisa el aviso de "cierra pronto" aunque no cambie la configuración
  // (el tiempo sigue corriendo) — cada minuto es suficiente.
  setInterval(() => ui.renderClosingSoonBanner(state.settings), 60000);

  bindHeaderEvents();
  bindProductModalOverlay();
  bindCartEvents();
  bindCheckoutEvents();
  bindAuthEvents();
  bindProfileEvents();
  bindBottomNavEvents();
  bindPortionCalculator();
  bindGeolocation();
}

function renderMenu() {
  ui.renderMenu({
    activeCategoryId: state.activeCategoryId,
    searchTerm: state.searchTerm,
    favoriteIds: state.favoriteIds,
    outOfStockIds: state.outOfStockIds,
    onOpenProduct: openProduct,
    onToggleFavorite: favorites.toggleFavorite,
    onAddAllFavorites: handleAddAllFavorites,
  });
  // El carrusel de destacados no depende de la categoría activa ni de
  // la búsqueda — solo de qué productos tenga insignia y cuáles estén
  // agotados, así que se repinta junto con el menú sin duplicar lógica.
  ui.renderFeaturedCarousel({ outOfStockIds: state.outOfStockIds, onOpenProduct: openProduct });
}

/* "Agregar todos mis favoritos" — accesos rápido para el cliente que
   siempre pide lo mismo, sin tener que abrir cada producto uno por
   uno (los agotados ya vienen filtrados desde ui.js). */
function handleAddAllFavorites(products) {
  products.forEach((product) => cart.addItem(product, 1, ''));
  ui.nudgeCartNav();
  ui.showToast(`${products.length} favorito${products.length === 1 ? '' : 's'} agregado${products.length === 1 ? '' : 's'} al carrito`);
}

function selectCategory(categoryId) {
  state.activeCategoryId = categoryId;
  ui.renderCategoryNav(state.activeCategoryId, selectCategory);
  ui.renderBottomNavState(state.activeCategoryId);
  renderMenu();
}

/* ---------- Navegación inferior ---------- */
function bindBottomNavEvents() {
  $('nav-inicio').addEventListener('click', () => {
    state.searchTerm = '';
    $('search-input').value = '';
    renderMenu();
    if (state.activeCategoryId === FAVORITES_ID) {
      selectCategory(CATEGORIES[0].id);
    }
    $('menu-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('nav-favoritos').addEventListener('click', () => {
    selectCategory(FAVORITES_ID);
    $('menu-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('nav-carrito').addEventListener('click', () => openCartDrawer());

  $('nav-perfil').addEventListener('click', () => {
    if (state.currentUser) {
      openProfileDrawer();
    } else {
      ui.toggleSheet('auth-modal', true);
    }
  });
}

/* ---------- Header: búsqueda + cuenta ---------- */
function bindHeaderEvents() {
  // La barra de búsqueda ya está siempre visible bajo el hero — este
  // botón solo la lleva a la vista y le pone el foco, útil si el
  // cliente ya bajó por el menú.
  $('btn-search-toggle').addEventListener('click', () => {
    $('search-bar').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('search-input').focus();
  });

  $('search-input').addEventListener('input', (e) => {
    state.searchTerm = e.target.value;
    renderMenu();
  });

  $('btn-account').addEventListener('click', () => {
    if (state.currentUser) {
      openProfileDrawer();
    } else {
      ui.toggleSheet('auth-modal', true);
    }
  });

  // Números fijos del restaurante (a pedido del usuario, no salen de
  // settings.restaurantPhone) — el fijo tiene dos líneas, así que en
  // vez de un solo confirmDialog se usa pickReasonDialog para que el
  // cliente elija a cuál de las dos llamar.
  const RESTAURANT_PHONE_OPTIONS = [
    { label: '(607) 596 7644', tel: '6075967644' },
    { label: '(607) 588 8080', tel: '6075888080' },
  ];
  const RESTAURANT_WHATSAPP_NUMBER = '573143938235';

  $('btn-call-restaurant').addEventListener('click', (e) => {
    e.preventDefault();
    pickReasonDialog(
      '¿A cuál número quieres llamar?',
      RESTAURANT_PHONE_OPTIONS.map((opt) => opt.label)
    ).then((chosenLabel) => {
      const chosen = RESTAURANT_PHONE_OPTIONS.find((opt) => opt.label === chosenLabel);
      if (chosen) window.location.href = `tel:${chosen.tel}`;
    });
  });

  $('btn-whatsapp-restaurant').addEventListener('click', (e) => {
    e.preventDefault();
    confirmDialog('¿Escribir al restaurante por WhatsApp?', {
      confirmLabel: 'Sí, abrir WhatsApp',
      cancelLabel: 'Cancelar',
      danger: false,
    }).then((ok) => {
      if (ok) window.open(`https://wa.me/${RESTAURANT_WHATSAPP_NUMBER}`, '_blank', 'noopener,noreferrer');
    });
  });
}

/* ---------- Modal de producto ---------- */
function openProduct(product, isOutOfStock) {
  track('view_item', {
    currency: 'COP',
    value: product.price,
    items: [{ item_id: product.id, item_name: product.name, price: product.price }],
  });

  ui.openProductModal(product, isOutOfStock, {
    currentUser: state.currentUser,
    onAdd: (p, qty, notes) => {
      cart.addItem(p, qty, notes);
      ui.toggleSheet('product-modal', false);
      ui.nudgeCartNav();
      ui.showToast(`${p.name} agregado al carrito`);
      track('add_to_cart', {
        currency: 'COP',
        value: p.price * qty,
        items: [{ item_id: p.id, item_name: p.name, price: p.price, quantity: qty }],
      });
    },
  });
}

function bindProductModalOverlay() {
  $('btn-close-modal').addEventListener('click', () => ui.toggleSheet('product-modal', false));
  $('btn-close-order-detail').addEventListener('click', () => ui.toggleSheet('order-detail-modal', false));
}

/* ---------- Carrito ---------- */
function bindCartEvents() {
  $('btn-close-cart').addEventListener('click', () => closeCartDrawer());

  $('overlay').addEventListener('click', () => {
    closeCartDrawer();
    ui.toggleSheet('product-modal', false);
    ui.toggleSheet('auth-modal', false);
    ui.toggleSheet('order-detail-modal', false);
    closeProfileDrawer();
  });

  $('btn-go-checkout').addEventListener('click', () => {
    if (state.settings.isOpen === false) {
      ui.showToast(state.settings.closedMessage || 'Estamos cerrados en este momento.');
      return;
    }
    if (!state.currentUser) {
      ui.toggleSheet('auth-modal', true);
      ui.showToast('Inicia sesión para continuar con tu pedido');
      return;
    }
    showCheckoutStep();
  });
}

function openCartDrawer() {
  showCartStep();
  ui.toggleSheet('cart-drawer', true);
}

function closeCartDrawer() {
  ui.toggleSheet('cart-drawer', false);
  if (unsubscribeAddresses) {
    unsubscribeAddresses();
    unsubscribeAddresses = null;
  }
}

function showCartStep() {
  $('cart-drawer-title').textContent = 'Tu pedido';
  $('cart-view').hidden = false;
  $('cart-footer').hidden = false;
  $('checkout-view').hidden = true;
  $('checkout-footer').hidden = true;
}

function showCheckoutStep() {
  $('cart-drawer-title').textContent = 'Datos de entrega';
  $('cart-view').hidden = true;
  $('cart-footer').hidden = true;
  $('checkout-view').hidden = false;
  $('checkout-footer').hidden = false;
  state.pendingCustomerLocation = null; // checkout nuevo: no arrastrar la ubicación de un pedido anterior
  const { subtotal, items } = cart.getState();
  ui.renderCheckoutTotals(subtotal, currentShippingFee());
  renderMinOrderHint(subtotal);
  setScheduleTimeMin();
  prefillLastPhone();
  updateZoneInfo();
  track('begin_checkout', {
    currency: 'COP',
    value: subtotal,
    items: items.map((i) => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.qty })),
  });

  if (unsubscribeAddresses) unsubscribeAddresses();
  unsubscribeAddresses = auth.onMyAddressesChange((addresses) => {
    savedAddresses = addresses;
    ui.renderSavedAddresses(addresses, {
      onSelect: (addr) => {
        $('ck-address').value = addr.address;
        $('ck-reference').value = addr.reference || '';
        $('ck-save-address').checked = false;
        updateZoneInfo();
      },
      onDelete: (addr) => auth.deleteAddress(addr.id).catch(() => {}),
    });
  });
}

/* ---------- Programar entrega ---------- */
function setScheduleTimeMin() {
  const min = new Date(Date.now() + MIN_SCHEDULE_MINUTES * 60000);
  $('ck-schedule-time').min = `${String(min.getHours()).padStart(2, '0')}:${String(min.getMinutes()).padStart(2, '0')}`;
}

function resetScheduleMode() {
  state.scheduleMode = 'asap';
  document.querySelectorAll('#schedule-mode button').forEach((b) => b.classList.toggle('is-active', b.dataset.schedule === 'asap'));
  $('schedule-time-field').hidden = true;
  $('ck-schedule-time').value = '';
}

/* Devuelve un Date si el usuario programó una hora válida, o null
   si eligió "lo antes posible". Muestra un toast y devuelve
   `undefined` si la hora elegida no es válida todavía. */
function resolveScheduledFor() {
  if (state.scheduleMode !== 'later') return null;

  const timeValue = $('ck-schedule-time').value;
  if (!timeValue) {
    ui.showToast('Elige la hora en que quieres tu pedido');
    return undefined;
  }
  const [h, m] = timeValue.split(':').map(Number);
  const scheduled = new Date();
  scheduled.setHours(h, m, 0, 0);
  if (scheduled.getTime() < Date.now() + (MIN_SCHEDULE_MINUTES - 5) * 60000) {
    ui.showToast(`Elige una hora al menos ${MIN_SCHEDULE_MINUTES} minutos después de ahora`);
    return undefined;
  }
  return scheduled;
}

/* ---------- Checkout ---------- */
/* Domicilio siempre calculado con lo que haya configurado el
   dueño en el panel: si la dirección coincide con una zona con
   costo propio, ese costo; si no, el costo por defecto. */
function currentShippingFee() {
  if (state.deliveryMode === 'recoger') return 0;
  const zone = settingsApi.matchZone($('ck-address').value.trim(), state.settings.coverageZones);
  if (zone) return zone.fee;
  return state.settings.defaultShippingFee ?? SHIPPING_FEE;
}

/* Se llama cada vez que cambia la dirección o el modo de entrega:
   recalcula la zona, muestra el aviso correspondiente y refresca
   el total con el costo de domicilio que corresponda. */
function updateZoneInfo() {
  const zone = settingsApi.matchZone($('ck-address').value.trim(), state.settings.coverageZones);
  ui.renderZoneInfo({
    deliveryMode: state.deliveryMode,
    zone,
    restrictToZones: state.settings.restrictToZones,
    coverageZones: state.settings.coverageZones,
  });
  const { subtotal } = cart.getState();
  ui.renderCheckoutTotals(subtotal, currentShippingFee());
  renderMinOrderHint(subtotal);
}

/* Si falta para el pedido mínimo a domicilio, sugiere el producto
   disponible más barato que alcance a cerrar la diferencia en un
   solo agregado (si ninguno alcanza solo, sugiere el disponible más
   caro — el que más acerca) en vez de dejar al cliente adivinar qué
   más pedir. */
function bestMinOrderSuggestion(missing) {
  const available = PRODUCTS.filter((p) => !state.outOfStockIds.has(p.id)).sort((a, b) => a.price - b.price);
  if (available.length === 0) return null;
  return available.find((p) => p.price >= missing) || available[available.length - 1];
}

function renderMinOrderHint(subtotal) {
  const minOrder = state.deliveryMode === 'domicilio' ? state.settings.minOrderDomicilio || 0 : 0;
  const missing = minOrder - subtotal;
  ui.renderMinOrderHint(missing > 0 ? missing : 0, missing > 0 ? bestMinOrderSuggestion(missing) : null);
}

/* Un cliente que ya pidió antes no debería tener que volver a
   escribir su teléfono cada vez — lo recordamos localmente (no es
   dato sensible como una contraseña) y lo dejamos listo, pero sin
   pisar lo que ya haya escrito en este mismo formulario. */
function prefillLastPhone() {
  const field = $('ck-phone');
  if (field.value.trim()) return;
  try {
    const saved = localStorage.getItem(LAST_PHONE_KEY);
    if (saved) field.value = saved;
  } catch {
    // localStorage no disponible: sin prellenado, no rompe el checkout.
  }
}

function rememberPhone(phone) {
  try {
    localStorage.setItem(LAST_PHONE_KEY, phone);
  } catch {
    // localStorage no disponible: no pasa nada, solo no se recuerda.
  }
}

/* Además del toast, resalta en rojo el campo que falta y le pone
   el foco — en el celular es fácil no notar solo el mensaje flotante. */
function markFieldError(field) {
  field.classList.add('field-error');
  field.focus();
  field.addEventListener('input', () => field.classList.remove('field-error'), { once: true });
}

function bindCheckoutEvents() {
  const modeButtons = document.querySelectorAll('#delivery-mode button');
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      modeButtons.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.deliveryMode = btn.dataset.mode;
      $('address-fields').style.display = state.deliveryMode === 'recoger' ? 'none' : 'block';
      updateZoneInfo();
    });
  });

  $('ck-address').addEventListener('input', () => {
    // Si edita la dirección a mano, las coordenadas exactas que se
    // hayan capturado (por geolocalización o dirección guardada) ya
    // no corresponden con lo que escribió — se descartan.
    state.pendingCustomerLocation = null;
    updateZoneInfo();
  });

  $('ck-save-address').addEventListener('change', () => {
    $('ck-address-label-field').hidden = !$('ck-save-address').checked;
  });

  const scheduleButtons = document.querySelectorAll('#schedule-mode button');
  scheduleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      scheduleButtons.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.scheduleMode = btn.dataset.schedule;
      $('schedule-time-field').hidden = state.scheduleMode !== 'later';
    });
  });

  $('btn-confirm-order').addEventListener('click', handleConfirmOrder);
}

async function handleConfirmOrder() {
  const { items, subtotal } = cart.getState();
  if (items.length === 0) return;

  if (state.settings.isOpen === false) {
    ui.showToast(state.settings.closedMessage || 'Estamos cerrados en este momento.');
    return;
  }

  const blocked = await auth.isCurrentUserBlocked();
  if (blocked) {
    ui.showToast('No podemos procesar tu pedido en este momento. Llámanos para más información.');
    return;
  }

  const phone = $('ck-phone').value.trim();
  const address = $('ck-address').value.trim();

  if (!phone) {
    ui.showToast('Ingresa un teléfono de contacto');
    markFieldError($('ck-phone'));
    return;
  }
  if (state.deliveryMode === 'domicilio' && !address) {
    ui.showToast('Ingresa la dirección de entrega');
    markFieldError($('ck-address'));
    return;
  }

  const zone = settingsApi.matchZone(address, state.settings.coverageZones);
  if (
    state.deliveryMode === 'domicilio' &&
    state.settings.restrictToZones &&
    (state.settings.coverageZones || []).length > 0 &&
    !zone
  ) {
    ui.showToast('Esa dirección está fuera de nuestra zona de cobertura — revísala o llámanos');
    markFieldError($('ck-address'));
    return;
  }

  const minOrder = state.deliveryMode === 'domicilio' ? state.settings.minOrderDomicilio || 0 : 0;
  if (minOrder > 0 && subtotal < minOrder) {
    ui.showToast(`El pedido mínimo a domicilio es ${formatCOP(minOrder)}`);
    return;
  }

  const scheduledFor = resolveScheduledFor();
  if (scheduledFor === undefined) return; // hora inválida, ya se mostró el toast

  const confirmBtn = $('btn-confirm-order');
  const confirmBtnLabel = confirmBtn.textContent;
  confirmBtn.disabled = true;
  confirmBtn.classList.add('is-loading');
  confirmBtn.textContent = 'Enviando pedido…';

  try {
    const shipping = currentShippingFee();
    const total = Math.max(0, subtotal + shipping);
    const orderId = await auth.placeOrder({
      items,
      subtotal,
      shipping,
      total,
      deliveryMode: state.deliveryMode,
      address: state.deliveryMode === 'domicilio' ? address : null,
      // Solo va si el cliente usó "usar mi ubicación" y no editó la
      // dirección después — nunca se manda una ubicación que no
      // corresponda con el texto que el cliente ve y confirma.
      customerLocation: state.deliveryMode === 'domicilio' ? state.pendingCustomerLocation : null,
      reference: $('ck-reference').value.trim(),
      phone,
      scheduledFor,
    });

    track('purchase', {
      transaction_id: orderId,
      currency: 'COP',
      value: total,
      shipping,
      items: items.map((i) => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.qty })),
    });

    if (state.deliveryMode === 'domicilio' && $('ck-save-address').checked) {
      const alreadySaved = savedAddresses.some((a) => a.address === address);
      if (!alreadySaved) {
        auth
          .saveAddress({
            address,
            reference: $('ck-reference').value.trim(),
            label: $('ck-address-label').value.trim(),
          })
          .catch(() => {});
      }
    }

    rememberPhone(phone);
    state.pendingCustomerLocation = null;
    cart.clearCart();
    resetScheduleMode();
    $('ck-save-address').checked = false;
    $('ck-address-label-field').hidden = true;
    $('ck-address-label').value = '';

    // Momento de "sí funcionó de verdad": check animado en el botón
    // antes de cerrar el carrito, en vez de saltar directo al toast —
    // un envío exitoso se siente más premium con un remate visual
    // propio que confundido con cualquier otro toast de la app.
    confirmBtn.classList.remove('is-loading');
    confirmBtn.classList.add('is-success');
    confirmBtn.textContent = '¡Pedido confirmado!';
    await new Promise((resolve) => setTimeout(resolve, 650));

    closeCartDrawer();
    ui.showToast('¡Pedido confirmado! Aquí puedes ver cómo va.');
    openProfileDrawer();
  } catch (error) {
    ui.showToast(error.message || 'No se pudo enviar el pedido');
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.classList.remove('is-loading', 'is-success');
    confirmBtn.textContent = confirmBtnLabel;
  }
}

/* ---------- Autenticación ---------- */
const CONSENT_KEY = 'rodizio_consent_accepted';

function bindAuthEvents() {
  $('btn-close-auth').addEventListener('click', () => ui.toggleSheet('auth-modal', false));

  // La casilla de tratamiento de datos bloquea el botón de Google
  // hasta que se marque — una vez aceptada en este dispositivo, no
  // hace falta volver a marcarla en próximos inicios de sesión.
  const consentCheckbox = $('auth-consent-checkbox');
  try {
    if (localStorage.getItem(CONSENT_KEY) === 'true') {
      consentCheckbox.checked = true;
      $('btn-google-signin').disabled = false;
    }
  } catch {
    // localStorage no disponible: simplemente pide marcarla cada vez.
  }
  consentCheckbox.addEventListener('change', (e) => {
    $('btn-google-signin').disabled = !e.target.checked;
    if (e.target.checked) {
      try {
        localStorage.setItem(CONSENT_KEY, 'true');
      } catch {
        // No pasa nada si no se puede recordar — solo pedirá marcarla de nuevo.
      }
    }
  });

  $('btn-google-signin').addEventListener('click', async () => {
    if (!consentCheckbox.checked) return; // el botón ya debería estar disabled, doble seguro
    try {
      await auth.signIn();
      auth.recordConsent('cliente');
      ui.toggleSheet('auth-modal', false);
      ui.showToast('¡Sesión iniciada!');
    } catch (error) {
      ui.showToast(error.message);
    }
  });
}

/* ---------- Perfil ---------- */
function bindProfileEvents() {
  $('btn-close-profile').addEventListener('click', () => closeProfileDrawer());
  $('btn-signout').addEventListener('click', async () => {
    if (!(await confirmDialog('¿Seguro que quieres cerrar sesión?'))) return;
    await auth.signOutUser();
    closeProfileDrawer();
    ui.showToast('Sesión cerrada');
  });
  $('btn-enable-push').addEventListener('click', handleEnablePush);
}

let lastMyOrders = [];
let ordersFreshnessInterval = null;

function renderMyOrders() {
  ui.renderOrdersList(lastMyOrders, {
    onRepeat: handleRepeatOrder,
    onCancel: handleCancelOrder,
    onDetail: ui.openOrderDetailModal,
    onRateDriver: handleRateDriver,
  });
}

const DRIVER_RATING_OPTIONS = [
  '★☆☆☆☆ Muy malo',
  '★★☆☆☆ Malo',
  '★★★☆☆ Regular',
  '★★★★☆ Bueno',
  '★★★★★ Excelente',
];

async function handleRateDriver(order) {
  const choice = await pickReasonDialog(`¿Cómo estuvo la entrega de ${order.driverName || 'tu domiciliario'}?`, DRIVER_RATING_OPTIONS);
  if (!choice) return;
  const rating = DRIVER_RATING_OPTIONS.indexOf(choice) + 1;
  try {
    await auth.rateDriver(order.id, order.driverId, rating);
    ui.showToast('¡Gracias por calificar a tu domiciliario!');
  } catch (err) {
    ui.showToast(err.message || 'No se pudo enviar la calificación');
  }
}

/* Suscripción a "mis pedidos" — corre TODA la sesión mientras haya
   alguien logueado (no solo mientras el drawer de perfil está
   abierto), porque la alimenta tanto el drawer como la franja de
   "pedido en curso" (#active-order-bar) que se ve desde cualquier
   pantalla. Repinta cada 30s aunque no llegue un cambio de Firebase,
   para que avisos que dependen del tiempo (GPS perdido) aparezcan
   sin depender de que llegue un dato nuevo. */
function startOrdersTracking(user) {
  if (unsubscribeOrders) {
    unsubscribeOrders();
    unsubscribeOrders = null;
  }
  if (ordersFreshnessInterval) {
    clearInterval(ordersFreshnessInterval);
    ordersFreshnessInterval = null;
  }
  if (!user) {
    lastMyOrders = [];
    ui.renderActiveOrderBar([], null);
    return;
  }
  unsubscribeOrders = auth.onMyOrdersChange((orders) => {
    lastMyOrders = orders;
    renderMyOrders();
    ui.renderActiveOrderBar(orders, openProfileDrawer);
  });
  ordersFreshnessInterval = setInterval(() => {
    renderMyOrders();
    ui.renderActiveOrderBar(lastMyOrders, openProfileDrawer);
  }, 30000);
}

function openProfileDrawer() {
  ui.renderProfile(state.currentUser);
  ui.toggleSheet('profile-drawer', true);
  updatePushButtonState();
  renderMyOrders();
}

/* Cancelar solo lo deja el botón visible los primeros minutos
   (ver CANCEL_WINDOW_MINUTES en ui.js) — aquí solo se ejecuta. */
async function handleCancelOrder(order) {
  try {
    await auth.cancelOrder(order.id);
    ui.showToast('Pedido cancelado');
  } catch (error) {
    ui.showToast(error.message || 'No se pudo cancelar el pedido');
  }
}

/* ---------- Notificaciones push ---------- */
async function updatePushButtonState() {
  const btn = $('btn-enable-push');
  const label = $('btn-enable-push-label');
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
    label.textContent = 'Notificaciones activadas';
  } else if (permission === 'denied') {
    btn.classList.remove('is-enabled');
    btn.disabled = true;
    label.textContent = 'Notificaciones bloqueadas (actívalas desde el navegador)';
  } else {
    btn.classList.remove('is-enabled');
    btn.disabled = false;
    label.textContent = 'Activar notificaciones de pedidos';
  }
}

async function handleEnablePush() {
  const btn = $('btn-enable-push');
  const label = $('btn-enable-push-label');
  btn.disabled = true;
  label.textContent = 'Activando…';
  try {
    await notifications.enablePushNotifications();
    ui.showToast('¡Notificaciones activadas!');
  } catch (error) {
    ui.showToast(error.message || 'No se pudieron activar las notificaciones');
  } finally {
    updatePushButtonState();
  }
}

function closeProfileDrawer() {
  ui.toggleSheet('profile-drawer', false);
  // La suscripción a pedidos sigue corriendo — la usa la franja de
  // "pedido en curso" aunque el drawer esté cerrado (ver
  // startOrdersTracking).
}

function handleRepeatOrder(order) {
  (order.items || []).forEach((item) => {
    cart.addItem(item, item.qty, item.notes || '');
  });
  closeProfileDrawer();
  ui.showToast('Pedido agregado al carrito');
  openCartDrawer();
}

/* ---------- Calculadora de porciones ---------- */
/* Heurística simple (no hay peso por producto en el menú): un
   corte de la parrilla rinde cómodo para 2-3 personas compartiendo
   rodízio. Solo orienta al cliente, no reemplaza el menú. */
function bindPortionCalculator() {
  $('portion-minus').addEventListener('click', () => setPortionPeople(state.portionPeople - 1));
  $('portion-plus').addEventListener('click', () => setPortionPeople(state.portionPeople + 1));
  $('portion-suggestion').addEventListener('click', () => {
    selectCategory('cortes');
    $('menu-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  renderPortionSuggestion();
}

function setPortionPeople(people) {
  state.portionPeople = Math.min(20, Math.max(1, people));
  renderPortionSuggestion();
}

function renderPortionSuggestion() {
  $('portion-people').textContent = state.portionPeople;
  const cuts = Math.max(1, Math.ceil(state.portionPeople * 0.75));
  const cutsPhrase = cuts === 1 ? '1 corte' : `unos ${cuts} cortes`;
  $('portion-suggestion').textContent =
    `Recomendamos ${cutsPhrase} de la parrilla, más acompañamientos y bebida. Toca para ver los cortes.`;
}

/* ---------- Ubicación ---------- */
/* Detecta la posición del navegador y la convierte en una
   dirección legible con la API pública de OpenStreetMap (no
   necesita clave). El cliente siempre debe revisarla antes de
   confirmar — un reverse-geocoding automático nunca es 100% exacto. */
function bindGeolocation() {
  $('btn-use-location').addEventListener('click', handleUseLocation);
}

function handleUseLocation() {
  const btn = $('btn-use-location');
  if (!navigator.geolocation) {
    ui.showToast('Tu navegador no soporta detectar la ubicación');
    return;
  }
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const { latitude, longitude } = position.coords;
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`
        );
        if (!response.ok) throw new Error('No se pudo consultar la dirección');
        const data = await response.json();
        if (data && data.display_name) {
          $('ck-address').value = data.display_name;
          // Guarda también las coordenadas crudas (no solo el texto):
          // así el domiciliario puede navegar directo al punto exacto
          // en vez de depender de que el texto se geocodifique bien.
          state.pendingCustomerLocation = { lat: latitude, lng: longitude };
          updateZoneInfo();
          ui.showToast('Dirección detectada — revísala antes de confirmar');
        } else {
          ui.showToast('No pudimos detectar tu dirección exacta, escríbela a mano');
        }
      } catch {
        ui.showToast('No pudimos obtener tu dirección, escríbela a mano');
      } finally {
        btn.disabled = false;
      }
    },
    () => {
      ui.showToast('No pudimos acceder a tu ubicación (revisa el permiso del navegador)');
      btn.disabled = false;
    },
    { timeout: 8000 }
  );
}

/* ---------- PWA: service worker + splash ---------- */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('No se pudo registrar el service worker:', err);
      });
    });
  }
}

function hideSplashWhenReady() {
  window.addEventListener('load', () => {
    setTimeout(() => $('splash').classList.add('is-hidden'), 500);
  });
}

init();
