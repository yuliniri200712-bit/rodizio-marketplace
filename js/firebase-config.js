/* =========================================================
   FIREBASE — configuración e inicialización
   =========================================================
   Este es el ÚNICO archivo que debes editar para conectar
   el proyecto a tu propio Firebase.

   Cómo obtener estos valores:
   1. Ve a https://console.firebase.google.com y abre tu
      proyecto "rodiziomarketplace".
   2. Configuración del proyecto (ícono de engranaje) → General
      → "Tus apps" → agrega una app Web (</>) si no tienes una →
      copia el objeto firebaseConfig y reemplaza los valores
      'TU_...' de aquí abajo. El databaseURL ya está puesto.
   3. Authentication → Sign-in method → habilita "Google".
   4. Realtime Database → si no existe, créala → pestaña "Reglas"
      → pega las reglas sugeridas al final de este archivo.
   ========================================================= */

const firebaseConfig = {
  apiKey: 'AIzaSyBTxf2ntMPTkYR5f45LMJC82bfexYAgtqI',
  authDomain: 'rodiziomarketplace.firebaseapp.com',
  databaseURL: 'https://rodiziomarketplace-default-rtdb.firebaseio.com',
  projectId: 'rodiziomarketplace',
  storageBucket: 'rodiziomarketplace.firebasestorage.app',
  messagingSenderId: '224063551054',
  appId: '1:224063551054:web:e8af60826b45b56a02b51f',
  measurementId: 'G-F4GLH9C0LJ',
};

// SDKs de Firebase cargados como módulos ES desde el CDN oficial
// (ver las etiquetas <script type="module"> en index.html).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { getAnalytics, isSupported as analyticsIsSupported } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-analytics.js';

/* index.html, admin.html y driver.html viven en el mismo dominio
   (mismo http://localhost:8080, y lo mismo pasará cuando publiques
   en producción) — sin esto, las tres compartirían la MISMA sesión
   de Firebase Auth en el navegador (iniciar sesión en una equivale a
   iniciar sesión en las otras dos), porque Firebase guarda la sesión
   con una llave que depende del NOMBRE de la app, no de la página.
   Cada página le da un nombre distinto a su instancia de Firebase
   para que cada una tenga su propia sesión, totalmente aislada de
   las otras dos, aunque compartan navegador y dominio. */
function appNameForThisPage() {
  // Se identifica por el contenedor raíz de cada página (#admin-app,
  // #driver-app) en vez de la URL: algunos entornos (Firebase
  // Hosting con "Clean URLs", el propio previsualizador de este
  // entorno de pruebas) sirven admin.html como "/admin" sin
  // extensión, y una comprobación por sufijo de ruta fallaría ahí.
  if (typeof document === 'undefined') return undefined;
  if (document.getElementById('admin-app')) return 'admin-panel';
  if (document.getElementById('driver-app')) return 'driver-app';
  return undefined; // app de clientes (#app): usa el nombre por defecto de siempre
}

export const firebaseApp = initializeApp(firebaseConfig, appNameForThisPage());
export const auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
export const db = getDatabase(firebaseApp);

/* Analytics no funciona en todos los navegadores/contextos
   (necesita cookies e IndexedDB). analytics.js usa esta promesa
   y si resuelve a null simplemente no registra nada — la app
   nunca se rompe por esto. */
export const analyticsReady = analyticsIsSupported()
  .then((supported) => (supported ? getAnalytics(firebaseApp) : null))
  .catch(() => null);

/* Clave VAPID para notificaciones push (Cloud Messaging).
   Cómo obtenerla: Configuración del proyecto → Cloud Messaging →
   pestaña "Web Push certificates" → "Generate key pair" si no
   tienes una → copia el valor. Sin esto, notifications.js no
   puede pedir el token push (falla con un mensaje claro). */
export const VAPID_KEY = 'BD0njMuxfcg8cIWGMH_V3-97cMEifywWIYA_tjEwbedlm6gcU5yk4ggVi-FgYaGtW56xWEfjlngylKLtzlZAx2c';

