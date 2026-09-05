/* =========================================================
   Cloud Function — avisa al cliente cuando cambia el estado
   de su pedido (recibido → en_cocina → en_camino → entregado).
   =========================================================
   Se dispara sola cada vez que cambia el valor en
   orders/{orderId}/status dentro de Realtime Database — ya sea
   a mano desde la consola, o (lo normal) porque alguien presionó
   un botón de estado en el panel de administración (admin.js).

   No se ejecuta en el navegador del cliente: corre en los
   servidores de Firebase. Por eso necesita desplegarse aparte
   (ver instrucciones al final de este archivo).
   ========================================================= */

const { onValueUpdated, onValueWritten } = require('firebase-functions/v2/database');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

const STATUS_LABELS = {
  recibido: 'Recibido',
  en_cocina: 'Tu pedido está en cocina',
  en_camino: 'Tu pedido va en camino',
  entregado: '¡Tu pedido fue entregado!',
  no_entregado: 'Tuvimos un problema para entregar tu pedido — te contactaremos',
  cancelado: 'Tu pedido fue cancelado',
};

exports.notifyOrderStatusChange = onValueUpdated(
  { ref: '/orders/{orderId}/status', region: 'us-central1' },
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    if (before === after || !after) return;

    const { orderId } = event.params;
    const db = getDatabase();

    const orderSnap = await db.ref(`orders/${orderId}`).get();
    const order = orderSnap.val();
    if (!order || !order.uid) return;

    const tokensSnap = await db.ref(`users/${order.uid}/fcmTokens`).get();
    if (!tokensSnap.exists()) return;
    const tokens = Object.keys(tokensSnap.val());
    if (tokens.length === 0) return;

    const messaging = getMessaging();
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: 'Rodízio Cúcuta',
        body: STATUS_LABELS[after] || `Tu pedido cambió a: ${after}`,
      },
      webpush: {
        fcmOptions: { link: '/' },
      },
    });

    // Limpieza: si un token ya no es válido (el usuario desinstaló
    // la app, borró datos del navegador, etc.), lo quitamos.
    const invalidTokens = tokens.filter((_, i) => !response.responses[i].success);
    await Promise.all(
      invalidTokens.map((token) => db.ref(`users/${order.uid}/fcmTokens/${token}`).remove())
    );
  }
);

/* =========================================================
   Cloud Function — avisa a UN domiciliario (y solo a ese) cuando
   el panel le asigna un pedido para recoger.
   =========================================================
   Se dispara cuando cambia orders/{orderId}/driverId — que es
   justo lo que escribe admin.js al elegir un domiciliario en la
   tarjeta de un pedido. Nunca manda la notificación a todos los
   domiciliarios registrados: solo lee los tokens guardados bajo
   drivers/{ese uid}/fcmTokens, exactamente el domiciliario que el
   panel eligió. */
exports.notifyDriverAssigned = onValueWritten(
  { ref: '/orders/{orderId}/driverId', region: 'us-central1' },
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    if (!after || before === after) return; // se quitó la asignación o no cambió

    const { orderId } = event.params;
    const db = getDatabase();

    const [orderSnap, tokensSnap] = await Promise.all([
      db.ref(`orders/${orderId}`).get(),
      db.ref(`drivers/${after}/fcmTokens`).get(),
    ]);
    if (!tokensSnap.exists()) return;

    const order = orderSnap.val() || {};
    const tokens = Object.keys(tokensSnap.val());
    if (tokens.length === 0) return;

    const itemsCount = (order.items || []).reduce((sum, i) => sum + (i.qty || 0), 0);
    const messaging = getMessaging();
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: 'Nuevo pedido para recoger',
        body: `${order.customerName || 'Cliente'} · ${itemsCount} producto${itemsCount === 1 ? '' : 's'} · ${order.address || 'domicilio'}`,
      },
      webpush: {
        fcmOptions: { link: '/driver.html' },
      },
    });

    const invalidTokens = tokens.filter((_, i) => !response.responses[i].success);
    await Promise.all(
      invalidTokens.map((token) => db.ref(`drivers/${after}/fcmTokens/${token}`).remove())
    );
  }
);

/* =========================================================
   Cómo desplegar esta función
   =========================================================
   Necesitas tener el plan Blaze (pago por uso) activo en tu
   proyecto de Firebase — Cloud Functions no funciona en el
   plan gratuito Spark. El plan Blaze SÍ tiene una capa
   gratuita generosa; para una app de un restaurante normalmente
   no vas a pagar nada, pero necesitas una tarjeta registrada.

   1. Activa el plan Blaze:
      https://console.firebase.google.com/project/rodiziomarketplace/usage/details

   2. Instala Firebase CLI (una sola vez, en tu computador):
      npm install -g firebase-tools

   3. Inicia sesión:
      firebase login

   4. Desde la carpeta del proyecto (donde está este archivo
      dentro de functions/), instala las dependencias:
      cd functions
      npm install
      cd ..

   5. Despliega las dos funciones (notifyOrderStatusChange y
      notifyDriverAssigned):
      firebase deploy --only functions --project rodiziomarketplace

   Después de desplegarlas:
   - Cada vez que el panel cambie el estado de un pedido, el cliente
     que lo hizo recibe la notificación (si activó notificaciones).
   - Cada vez que el panel le asigne un pedido a un domiciliario
     (desde la pestaña Pedidos, selector "Domiciliario"), SOLO ese
     domiciliario recibe la notificación (si activó notificaciones
     desde driver.html) — nunca el resto de domiciliarios registrados.

   No hace falta cambiar nada más en el código para que esto
   funcione.
   ========================================================= */
