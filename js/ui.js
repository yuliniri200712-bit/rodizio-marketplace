/* =========================================================
   UI — funciones puras de renderizado
   =========================================================
   Este módulo solo lee estado y pinta HTML. No conoce
   Firebase ni el carrito directamente: recibe todo por
   parámetros desde app.js, que es quien orquesta.
   ========================================================= */

import { CATEGORIES, PRODUCTS, formatCOP } from './data.js';

const $ = (id) => document.getElementById(id);

export const FAVORITES_ID = '__favoritos__';

/* --- Categorías ---
   "Favoritos" ya no es una pestaña aquí: se accede desde la
   navegación inferior (ver renderBottomNavState). */
export function renderCategoryNav(activeId, onSelect) {
  const nav = $('category-nav');
  nav.innerHTML = '';
  CATEGORIES.forEach((cat) => {
    const btn = document.createElement('button');
    btn.className = 'category-tab' + (cat.id === activeId ? ' is-active' : '');
    btn.textContent = cat.name;
    btn.addEventListener('click', () => onSelect(cat.id));
    nav.appendChild(btn);
  });
}

/* Resalta "Inicio" o "Favoritos" en la barra inferior según la
   vista actual del menú. */
export function renderBottomNavState(activeCategoryId) {
  $('nav-inicio').classList.toggle('is-active', activeCategoryId !== FAVORITES_ID);
  $('nav-favoritos').classList.toggle('is-active', activeCategoryId === FAVORITES_ID);
}

/* --- Grilla de productos (una sección por categoría visible) --- */
export function renderMenu({ activeCategoryId, searchTerm, favoriteIds, outOfStockIds, onOpenProduct, onToggleFavorite, onAddAllFavorites }) {
  const main = $('menu-content');
  main.innerHTML = '';

  const term = (searchTerm || '').trim().toLowerCase();
  const favorites = favoriteIds || new Set();
  const outOfStock = outOfStockIds || new Set();

  // Índice continuo a través de TODAS las tarjetas que se pintan en
  // esta llamada (no reiniciado por sección) — así la animación de
  // entrada (rise-in, ver animations.css) se siente como una sola
  // cascada de arriba a abajo en vez de reiniciarse en cada categoría.
  let cardIndex = 0;

  function buildSection(title, products, countLabel) {
    const section = document.createElement('section');
    section.className = 'menu-section';
    section.innerHTML = `
      <div class="menu-section-title">
        <h2>${title}</h2>
        <span>${countLabel}</span>
      </div>
      <div class="product-grid"></div>
    `;
    const grid = section.querySelector('.product-grid');

    products.forEach((product) => {
      const isFav = favorites.has(product.id);
      const isOut = outOfStock.has(product.id);
      const card = document.createElement('div');
      card.className = 'product-card' + (isOut ? ' is-out-of-stock' : '');
      card.style.setProperty('--i', cardIndex);
      cardIndex += 1;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.innerHTML = `
        <div class="product-thumb">
          <img src="${product.image}" alt="" loading="lazy" onload="this.classList.add('is-loaded')" onerror="this.style.visibility='hidden'" />
          <button type="button" class="fav-toggle${isFav ? ' is-active' : ''}" aria-label="${isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}" aria-pressed="${isFav}">
            ${heartSvg(isFav)}
          </button>
        </div>
        <div class="product-info">
          ${isOut ? `<span class="product-badge product-badge-out">Agotado</span><br/>` : product.badge ? `<span class="product-badge">${product.badge}</span><br/>` : ''}
          <div class="product-name">${product.name}</div>
          <div class="product-desc">${product.description}</div>
          <div class="product-footer">
            <span class="price">${formatCOP(product.price)}</span>
          </div>
        </div>
        <span class="add-btn" aria-hidden="true">+</span>
      `;
      card.addEventListener('click', () => onOpenProduct(product, isOut));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenProduct(product);
        }
      });
      card.querySelector('.fav-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        onToggleFavorite(product.id);
      });
      grid.appendChild(card);
    });

    main.appendChild(section);
  }

  if (!term && activeCategoryId === FAVORITES_ID) {
    const products = PRODUCTS.filter((p) => favorites.has(p.id));
    if (products.length === 0) {
      main.innerHTML = `
        <div class="empty-state">
          <h3>Aún no tienes favoritos</h3>
          <p>Toca el corazón de un producto para guardarlo aquí.</p>
        </div>
      `;
      return;
    }
    const availableProducts = products.filter((p) => !outOfStock.has(p.id));
    if (onAddAllFavorites && availableProducts.length > 0) {
      const bar = document.createElement('div');
      bar.className = 'add-all-favorites-bar';
      bar.innerHTML = `<button type="button" class="btn btn-ghost" id="btn-add-all-favorites">Agregar todos mis favoritos al carrito (${availableProducts.length})</button>`;
      main.appendChild(bar);
      bar.querySelector('button').addEventListener('click', () => onAddAllFavorites(availableProducts));
    }
    buildSection('Favoritos', products, `${products.length} guardados`);
    return;
  }

  const categoriesToShow = term
    ? CATEGORIES
    : CATEGORIES.filter((c) => c.id === activeCategoryId);

  let totalMatches = 0;

  categoriesToShow.forEach((cat) => {
    let products = PRODUCTS.filter((p) => p.categoryId === cat.id);
    if (term) {
      products = products.filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          p.description.toLowerCase().includes(term)
      );
    }
    if (products.length === 0) return;
    totalMatches += products.length;
    buildSection(cat.name, products, `${products.length} opciones`);
  });

  if (term && totalMatches === 0) {
    main.innerHTML = `
      <div class="empty-state">
        <h3>Sin resultados para "${searchTerm}"</h3>
        <p>Prueba con otro corte, bebida o postre.</p>
      </div>
    `;
  }
}