/* =========================================================
   Reglas de Realtime Database sugeridas (pégalas en la
   consola, pestaña "Reglas" de Realtime Database):

   {
     "rules": {
       "orders": {
         ".indexOn": ["uid", "driverId"],
         ".read": "auth != null && (root.child('admins').child(auth.uid).exists() || (query.orderByChild == 'uid' && query.equalTo == auth.uid) || (query.orderByChild == 'driverId' && query.equalTo == auth.uid))",
         "$orderId": {
           ".write": "auth != null && (data.exists() ? (data.child('uid').val() === auth.uid || data.child('driverId').val() === auth.uid || root.child('admins').child(auth.uid).exists()) : newData.child('uid').val() === auth.uid)"
         }
       },
       "drivers": {
         ".read": "auth != null && root.child('admins').child(auth.uid).exists()",
         "$uid": {
           ".read": "auth != null && (auth.uid === $uid || root.child('admins').child(auth.uid).exists())",
           "access": {
             ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || root.child('admins').child(auth.uid).val() === 'dueno')"
           },
           "name": { ".write": "auth != null && auth.uid === $uid" },
           "phone": { ".write": "auth != null && auth.uid === $uid" },
           "available": { ".write": "auth != null && auth.uid === $uid" },
           "fcmTokens": {
             "$token": { ".write": "auth != null && auth.uid === $uid" }
           }
         }
       },
       "consents": {
         "$uid": {
           ".read": "auth != null && (auth.uid === $uid || root.child('admins').child(auth.uid).exists())",
           ".write": "auth != null && auth.uid === $uid"
         }
       },
       "users": {
         "$uid": {
           "fcmTokens": {
             ".read": "auth != null && auth.uid === $uid",
             ".write": "auth != null && auth.uid === $uid"
           },
           "addresses": {
             ".read": "auth != null && auth.uid === $uid",
             ".write": "auth != null && auth.uid === $uid"
           }
         }
       },
       "admins": {
         "$uid": {
           ".read": "auth != null && auth.uid === $uid"
         }
       },
       "outOfStock": {
         ".read": true,
         "$productId": {
           ".write": "auth != null && (root.child('admins').child(auth.uid).exists() || (data.isNumber() && newData.isNumber() && newData.val() >= 0 && newData.val() < data.val()))"
         }
       },
       "errorLogs": {
         ".read": "auth != null && root.child('admins').child(auth.uid).exists()",
         ".write": true,
         "$logId": {
           ".validate": "newData.hasChildren(['message', 'context'])"
         }
       },
       "customerFlags": {
         ".read": "auth != null && root.child('admins').child(auth.uid).exists()",
         "$uid": {
           ".read": "auth != null && (auth.uid === $uid || root.child('admins').child(auth.uid).exists())",
           ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || root.child('admins').child(auth.uid).val() === 'dueno')"
         }
       },
       "categories": {
         ".read": true,
         ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || root.child('admins').child(auth.uid).val() === 'dueno')"
       },
       "products": {
         ".read": true,
         ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || root.child('admins').child(auth.uid).val() === 'dueno')"
       },
       "settings": {
         ".read": true,
         ".write": "auth != null && (root.child('admins').child(auth.uid).val() === true || root.child('admins').child(auth.uid).val() === 'dueno')"
       },
       "cashSettlements": {
         ".indexOn": ["driverId"],
         ".read": "auth != null && (root.child('admins').child(auth.uid).exists() || (query.orderByChild == 'driverId' && query.equalTo == auth.uid))",
         "$settlementId": {
           ".write": "auth != null && !data.exists() && newData.child('driverId').val() === auth.uid"
         }
       },
       "driverRatings": {
         ".indexOn": ["driverId"],
         ".read": "auth != null && (root.child('admins').child(auth.uid).exists() || (query.orderByChild == 'driverId' && query.equalTo == auth.uid))",
         "$orderId": {
           ".write": "auth != null && !data.exists() && root.child('orders').child($orderId).child('uid').val() === auth.uid && newData.child('rating').isNumber() && newData.child('rating').val() >= 1 && newData.child('rating').val() <= 5"
         }
       }
     }
   }

   Nota sobre "admins": nadie puede escribir ahí desde la app (a
   propósito). Para hacer a alguien administrador, ve a Realtime
   Database → pestaña "Datos" → agrega a mano admins/{su-uid} con
   uno de estos valores (su uid lo encuentras en Authentication →
   pestaña "Users"):
     - true      → dueño (acceso total, igual que antes — se sigue
                   aceptando por compatibilidad con cuentas ya creadas)
     - "dueno"   → mismo acceso total, forma nueva y recomendada
     - "cajero"  → solo ve Pedidos e Inventario; no puede tocar el
                   Menú, Reportes ni Configuración del panel

   Nota sobre "orders" → ".read"/".write": en Realtime Database, un
   permiso puesto en $orderId (un pedido individual) NO se aplica
   cuando algo lee/escribe el nodo "orders" completo de una sola vez
   — que es justo lo que hace el panel (ver y actualizar todos los
   pedidos) y lo que hace la app de clientes al consultar "mis
   pedidos" (con una query orderByChild('uid').equalTo(uid)). Por eso
   el ".read"/".write" están puestos en "orders" mismo: dejan pasar a
   cualquier admin (dueño o cajero) siempre, y a cualquier otro
   usuario SOLO sobre su propio pedido — así nadie puede leer ni
   tocar los pedidos de otra persona, y un cajero sin ser "dueno"
   igual puede gestionar pedidos y marcar inventario.

   Nota sobre "outOfStock": el valor de cada producto ya no es solo
   `true`/ausente. Puede ser:
     - ausente        → disponible, sin conteo
     - un número > 0  → unidades restantes (el cliente lo sigue viendo
                         disponible; el panel muestra "quedan N")
     - 0 o true       → agotado para el cliente
   La regla deja que CUALQUIER cliente autenticado baje ese número
   (nunca lo suba, nunca lo toque si no es un número ya existente) —
   es lo que usa `auth.js` (placeOrder) para descontar unidades de
   forma atómica cuando alguien confirma un pedido, sin necesitar dar
   permiso de admin completo sobre outOfStock. Solo un admin puede
   crear el conteo inicial, marcarlo `true`, o subirlo de nuevo.

   Nota sobre "drivers": el acceso (campo "access") solo lo escribe el
   dueño a mano desde la consola, igual que "admins" — nunca desde la
   app. Un domiciliario primero se registra en driver.html (crea su
   cuenta de correo/contraseña, igual que un admin), y hasta que el
   dueño no le agregue drivers/{uid}/access: true no puede entrar. Una
   vez adentro, el propio domiciliario edita su nombre, teléfono y
   disponibilidad — eso sí lo puede escribir él mismo.

   Nota sobre "orders" y domiciliarios: un domiciliario ve (con la
   query por driverId) y puede actualizar SOLO los pedidos que el
   panel le asignó (orders/{id}/driverId === su uid) — no ve ni puede
   tocar los de otros domiciliarios ni los que nadie le asignó. La
   escritura le da acceso al pedido completo (igual que al cliente
   dueño del pedido), no solo a status/driverLocation — es la misma
   simplificación que ya existía para el cliente (ver "Validación de
   negocio solo en el navegador" en el README).

   Nota sobre "consents": queda un registro de que cada usuario (cliente,
   personal del panel o domiciliario) aceptó la política de tratamiento de
   datos antes de crear su cuenta o iniciar sesión — cada quien solo puede
   escribir el suyo (nunca el de otra persona), y solo un admin puede leer
   los de los demás (para auditoría). No bloquea nada por sí solo: el
   bloqueo real está en la casilla obligatoria de cada formulario.

   Nota sobre "errorLogs": cualquiera puede escribir (como un beacon
   de analítica, sin datos sensibles) para que la app registre errores
   de JS incluso de un cliente que nunca inició sesión — solo un admin
   puede leer la lista, desde el panel (pestaña Reportes).

   Nota sobre "customerFlags": solo lo escribe el dueño, para marcar
   un cliente problemático (muchas cancelaciones, pedidos no
   reclamados). El propio cliente puede leer su propio flag (para que
   la app le muestre el aviso de "no podemos procesar tu pedido"),
   pero nunca escribirlo.

   Nota sobre "cashSettlements": cada domiciliario, al cerrar turno
   (driver.js), crea un registro nuevo (nunca edita ni borra uno que
   ya existe — la regla exige `!data.exists()`) con el efectivo que
   debía tener vs. el que entregó — es un historial de auditoría, no
   algo que se pueda corregir después desde la app. Un admin puede
   leer la lista completa (pestaña Reportes del panel); un
   domiciliario solo puede leer SUS PROPIOS cierres (con la query
   `orderByChild('driverId').equalTo(su uid)`, igual que el patrón
   ya usado en "orders" para que cada quien vea solo lo suyo).

   Nota sobre "driverRatings": clave = orderId (un pedido solo se
   puede calificar una vez — la regla exige `!data.exists()`, no hay
   "editar" la calificación después). Solo puede escribirla el DUEÑO
   de ese pedido (`root.child('orders').child($orderId).child('uid')
   === auth.uid`), y solo si el rating es un número entre 1 y 5. Un
   admin lee todas; un domiciliario lee solo las suyas (mismo patrón
   de query por `driverId` que "cashSettlements").
   ========================================================= */
