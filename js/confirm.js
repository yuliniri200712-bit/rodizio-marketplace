/* =========================================================
   confirm.js — diálogo de confirmación con el diseño propio
   del sistema (en vez del window.confirm() genérico del
   navegador). Módulo sin dependencias, lo importan las 3 apps
   (app.js, admin.js, driver.js) por igual.

   Uso:
     import { confirmDialog } from './confirm.js';
     const ok = await confirmDialog('¿Seguro que quieres cerrar sesión?');
     if (!ok) return;

   El DOM del diálogo se crea una sola vez (perezoso, al primer
   uso) y se reutiliza — no hace falta agregar nada al HTML de
   cada página.
   ========================================================= */

let els = null;
let activeResolve = null;

function build() {
  const overlay = document.createElement('div');
  overlay.className = 'overlay confirm-overlay';

  const card = document.createElement('div');
  card.className = 'confirm-dialog';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  card.innerHTML = `
    <p class="confirm-dialog-message" id="confirm-dialog-message"></p>
    <div class="confirm-dialog-actions">
      <button type="button" class="btn btn-ghost" id="confirm-dialog-cancel"></button>
      <button type="button" class="btn btn-primary" id="confirm-dialog-accept"></button>
    </div>
  `;
  card.setAttribute('aria-labelledby', 'confirm-dialog-message');
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const message = card.querySelector('#confirm-dialog-message');
  const btnCancel = card.querySelector('#confirm-dialog-cancel');
  const btnAccept = card.querySelector('#confirm-dialog-accept');

  function close(result) {
    overlay.classList.remove('is-open');
    document.removeEventListener('keydown', onKeydown);
    if (activeResolve) {
      const resolve = activeResolve;
      activeResolve = null;
      resolve(result);
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close(false);
    if (e.key === 'Enter') close(true);
  }

  btnCancel.addEventListener('click', () => close(false));
  btnAccept.addEventListener('click', () => close(true));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(false);
  });

  els = { overlay, message, btnCancel, btnAccept, onKeydown };
}

/**
 * Muestra un diálogo de confirmación con el diseño del sistema
 * (tarjeta oscura + overlay, mismo patrón que drawers/modales).
 * Devuelve una Promise<boolean> — true si acepta, false si cancela
 * (con "Cancelar", tocando fuera de la tarjeta, o Escape).
 */
export function confirmDialog(
  messageText,
  { confirmLabel = 'Sí, cerrar sesión', cancelLabel = 'Cancelar', danger = true } = {}
) {
  if (!els) build();
  return new Promise((resolve) => {
    activeResolve = resolve;
    els.message.textContent = messageText;
    els.btnCancel.textContent = cancelLabel;
    els.btnAccept.textContent = confirmLabel;
    els.btnAccept.classList.toggle('btn-primary', !danger);
    els.btnAccept.classList.toggle('btn-danger-solid', danger);
    els.overlay.classList.add('is-open');
    document.addEventListener('keydown', els.onKeydown);
    els.btnAccept.focus();
  });
}

/* ---------- Selección de motivo (lista de opciones) ---------- */
let reasonEls = null;
let reasonResolve = null;

function buildReason() {
  const overlay = document.createElement('div');
  overlay.className = 'overlay confirm-overlay';

  const card = document.createElement('div');
  card.className = 'confirm-dialog';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  card.innerHTML = `
    <p class="confirm-dialog-message" id="reason-dialog-message"></p>
    <div class="confirm-dialog-options" id="reason-dialog-options"></div>
    <div class="confirm-dialog-actions">
      <button type="button" class="btn btn-ghost" id="reason-dialog-cancel">Cancelar</button>
    </div>
  `;
  card.setAttribute('aria-labelledby', 'reason-dialog-message');
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const message = card.querySelector('#reason-dialog-message');
  const options = card.querySelector('#reason-dialog-options');
  const btnCancel = card.querySelector('#reason-dialog-cancel');

  function close(result) {
    overlay.classList.remove('is-open');
    document.removeEventListener('keydown', onKeydown);
    if (reasonResolve) {
      const resolve = reasonResolve;
      reasonResolve = null;
      resolve(result);
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close(null);
  }

  btnCancel.addEventListener('click', () => close(null));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(null);
  });

  reasonEls = { overlay, message, options, onKeydown, close };
}

/**
 * Muestra una lista de motivos para elegir uno (en vez de un
 * <select> nativo). Devuelve una Promise<string|null> — el motivo
 * elegido, o null si cancela.
 */
export function pickReasonDialog(messageText, reasonOptions) {
  if (!reasonEls) buildReason();
  return new Promise((resolve) => {
    reasonResolve = resolve;
    reasonEls.message.textContent = messageText;
    reasonEls.options.innerHTML = reasonOptions
      .map((label, idx) => `<button type="button" class="confirm-option-btn" data-idx="${idx}">${label}</button>`)
      .join('');
    reasonEls.options.querySelectorAll('.confirm-option-btn').forEach((btn) => {
      btn.addEventListener('click', () => reasonEls.close(reasonOptions[Number(btn.dataset.idx)]));
    });
    reasonEls.overlay.classList.add('is-open');
    document.addEventListener('keydown', reasonEls.onKeydown);
  });
}

/* ---------- Número opcional (propina, etc.) ---------- */
let numberEls = null;
let numberResolve = null;

function buildNumber() {
  const overlay = document.createElement('div');
  overlay.className = 'overlay confirm-overlay';

  const card = document.createElement('div');
  card.className = 'confirm-dialog';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  card.innerHTML = `
    <p class="confirm-dialog-message" id="number-dialog-message"></p>
    <div class="field">
      <input type="number" min="0" inputmode="numeric" id="number-dialog-input" class="confirm-dialog-input" />
    </div>
    <div class="confirm-dialog-actions">
      <button type="button" class="btn btn-ghost" id="number-dialog-skip"></button>
      <button type="button" class="btn btn-primary" id="number-dialog-accept">Guardar</button>
    </div>
  `;
  card.setAttribute('aria-labelledby', 'number-dialog-message');
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const message = card.querySelector('#number-dialog-message');
  const input = card.querySelector('#number-dialog-input');
  const btnSkip = card.querySelector('#number-dialog-skip');
  const btnAccept = card.querySelector('#number-dialog-accept');

  function close(result) {
    overlay.classList.remove('is-open');
    document.removeEventListener('keydown', onKeydown);
    if (numberResolve) {
      const resolve = numberResolve;
      numberResolve = null;
      resolve(result);
    }
  }

  function acceptValue() {
    const value = Number(input.value);
    close(input.value !== '' && !Number.isNaN(value) && value > 0 ? value : null);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close(null);
    if (e.key === 'Enter') acceptValue();
  }

  btnSkip.addEventListener('click', () => close(null));
  btnAccept.addEventListener('click', acceptValue);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(null);
  });

  numberEls = { overlay, message, input, btnSkip, onKeydown };
}

/**
 * Pide un número opcional (ej. propina) con un campo de texto en vez
 * del <select>/prompt nativo. Devuelve Promise<number|null> — el
 * número si escribe algo mayor a 0 y confirma, null si lo salta.
 */
export function promptNumberDialog(messageText, { skipLabel = 'Sin propina' } = {}) {
  if (!numberEls) buildNumber();
  return new Promise((resolve) => {
    numberResolve = resolve;
    numberEls.message.textContent = messageText;
    numberEls.btnSkip.textContent = skipLabel;
    numberEls.input.value = '';
    numberEls.overlay.classList.add('is-open');
    document.addEventListener('keydown', numberEls.onKeydown);
    numberEls.input.focus();
  });
}