/* --- "Lo más pedido": carrusel con los productos que el panel marcó
   con una insignia (ej. "Más pedido") — nunca inventa destacados, si
   nadie tiene insignia la sección completa se oculta. */
export function renderFeaturedCarousel({ outOfStockIds, onOpenProduct }) {
  const section = $('featured-section');
  const scroll = $('featured-scroll');
  const outOfStock = outOfStockIds || new Set();
  const featured = PRODUCTS.filter((p) => p.badge).slice(0, 10);

  if (featured.length === 0) {
    section.hidden = true;
    scroll.innerHTML = '';
    return;
  }

  section.hidden = false;
  scroll.innerHTML = featured
    .map((product) => {
      const isOut = outOfStock.has(product.id);
      return `
      <div class="featured-card${isOut ? ' is-out-of-stock' : ''}" role="button" tabindex="0" data-product-id="${product.id}">
        <div class="featured-thumb">
          <img src="${product.image}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
          <span class="featured-badge">${escapeHtml(isOut ? 'Agotado' : product.badge)}</span>
        </div>
        <div class="featured-name">${escapeHtml(product.name)}</div>
        <div class="featured-price">${formatCOP(product.price)}</div>
      </div>`;
    })
    .join('');

  scroll.querySelectorAll('.featured-card').forEach((card) => {
    const open = () => {
      const product = featured.find((p) => p.id === card.dataset.productId);
      if (product) onOpenProduct(product, outOfStock.has(product.id));
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });
}

function heartSvg(filled) {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}"><path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.099 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/* --- Modal de producto --- */
export function openProductModal(product, isOutOfStock, { onAdd }) {
  $('modal-product-name').textContent = product.name;
  $('modal-product-desc').textContent = product.description;
  let qty = 1;
  $('modal-qty-value').textContent = qty;
  $('modal-notes').value = '';
  updateModalTotal(product.price, qty);

  const minus = $('modal-qty-minus');
  const plus = $('modal-qty-plus');
  const addBtn = $('btn-add-to-cart');

  addBtn.disabled = !!isOutOfStock;
  $('modal-out-of-stock-notice').hidden = !isOutOfStock;

  const onMinus = () => {
    qty = Math.max(1, qty - 1);
    $('modal-qty-value').textContent = qty;
    updateModalTotal(product.price, qty);
  };
  const onPlus = () => {
    qty += 1;
    $('modal-qty-value').textContent = qty;
    updateModalTotal(product.price, qty);
  };
  const onAddClick = () => {
    onAdd(product, qty, $('modal-notes').value.trim());
    cleanup();
  };

  function cleanup() {
    minus.removeEventListener('click', onMinus);
    plus.removeEventListener('click', onPlus);
    addBtn.removeEventListener('click', onAddClick);
  }

  if (isOutOfStock) {
    minus.disabled = true;
    plus.disabled = true;
  } else {
    minus.disabled = false;
    plus.disabled = false;
    minus.addEventListener('click', onMinus);
    plus.addEventListener('click', onPlus);
    addBtn.addEventListener('click', onAddClick);
  }

  toggleSheet('product-modal', true);
  return cleanup;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updateModalTotal(price, qty) {
  $('modal-total-price').textContent = formatCOP(price * qty);
}

/* --- Carrito: badge en la nav inferior + lista --- */
export function renderCartBadge(state) {
  const badge = $('bottom-nav-cart-badge');
  badge.textContent = state.count;
  badge.hidden = state.count === 0;
}

export function renderCartDrawer(state, { onQtyChange, onRemove }) {
  const list = $('cart-items-list');
  list.innerHTML = '';

  if (state.items.length === 0) {
    list.innerHTML = `<div class="empty-state"><h3>Tu carrito está vacío</h3><p>Agrega un corte de la parrilla para empezar.</p></div>`;
  }

  state.items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'cart-item';
    li.innerHTML = `
      <div class="cart-item-thumb"><img src="${item.image}" alt="" onerror="this.style.visibility='hidden'" /></div>
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.name)}</div>
        <div class="cart-item-unit">${formatCOP(item.price)} c/u${item.notes ? ' · ' + escapeHtml(item.notes) : ''}</div>
        <div class="cart-item-controls">
          <div class="qty-stepper">
            <button class="btn-minus" aria-label="Restar">−</button>
            <span>${item.qty}</span>
            <button class="btn-plus" aria-label="Sumar">+</button>
          </div>
          <span class="price">${formatCOP(item.price * item.qty)}</span>
        </div>
      </div>
    `;
    li.querySelector('.btn-minus').addEventListener('click', () =>
      onQtyChange(item.id, item.notes, item.qty - 1)
    );
    li.querySelector('.btn-plus').addEventListener('click', () =>
      onQtyChange(item.id, item.notes, item.qty + 1)
    );
    list.appendChild(li);
  });

  $('cart-subtotal').textContent = formatCOP(state.subtotal);
  $('btn-go-checkout').disabled = state.items.length === 0;
}

/* --- Checkout: totales --- */
export function renderCheckoutTotals(subtotal, shipping) {
  $('ck-subtotal').textContent = formatCOP(subtotal);
  $('ck-shipping').textContent = formatCOP(shipping);
  $('ck-total').textContent = formatCOP(Math.max(0, subtotal + shipping));
}

/* Si falta para el pedido mínimo a domicilio, en vez de solo decir
   "te falta" sugiere un producto concreto (el más barato disponible
   que alcance a cerrar la diferencia en un solo agregado) — así el
   cliente no tiene que adivinar qué más pedir. `missing` en null/0
   oculta el aviso. */
export function renderMinOrderHint(missing, suggestion) {
  const el = $('min-order-hint');
  if (!missing || missing <= 0) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = suggestion
    ? `Te faltan ${formatCOP(missing)} para el pedido mínimo — agrega "${suggestion.name}" (${formatCOP(suggestion.price)}) y listo.`
    : `Te faltan ${formatCOP(missing)} para el pedido mínimo a domicilio.`;
}

/* --- Configuración del negocio (settings) --- */
export function renderClosedBanner(settings) {
  const banner = $('closed-banner');
  banner.hidden = settings.isOpen !== false;
  if (!banner.hidden) {
    $('closed-banner-text').textContent = settings.closedMessage || 'Estamos cerrados en este momento.';
  }
}

export function renderCallButton() {
  // Los números de llamar/WhatsApp del restaurante son fijos (a pedido
  // del usuario, no salen de settings.restaurantPhone) — el href real
  // lo decide app.js según lo que el cliente elija/confirme, así que
  // aquí solo nos aseguramos de que ambos botones estén visibles.
  $('btn-call-restaurant').hidden = false;
  $('btn-whatsapp-restaurant').hidden = false;
}

/* Aviso de "cerramos pronto" — separado del banner de "cerrado" (ese
   ya cubre el caso de que isOpen esté en false). Este solo aplica
   cuando SÍ está abierto pero falta poco para la hora de cierre. */
const CLOSING_SOON_MINUTES = 30;

export function renderClosingSoonBanner(settings) {
  const banner = $('closing-soon-banner');
  const minutesLeft = minutesUntilClosing(settings);
  const show = settings.isOpen !== false && minutesLeft !== null && minutesLeft >= 0 && minutesLeft <= CLOSING_SOON_MINUTES;
  banner.hidden = !show;
  if (show) {
    $('closing-soon-banner-text').textContent =
      minutesLeft <= 1 ? 'Estamos cerrando — puede que no alcancemos a tomar tu pedido.' : `Cerramos en ${minutesLeft} minutos — tu pedido podría llegar después del cierre.`;
  }
}

function minutesUntilClosing(settings) {
  const time = (settings.closingTime || '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  const closing = new Date();
  closing.setHours(h, m, 0, 0);
  return Math.round((closing.getTime() - Date.now()) / 60000);
}

/* Muestra debajo de la dirección si esa zona tiene un costo de
   domicilio distinto, o un aviso si está fuera de cobertura. */
export function renderZoneInfo({ deliveryMode, zone, restrictToZones, coverageZones }) {
  const el = $('zone-info');
  if (deliveryMode !== 'domicilio' || !coverageZones || coverageZones.length === 0) {
    el.hidden = true;
    return;
  }
  if (zone) {
    el.hidden = false;
    el.classList.remove('field-hint-warning');
    el.textContent = `Zona "${zone.name}" · domicilio ${formatCOP(zone.fee)}`;
  } else if (restrictToZones) {
    el.hidden = false;
    el.classList.add('field-hint-warning');
    el.textContent = 'No reconocemos esa dirección dentro de nuestra zona de cobertura — revísala o llámanos.';
  } else {
    el.hidden = true;
  }
}

/* --- Checkout: direcciones guardadas --- */
export function renderSavedAddresses(addresses, { onSelect, onDelete } = {}) {
  const container = $('saved-addresses');
  if (!addresses.length) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  container.hidden = false;
  container.innerHTML = addresses
    .map(
      (addr, idx) => `
      <div class="saved-address-chip" data-idx="${idx}" title="${escapeHtml(addr.address)}">
        <span class="saved-address-chip-label">${escapeHtml(addr.label || addr.address)}</span>
        <button type="button" class="saved-address-chip-remove" data-idx="${idx}" aria-label="Eliminar dirección">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        </button>
      </div>`
    )
    .join('');

  container.querySelectorAll('.saved-address-chip').forEach((chip) => {
    chip.addEventListener('click', () => onSelect && onSelect(addresses[Number(chip.dataset.idx)]));
  });
  container.querySelectorAll('.saved-address-chip-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onDelete && onDelete(addresses[Number(btn.dataset.idx)]);
    });
  });
}

/* --- Perfil --- */
export function renderProfile(user) {
  const img = $('profile-avatar-img');
  img.referrerPolicy = 'no-referrer';
  img.style.display = user.photoURL ? '' : 'none';
  img.src = user.photoURL || '';
  img.alt = user.displayName || 'Usuario';
  img.onerror = () => {
    img.style.display = 'none';
  };
  $('profile-name').textContent = user.displayName || 'Usuario';
  $('profile-email').textContent = user.email || '';
}

const ORDER_STEPS = [
  { id: 'recibido', label: 'Recibido' },
  { id: 'en_cocina', label: 'En cocina' },
  { id: 'en_camino', label: 'En camino' },
  { id: 'entregado', label: 'Entregado' },
];

function renderStatusStepper(status) {
  const currentIndex = Math.max(0, ORDER_STEPS.findIndex((s) => s.id === status));
  return `
    <div class="status-stepper">
      ${ORDER_STEPS.map(
        (step, i) => `
        <div class="status-step${i <= currentIndex ? ' is-done' : ''}">
          <span class="status-dot"></span>
          <span class="status-label">${step.label}</span>
        </div>`
      ).join('')}
    </div>
  `;
}

/* Si el panel puso un tiempo estimado (ver admin.js), calcula la
   hora aproximada de entrega/recogida a partir de cuándo se puso
   ese estimado. Vuelve null si el pedido ya no está activo o no
   tiene estimado — así el llamador simplemente no muestra nada. */
/* Franja fija sobre la barra inferior con el pedido activo más
   reciente (si hay alguno) — para que el cliente vea el estado sin
   tener que abrir su perfil. "Activo" = no entregado, cancelado ni
   no_entregado. onTap abre el perfil (donde ya está el detalle
   completo), no duplicamos esa vista acá. */
export function renderActiveOrderBar(orders, onTap) {
  const bar = $('active-order-bar');
  const active = orders.find((o) => !['entregado', 'cancelado', 'no_entregado'].includes(o.status || 'recibido'));
  if (!active) {
    bar.hidden = true;
    return;
  }
  const label = ORDER_STEPS.find((s) => s.id === (active.status || 'recibido'))?.label || 'Recibido';
  const eta = estimatedReadyLabel(active);
  $('active-order-bar-text').textContent = eta ? `Tu pedido: ${label} — ${eta}` : `Tu pedido: ${label}`;
  bar.hidden = false;
  bar.onclick = onTap || null;
}

function estimatedReadyLabel(order) {
  if (['entregado', 'cancelado'].includes(order.status || 'recibido')) return null;
  if (!order.etaMinutes || !order.etaSetAt) return null;
  const readyAt = order.etaSetAt + order.etaMinutes * 60000;
  const date = new Date(readyAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Listo aprox. ${date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`;
}

// Si el domiciliario lleva más de esto sin mandar una posición
// nueva estando "en camino", asumimos que perdió señal/cerró la
// app/se quedó sin batería — se lo avisamos al cliente en vez de
// mostrar en silencio una ubicación vieja como si fuera actual.
const GPS_STALE_MS = 5 * 60 * 1000;

/* Cuando el domiciliario marca "Recogí el pedido" (driver.js),
   empieza a mandar su ubicación — la mostramos como un enlace a
   Google Maps (sin necesitar clave propia de mapas) más hace cuánto
   se actualizó, para que el cliente sepa si el dato es reciente. */
function driverTrackingInfo(order) {
  if (order.status !== 'en_camino' || !order.driverId || !order.driverLocation) return null;
  const loc = order.driverLocation;
  if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return null;
  const mapsUrl = trailMapsUrl(order.driverTrail, loc);
  const updatedMs = typeof loc.updatedAt === 'number' ? loc.updatedAt : 0;
  const freshness = updatedMs ? minutesAgoLabel(updatedMs) : '';
  const hasTrail = Array.isArray(order.driverTrail) && order.driverTrail.length > 1;
  const stale = updatedMs > 0 && Date.now() - updatedMs > GPS_STALE_MS;
  return {
    mapsUrl,
    freshness,
    stale,
    driverName: order.driverName || 'Tu domiciliario',
    label: hasTrail ? 'ver recorrido' : 'ver ubicación',
  };
}

/* Arma un enlace de Google Maps "Cómo llegar" encadenando los puntos
   del recorrido reciente como paradas — así se ve el camino que ha
   hecho el domiciliario, no solo su punto actual. Google Maps solo
   acepta ~25 puntos en la URL, así que si el recorrido tiene más se
   muestra una muestra pareja (no los 80 completos). Sin librería de
   mapas ni clave de API: es el mismo truco de enlace público que ya
   se usa para "abrir en Maps" en el resto del proyecto. */
function trailMapsUrl(trail, current) {
  const points = (Array.isArray(trail) ? trail : [])
    .filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number')
    .map((p) => `${p.lat},${p.lng}`);
  const currentStr = current ? `${current.lat},${current.lng}` : null;
  if (currentStr && points[points.length - 1] !== currentStr) points.push(currentStr);
  if (points.length === 0) return null;
  if (points.length === 1) return `https://www.google.com/maps?q=${points[0]}`;
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

function minutesAgoLabel(ms) {
  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (diffMin < 1) return 'actualizado justo ahora';
  if (diffMin < 60) return `actualizado hace ${diffMin} min`;
  return 'actualizado hace más de una hora';
}

function formatScheduled(value) {
  const date = value && value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function whatsappShareUrl(order) {
  const lines = [
    'Mi pedido — Rodízio Cúcuta',
    ...(order.items || []).map((item) => `${item.qty}× ${item.name}`),
    `Total: ${formatCOP(order.total || 0)}`,
    order.deliveryMode === 'recoger' ? 'Recoger en tienda' : `A domicilio${order.address ? ' — ' + order.address : ''}`,
  ];
  return `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`;
}

// El cliente puede cancelar su propio pedido solo mientras sigue
// "recibido" y no han pasado más de estos minutos — pasado eso,
// asumimos que la cocina ya empezó y solo queda llamar.
const CANCEL_WINDOW_MINUTES = 2;

function orderCreatedMs(order) {
  if (!order.createdAt) return 0;
  return typeof order.createdAt === 'number' ? order.createdAt : Number(order.createdAt) || 0;
}

export function renderOrdersList(orders, { onRepeat, onCancel, onDetail, onRateDriver } = {}) {
  const container = $('orders-list');
  if (!orders.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Aún no tienes pedidos</h3>
        <p>Cuando confirmes uno, aquí vas a poder seguirlo y repetirlo.</p>
      </div>
    `;
    return;
  }
  container.innerHTML = orders
    .map((order, idx) => {
      const status = order.status || 'recibido';
      const isCancelled = status === 'cancelado';
      const isFailed = status === 'no_entregado';
      const isDelivered = status === 'entregado';
      const canCancel =
        !isCancelled &&
        status === 'recibido' &&
        Date.now() - orderCreatedMs(order) < CANCEL_WINDOW_MINUTES * 60000;
      const tracking = driverTrackingInfo(order);

      return `
      <div class="order-row${isCancelled ? ' is-cancelled' : ''}">
        <div class="order-row-top">
          <span class="price">${formatCOP(order.total || 0)}</span>
          <div class="order-row-actions">
            <a class="order-share-btn" href="${whatsappShareUrl(order)}" target="_blank" rel="noopener noreferrer" aria-label="Compartir pedido por WhatsApp">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.1l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1s-.7.8-.9 1c-.2.2-.3.2-.6.1s-1.2-.4-2.2-1.4c-.8-.7-1.4-1.6-1.5-1.9-.2-.3 0-.4.1-.6l.4-.5c.1-.1.2-.3.2-.4.1-.1.1-.3 0-.4-.1-.1-.6-1.4-.8-1.9-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 1.9s.8 2.2.9 2.4c.1.2 1.6 2.5 4 3.5.6.2 1 .4 1.3.5.6.2 1.1.1 1.5.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2-.1-.1-.2-.2-.4-.3z"/></svg>
            </a>
            <button type="button" class="order-repeat-btn" data-order-idx="${idx}">Repetir pedido</button>
          </div>
        </div>
        ${
          isCancelled
            ? `<p class="order-cancelled-tag">Pedido cancelado</p>`
            : isFailed
              ? `<p class="order-cancelled-tag">No pudimos entregar tu pedido — te vamos a contactar para resolverlo</p>`
              : renderStatusStepper(status)
        }
        ${estimatedReadyLabel(order) ? `<p class="order-eta">${estimatedReadyLabel(order)}</p>` : ''}
        ${
          tracking
            ? tracking.stale
              ? `<p class="order-tracking-link order-tracking-stale">
                   <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
                   Perdimos la señal de ${escapeHtml(tracking.driverName)} (${tracking.freshness}) — sigue en camino, tu pedido no se perdió
                 </p>`
              : `<a class="order-tracking-link" href="${tracking.mapsUrl}" target="_blank" rel="noopener noreferrer">
                 <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 21s7-6.5 7-11.5A7 7 0 105 9.5C5 14.5 12 21 12 21z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="9.5" r="2.2" stroke="currentColor" stroke-width="1.8"/></svg>
                 ${escapeHtml(tracking.driverName)} va en camino — ${tracking.label} (${tracking.freshness})
               </a>`
            : ''
        }
        <div class="order-row-meta">
          ${order.deliveryMode === 'recoger' ? 'Recoger en tienda' : 'A domicilio'} · ${(order.items || []).length} productos
          ${order.scheduledFor ? ' · Programado ' + formatScheduled(order.scheduledFor) : ''}
        </div>
        <div class="order-row-actions-bottom">
          <button type="button" class="order-detail-btn" data-order-idx="${idx}">Ver recibo</button>
          ${canCancel ? `<button type="button" class="order-cancel-btn" data-order-idx="${idx}">Cancelar pedido</button>` : ''}
        </div>
        ${
          isDelivered && order.driverId && !order.driverRatingSubmitted
            ? `<button type="button" class="order-rate-driver-btn" data-order-idx="${idx}">Calificar a ${escapeHtml(order.driverName || 'tu domiciliario')}</button>`
            : ''
        }
      </div>`;
    })
    .join('');

  if (onRepeat) {
    container.querySelectorAll('.order-repeat-btn').forEach((btn) => {
      btn.addEventListener('click', () => onRepeat(orders[Number(btn.dataset.orderIdx)]));
    });
  }
  if (onCancel) {
    container.querySelectorAll('.order-cancel-btn').forEach((btn) => {
      btn.addEventListener('click', () => onCancel(orders[Number(btn.dataset.orderIdx)]));
    });
  }
  if (onRateDriver) {
    container.querySelectorAll('.order-rate-driver-btn').forEach((btn) => {
      btn.addEventListener('click', () => onRateDriver(orders[Number(btn.dataset.orderIdx)]));
    });
  }
  if (onDetail) {
    container.querySelectorAll('.order-detail-btn').forEach((btn) => {
      btn.addEventListener('click', () => onDetail(orders[Number(btn.dataset.orderIdx)]));
    });
  }
}

/* --- Recibo detallado de un pedido (modal aparte) --- */
export function openOrderDetailModal(order) {
  const body = $('order-detail-body');
  const itemsHtml = (order.items || [])
    .map(
      (item) => `
      <div class="receipt-item">
        <span>${item.qty}× ${escapeHtml(item.name)}</span>
        <span>${formatCOP(item.price * item.qty)}</span>
      </div>
      ${item.notes ? `<div class="receipt-item-notes">Nota: ${escapeHtml(item.notes)}</div>` : ''}`
    )
    .join('');

  const dateLabel = order.createdAt
    ? new Date(order.createdAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
    : '';
  const status = order.status || 'recibido';
  const statusLabel = ORDER_STEPS.find((s) => s.id === status)?.label || (status === 'cancelado' ? 'Cancelado' : status);

  body.innerHTML = `
    <p class="receipt-meta">${dateLabel} · ${statusLabel}</p>
    <p class="receipt-meta">${order.deliveryMode === 'recoger' ? 'Recoger en tienda' : `A domicilio${order.address ? ' — ' + escapeHtml(order.address) : ''}`}</p>
    ${order.reference ? `<p class="receipt-meta">Referencia: ${escapeHtml(order.reference)}</p>` : ''}
    <div class="receipt-items">${itemsHtml}</div>
    <div class="summary-row"><span>Subtotal</span><span>${formatCOP(order.subtotal || 0)}</span></div>
    <div class="summary-row"><span>Domicilio</span><span>${formatCOP(order.shipping || 0)}</span></div>
    <div class="summary-row total"><span>Total</span><span>${formatCOP(order.total || 0)}</span></div>
  `;
  toggleSheet('order-detail-modal', true);
}

/* --- Header: estado de sesión ---
   Si la foto de Google falla al cargar (bloqueo por referrer,
   sin conexión, etc.) se cae al ícono genérico en vez de dejar
   una imagen rota con el texto alternativo encima. */
export function renderAccountButton(user) {
  const btn = $('btn-account');
  if (user && user.photoURL) {
    btn.innerHTML = `<img src="${user.photoURL}" alt="${user.displayName || 'Usuario'}" referrerpolicy="no-referrer" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
    btn.classList.add('avatar-btn');
    btn.classList.remove('icon-btn');
    btn.querySelector('img').addEventListener(
      'error',
      () => renderAccountButton({ ...user, photoURL: null }),
      { once: true }
    );
  } else {
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 20c1.5-4 6-5 8-5s6.5 1 8 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    btn.classList.add('icon-btn');
    btn.classList.remove('avatar-btn');
  }
}

/* --- Overlays genéricos --- */
export function toggleSheet(id, open) {
  const el = $(id);
  const overlay = $('overlay');
  if (open) {
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-open'));
    overlay.classList.add('is-open');
  } else {
    el.classList.remove('is-open');
    overlay.classList.remove('is-open');
    setTimeout(() => {
      el.hidden = true;
    }, 250);
  }
}

export function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

export function nudgeCartNav() {
  const item = $('nav-carrito');
  item.classList.remove('is-nudging');
  void item.offsetWidth; // reinicia la animación
  item.classList.add('is-nudging');
}
