# Contexto del proyecto — Rodízio Cúcuta

Lee esto antes de trabajar en el proyecto. Es contexto de desarrollo
(decisiones, convenciones, trampas ya conocidas) — el README.md es
para el usuario/dueño del restaurante, esto es para quien programa.

## Qué es

App de pedidos de un restaurante (menú, carrito, checkout) + panel de
administración + app de domiciliarios, las tres páginas aparte. HTML/CSS/JS
puro, sin build step, sin frameworks. Conectada a un proyecto **real** de
Firebase (no es una demo): `rodiziomarketplace`, con **Realtime Database**
(no Firestore — se migró de Firestore a RTDB temprano en el proyecto a
pedido del usuario; no reintroducir imports de `firebase-firestore.js`).

## Estructura de carpetas

Desde que se reorganizó el proyecto (a pedido del usuario), ya NO
todo vive suelto en la raíz:

- `css/` — todos los `.css` (`variables.css`, `base.css`, `layout.css`,
  `components.css`, `animations.css`, `admin.css`, `driver.css`).
- `js/` — todos los módulos ES (`app.js`, `admin.js`, `driver.js`,
  `ui.js`, `auth.js`, `catalog.js`, `settings.js`, `data.js`,
  `cart.js`, `favorites.js`, `notifications.js`, `errors.js`,
  `analytics.js`, `firebase-config.js`).
- En la raíz: `index.html`, `admin.html`, `driver.html`,
  `manifest.json`, `sw.js`, `icon.svg`, `server.js`, `package.json`,
  `functions/`, `images/`.

`sw.js` DEBE quedarse en la raíz (no moverlo a `js/`): un service
worker solo controla el scope de la carpeta donde vive, y necesita
scope `/` para cachear e interceptar toda la app. Por la misma razón,
`js/app.js` registra el service worker con la ruta absoluta
`/sw.js` (no `./sw.js` — un import relativo ahí se resolvería contra
`/js/`, no contra la raíz).

Los imports entre módulos de `js/` siguen siendo relativos simples
(`./data.js`, `./auth.js`, etc.) porque todos viven en la misma
carpeta — no hace falta `../` en ningún import interno.

## Cómo probar cambios

- El proyecto corre con **npm**: `npm install` (una sola vez) y
  `npm start` (levanta `server.js`, sin dependencias externas reales
  — es un server HTTP mínimo escrito a mano). Ya no hay archivos
  `.bat` de doble clic, se eliminaron a pedido del usuario.
- **Nunca** abrir `index.html`/`admin.html` con `file://` — los
  módulos ES no cargan así.
- Antes de arrancar un servidor de prueba, revisar si ya hay uno
  corriendo en el puerto 8080 (`netstat -ano | grep 8080`) y matar
  procesos `node.exe` huérfanos de sesiones anteriores — es un
  problema recurrente en este proyecto por probar muchas veces.
  Parar el servidor al terminar de probar.
- El navegador de pruebas (Claude Browser) tiene una limitación
  conocida y NO relacionada con el código: el registro del Service
  Worker falla intermitentemente ahí con "An unknown error occurred
  when fetching the script" / "Preview not found" en `screenshot` o
  `zoom`. Eso es del entorno de pruebas, no un bug de la app — no
  perder tiempo "arreglándolo". Verificar con `javascript_tool`
  (leer DOM, `getComputedStyle`, disparar clicks) en vez de
  depender de capturas de pantalla cuando fallen.
- Antes de probar algo que dependa de Realtime Database, recordar
  que las reglas publicadas en la consola pueden estar desactualizadas
  respecto a las que están comentadas en `js/firebase-config.js` — si
  algo da "permission denied" sin razón aparente, es casi siempre eso
  (avisarle al usuario que vuelva a pegar y publicar las reglas).
- Gotcha de reglas RTDB (ya corregido, pero tenerlo presente si se
  agrega otro nodo con lectura "todo vs. solo lo mío"): un `.read` en
  `$hijo` NO se aplica cuando algo lee el nodo padre completo
  (`onValue`/query sobre `orders`, no sobre `orders/{id}`) — el
  `.read` tiene que estar en el nodo padre. Para "cada quien lee solo
  lo suyo, el admin lee todo" sin restructurar los datos, se usa la
  sintaxis de reglas por query: `query.orderByChild == 'uid' &&
  query.equalTo == auth.uid` (ver el bloque de reglas en
  `js/firebase-config.js`, nodo `orders`).
- Gotcha de CSS con `hidden`: si una regla de media query le pone
  `display` a un elemento que también se oculta con el atributo
  `hidden` (ej. `#admin-main`), un selector de solo ID le gana en
  especificidad a la regla del navegador `[hidden]{display:none}` y
  el elemento queda visible aunque tenga `hidden`. Siempre escribir
  esas reglas como `#id:not([hidden]) { display: ... }` — este bug se
  ha repetido más de una vez al rediseñar pantallas de acceso
  (`.admin-gate`, `.closed-banner`, `.checkbox-field` cuando se
  empezó a usar `hidden` en las filas de consentimiento, y
  `.active-order-bar` al agregar la franja de "pedido en curso"):
  `.btn` (`display: inline-flex` de la clase genérica de botones —
  `#btn-admin-signout`/`#btn-driver-signout` quedaban visibles en la
  pantalla de login antes de iniciar sesión; corregido con
  `.btn[hidden] { display: none; }` justo debajo de `.btn` en
  `components.css`): cualquier vez que se le agregue `display` a una
  clase/id que también se oculta con `hidden`, revisar esto de una
  vez, no después de que falle.
- Gotcha de Firebase Auth con varias apps en el mismo dominio (ya
  corregido, pero tenerlo presente si se agrega una cuarta página):
  Firebase Auth guarda la sesión en el navegador con una llave que
  depende del **nombre** de la app de Firebase (`initializeApp(config,
  nombre)`), no de la página ni de la URL. Como `index.html`,
  `admin.html` y `driver.html` viven en el mismo origen, si las tres
  llaman a `initializeApp(firebaseConfig)` sin nombre (o con el mismo
  nombre), las tres terminan compartiendo la MISMA sesión — iniciar
  sesión en una equivale a iniciarla en las otras dos. Se corrige
  dándole a cada página un nombre de app distinto en
  `js/firebase-config.js` (`appNameForThisPage()`): detecta la página
  por su contenedor raíz (`#admin-app`, `#driver-app`; si no hay
  ninguno, es `index.html` y usa el nombre por defecto) — **no** por
  `location.pathname`, porque algunos entornos (Firebase Hosting con
  "Clean URLs", el propio previsualizador de pruebas) sirven
  `admin.html` como `/admin` sin extensión y una comprobación por
  sufijo de ruta fallaría ahí.

## Arquitectura / convenciones

- **`ui.js`** es un renderer "puro": recibe datos por parámetros
  desde `app.js`, nunca importa Firebase ni decide lógica de negocio.
- **`app.js`** es el único orquestador de la app de clientes: dueño
  del `state`, conecta módulos, maneja eventos del DOM.
- **`admin.js`/`admin.html`** es una app COMPLETAMENTE separada (no
  comparte `app.js` ni `ui.js` con la app de clientes) — tiene su
  propio render/estado, aunque reutiliza `auth.js`, `catalog.js`,
  `js/firebase-config.js` y los mismos archivos CSS base.
- **`driver.js`/`driver.html`** es una TERCERA app separada, para
  domiciliarios — mismo patrón que `admin.js` (login correo/contraseña,
  gate de acceso propio con `drivers/{uid}/access`, sin compartir
  `app.js`/`ui.js`/`admin.js`). `driver.html` carga `css/admin.css`
  además de `css/driver.css` a propósito, para reutilizar el gate de
  acceso, las pestañas tipo `segmented` y los toasts sin duplicar ese
  CSS — `driver.css` solo agrega/ajusta lo propio (tarjeta de perfil,
  tarjeta de pedido, botones de mapa/llamar).
  Responsivo con el mismo patrón de breakpoints que `admin.css`
  (720px tablet, 1080px escritorio): `#driver-orders-list` pasa de
  columna única a `repeat(2, 1fr)` y luego `repeat(3, 1fr)` — si se
  agrega un nuevo contenedor de tarjetas ahí, replicar ese mismo
  patrón de grid en vez de dejarlo en una sola columna siempre.
- **`data.js`** ya no es la fuente de verdad del menú: exporta
  `CATEGORIES`/`PRODUCTS` como bindings `let` (mutables) que sirven
  de valor por defecto/semilla, más `setCategories()`/`setProducts()`
  para que `app.js` los actualice en vivo cuando `catalog.js` trae
  datos reales de Realtime Database. Cualquier archivo que haga
  `import { CATEGORIES } from './data.js'` ve el valor actualizado
  automáticamente (binding vivo de ES modules) sin tener que
  re-importar nada — no hace falta pasar categories/products como
  parámetro por todos lados.
- **`catalog.js`** es la capa de datos del menú en RTDB (lee: toda la
  app; escribe: solo `admin.js`).
- **`settings.js`** es la capa de datos del nodo `settings` (horario,
  pedido mínimo, zonas de cobertura, teléfono) — mismo patrón que
  `catalog.js` (`onSettingsChange`/`saveSettings`), más `matchZone()`
  (coincidencia de texto simple, no geolocalización real, para saber
  qué zona corresponde a una dirección escrita a mano) y
  `DEFAULT_SETTINGS` como valor de respaldo mientras carga o si el
  nodo no existe aún.
- **`auth.js`** cubre todo lo demás de Firebase para la app de
  clientes: login Google, pedidos (incluye `cancelOrder`),
  calificación al domiciliario (`rateDriver`), direcciones, tokens
  FCM, lectura de `outOfStock`. (Ya no hay reseñas de producto —
  se quitó ese sistema por completo, ver más abajo.)
- Módulos con un solo propósito y sin dependencias cruzadas raras:
  `cart.js` y `favorites.js` (ambos localStorage puro, mismo patrón
  pub/sub), `notifications.js` (FCM), `analytics.js` (un solo
  `track()` que nunca debe poder romper la app si Analytics falla).
- **Roles de administrador**: `admins/{uid}` ya no es solo
  `true`/ausente — puede ser `true` (legado = dueño), `"dueno"` o
  `"cajero"`. `admin.js` guarda el rol en `state.role` y oculta con
  `hidden` las pestañas marcadas `data-role="dueno"` en `admin.html`
  (Menú, Reportes, Configuración) cuando el rol es cajero. Cualquier
  regla de RTDB que antes comparaba `=== true` para permitir una
  acción de "cualquier admin" (pedidos, inventario) debe comparar
  `.exists()` en su lugar; las acciones exclusivas del dueño (menú,
  configuración) sí comparan `=== true || === 'dueno'`.
- **Botones de estado del pedido** (`handleStatusButtonClick` en
  `admin.js`): al presionar uno, todo el grupo se bloquea de
  inmediato (`disabled` + opacidad) y el botón presionado pulsa
  (`.is-pending`, animación `admin-status-pulse` en `admin.css`)
  hasta que la escritura a Firebase confirma o falla — evita dobles
  clics y deja claro que se está guardando. No hace falta
  desbloquear a mano en el caso de éxito: la suscripción en vivo a
  `orders` vuelve a dibujar toda la tarjeta con el estado nuevo.
- **`orders/{id}/statusHistory`**: cada vez que el panel cambia el
  estado de un pedido, además de actualizar `status` se hace
  `push()` a este nodo con `{status, byEmail, at}` — es solo un
  registro histórico, no afecta la lógica de estados.
- **`orders/{id}/etaMinutes` + `etaSetAt`**: tiempo estimado que pone
  el cajero (botones rápidos 15/30/45/60 min en `admin.js`). El
  cliente calcula la hora aproximada (`etaSetAt + etaMinutes`) en
  `ui.js` (`renderOrdersList`), no se guarda la hora final calculada.
- **`orders/{id}/internalNote`**: texto libre que solo ve el panel
  (se imprime en la comanda si tiene algo, pero nunca se expone al
  cliente en `ui.js`/`auth.js`).
- **`outOfStock/{productId}` ya no es binario**: puede ser un número
  (unidades restantes, sigue disponible para el cliente) además de
  `true`/`0` (agotado). `auth.onOutOfStockChange` filtra por valor
  (`=== true || === 0`) antes de construir el `Set` que usa la app de
  clientes — si se agrega otro lector de ese nodo, hay que aplicar el
  mismo filtro en vez de asumir que "la clave existe = agotado".
- **`customerFlags/{uid}`**: solo lo escribe el dueño (`admin.js`,
  botón "Bloquear cliente" en la tarjeta de un pedido) — marca a un
  cliente para que `app.js` (`auth.isCurrentUserBlocked`) le impida
  confirmar pedidos nuevos, sin tocar su cuenta ni sus pedidos
  anteriores. Ver reglas sugeridas en `firebase-config.js`.
- **`consents/{uid}`** (`{accepted, scope, at}`): registro de
  auditoría de que alguien aceptó la política de tratamiento de datos
  (`privacidad.html`) antes de registrarse/iniciar sesión — lo escribe
  `auth.recordConsent(scope)` (compartido por `app.js`, `admin.js` y
  `driver.js`, `scope` es `'cliente' | 'panel' | 'domiciliario'`).
  Esto NO es lo que bloquea nada — el bloqueo real es la casilla
  obligatoria en cada formulario (`#auth-consent-checkbox` en
  index.html, deshabilita `#btn-google-signin`; `#admin-consent-row` /
  `#driver-consent-row`, solo visibles en modo "Registrarse", cada
  submit los valida antes de llamar a `registerWithEmail`). En el
  cliente, una vez aceptada se recuerda en `localStorage`
  (`rodizio_consent_accepted`) para no pedirla en cada login desde el
  mismo dispositivo — el registro en `consents/` sí queda cada vez que
  de verdad se llama a `signIn()`/`registerWithEmail()` con la casilla
  marcada.
- **`privacidad.html`** NO es un solo texto genérico: tiene tres
  `<section>` (`#cliente`, `#panel`, `#domiciliario`), cada una
  redactada en concreto para lo que esa app hace de verdad con los
  datos — no copiar/pegar cambios entre secciones sin adaptar el
  contenido, son intencionalmente distintas.
  **Se quedó desactualizada una vez** (mencionaba "reseñas de
  producto" — sistema ya eliminado — y le faltaban funciones que se
  agregaron después: calificar al domiciliario, recoger en tienda,
  pedido programado, nota por producto, Analytics, cancelar pedido
  con motivo, bloquear cliente, errores técnicos en Configuración,
  propina, cierre de turno/efectivo, rechazar asignación, motivo de
  "no se pudo entregar"). Corregido con una redacción concreta que
  cita las funciones reales de cada app en vez de frases genéricas —
  si se agrega o quita una función que toque datos personales
  (cualquier nodo nuevo de RTDB, un campo nuevo en `orders`, etc.),
  actualizar la sección correspondiente en el mismo cambio, no
  después. (Hubo una fecha de "última revisión" bajo el `<h1>`
  — `.policy-updated` — pero el usuario pidió quitarla del todo; no
  reintroducirla sin que la pida de nuevo.) Cada casilla de
  consentimiento enlaza directo a su sección (`privacidad.html#cliente`,
  `#panel`, `#domiciliario`) en vez de al documento genérico — si se
  agrega una cuarta app, seguir el mismo patrón (nueva sección +
  enlace con su propio `#ancla`).
  **Detalles en rojo de marca** (estilos inline propios de esta
  página, no vienen de `components.css`): franja bajo el `<h1>`,
  marcador vertical junto a cada `<h2>` de sección (mismo criterio que
  `.policy-section-eyebrow`, que ya era roja), borde izquierdo en el
  aviso legal (`.policy-note`), y estado hover en rojo para las
  pastillas de "Soy cliente/panel/domiciliario" y el enlace
  "← Volver" — todo con `var(--color-flame)`, así que si el rojo de
  marca se vuelve a ajustar en `variables.css`, esta página se
  actualiza sola sin tocarla.
  **Bug ya corregido de "scroll anchoring"**: aunque el enlace a cada
  sección siempre apuntó a su `#ancla` correcta, el salto inicial del
  navegador ocurría antes de que las fuentes async (Anton/Manrope,
  Google Fonts) terminaran de cargar — cuando el texto de arriba se
  reacomodaba al aplicar la fuente final, el navegador "compensaba" el
  scroll para no dar un salto visual (comportamiento nativo de scroll
  anchoring), dejando al usuario viendo la intro general de arriba en
  vez de su sección. Se corrigió con `overflow-anchor: none` en
  `html, body` (desactiva esa compensación en toda la página, que no
  la necesita) más un salto explícito a `location.hash` disparado en
  `document.fonts.ready` (ya con las fuentes cargadas y el layout
  final). Ojo si se agrega otro contenido que cargue diferido después
  del salto inicial (otra fuente, una imagen grande sin dimensiones
  reservadas): sin `overflow-anchor: none`, el mismo problema puede
  volver a aparecer en cualquier página que salte a un `#ancla`.
- **`drivers/{uid}`**: perfil del domiciliario — `access` (solo lo
  escribe el dueño a mano en la consola, igual que `admins/{uid}`),
  `name`/`phone`/`available` (los edita el propio domiciliario desde
  `driver.js`) y `fcmTokens` (tokens push, mismo mecanismo que
  `users/{uid}/fcmTokens` pero apuntado por `notifications.js` con
  `scope='drivers'`). `admin.js` (`subscribeDrivers`) solo guarda en
  memoria los que tienen `access === true`, para el selector
  "Domiciliario" de cada pedido.
- **`orders/{id}/driverId`, `driverName`, `driverPhone`**: los pone
  `admin.js` (`handleAssignDriver`) al elegir un domiciliario en el
  selector de la tarjeta del pedido — `driverName`/`driverPhone` se
  denormalizan ahí a propósito, porque el cliente NO tiene permiso de
  leer `drivers/{uid}` (solo el propio domiciliario y los admins), así
  que sin esa copia no podría mostrar quién le trae el pedido.
- **`orders/{id}/driverLocation` (`{lat, lng, updatedAt}`) y
  `orders/{id}/driverTrail` (array de `{lat, lng, at}`, tope
  `TRAIL_MAX_POINTS` = 80)**: un solo `watchPosition` por dispositivo
  en `driver.js` (no uno por pedido) — en cada posición nueva (cada
  `LOCATION_MIN_INTERVAL_MS` = 10s como mínimo) se recorren TODOS los
  pedidos que en ese momento estén `en_camino` y asignados a ese
  domiciliario (`activeDeliveries()`, releído de `state.orders`, no
  una lista fija) y se les escribe la misma posición — así un
  domiciliario puede llevar dos pedidos por la misma ruta y ambos
  siguen su ubicación a la vez. El recorrido de cada pedido se
  acumula aparte en memoria (`localTrails[orderId]`, recortado a
  `TRAIL_MAX_POINTS` antes de mandarlo) — se pierde si se recarga la
  página a mitad de una entrega (vuelve a empezar desde ese punto, no
  es un historial persistente). Si la app se recarga con algún pedido
  ya `en_camino`, `resumeTrackingIfNeeded()` retoma el
  `watchPosition` solo. Al marcar "Entregado", `handleDeliver()` pone
  `driverLocation` y `driverTrail` en `null` para ESE pedido — deja
  de compartirse con ese cliente y con el panel de inmediato, no solo
  queda oculto por la UI.
  `ui.js` (`driverTrackingInfo` + `trailMapsUrl`, duplicado igual en
  `admin.js`) arma un enlace de Google Maps "Cómo llegar" encadenando
  los puntos del recorrido como paradas (máximo 25 — si hay más, los
  reparte parejo con `sampleEvenly`) — no hay integración con un
  servicio de rutas real con motor de tiempos/distancias, es la
  posición real del GPS del domiciliario conectada punto a punto.
- **`orders/{id}/customerLocation` (`{lat, lng}`)**: opcional — solo
  existe si el cliente usó "Usar mi ubicación" en el checkout
  (`app.js`, `state.pendingCustomerLocation`) y no editó la dirección
  a mano después (eso la descarta, ver el listener de `input` en
  `ck-address`). No necesita una regla de RTDB nueva: como es parte
  del mismo objeto `order` que ya se crea con el pedido, la cubre la
  regla existente de "solo el dueño del pedido puede escribir al
  crearlo" — y para lectura, la regla existente de "dueño, domiciliario
  asignado, o admin" ya deja verla exactamente a quien debe verla
  (nunca a otro cliente ni a un domiciliario sin asignar). `driver.js`
  la usa para armar el enlace "Abrir en Maps" con coordenadas exactas
  en vez de la dirección de texto cuando está disponible.
- **Permisos de domiciliario sobre `orders`**: la regla de `orders`
  (`.read`/`.write` en `firebase-config.js`) ahora también deja pasar
  a quien tenga `driverId === auth.uid` en ese pedido — con acceso de
  lectura vía query `orderByChild('driverId')` y de escritura al
  pedido completo, mismo patrón (y misma limitación ya aceptada) que
  el cliente dueño del pedido.
- **`functions/index.js` → `notifyDriverAssigned`**: Cloud Function
  aparte de `notifyOrderStatusChange`, disparada por escrituras en
  `orders/{orderId}/driverId`. Manda la notificación SOLO a los
  tokens bajo `drivers/{ese uid}/fcmTokens` — nunca a todos los
  domiciliarios — igual pendiente de desplegar (plan Blaze).
- **`settings.closingTime`**: hora de cierre opcional (no controla
  `isOpen`, que sigue siendo manual) — solo dispara el aviso de
  "cerramos pronto" en `ui.renderClosingSoonBanner` cuando faltan 30
  minutos o menos, revisado cada 60s por un `setInterval` en `app.js`.
- **Paginación de pedidos en el panel**: `admin.js` (`subscribeOrders`)
  ya NO hace `onValue(ref(db,'orders'))` a secas — usa
  `query(ref(db,'orders'), orderByKey(), limitToLast(state.ordersLimit))`.
  Las llaves de `push()` en Firebase ya vienen ordenadas
  cronológicamente, así que `orderByKey()` no necesita `.indexOn`. El
  botón "Cargar pedidos anteriores" (solo visible en el filtro
  "Todos", cuando `state.ordersMaybeMore` es true) sube
  `state.ordersLimit` de a `ORDERS_PAGE_SIZE` (400) y vuelve a
  suscribirse. Cualquier cálculo que dependa de "todos los pedidos"
  (reportes, CSV) en realidad solo ve los últimos `ordersLimit` — para
  un local normal es más que suficiente, pero tenerlo presente si
  algún día un reporte parece corto.
- **`outOfStock/{productId}` decremento atómico**: `auth.js`
  (`placeOrder` → `decrementStockBestEffort`) usa `runTransaction`
  para descontar unidades al confirmar un pedido, no `set()` — evita
  que dos clientes pidiendo el último producto disponible casi al
  mismo tiempo dejen el conteo inconsistente. Las reglas de RTDB
  reflejan esto: cualquier usuario autenticado puede escribir en
  `outOfStock/$productId` SI y solo si el valor ya existente es un
  número y el nuevo valor es menor (nunca puede subir el conteo, ni
  crear uno nuevo, ni tocar un `true`) — eso lo sigue reservado a
  admins. Si se toca esta regla, hay que mantener esa asimetría.
- **`js/errors.js`**: módulo aparte (lo importan `app.js`, `admin.js`
  y `driver.js`) que escucha `window.onerror` / `unhandledrejection` y
  manda un registro liviano a `errorLogs` en RTDB — nunca debe poder
  romper la app por sí mismo (todo envuelto en try/catch, sin
  bloquear ni esperar). Solo el dueño lee ese nodo, desde
  `admin.js` (`renderErrorLog`, pestaña Reportes) — se suscribe solo
  si `state.role === 'dueno'`, un cajero no la pide aunque las reglas
  ya la bloquearían igual. También exporta `logOnValueError(context)`
  — un atajo que se pasa como tercer argumento a **todos** los
  `onValue(...)` del proyecto (catalog.js, settings.js, auth.js,
  admin.js, driver.js), para que una suscripción que falla (reglas
  desactualizadas, un corte de red a medio camino) quede registrada
  en vez de morir en silencio en la consola de cada usuario. Cualquier
  `onValue` nuevo que se agregue debe seguir el mismo patrón.
- **Repintados agrupados en el panel** (`admin.js`): `subscribeOrders`
  y `subscribeStock` ya no llaman a `renderOrders()`/`renderStockList()`
  directo en cada snapshot de Firebase — pasan por
  `scheduleRenderOrders()`/`scheduleRenderStockList()`, que agrupan
  ráfagas de cambios cercanos (varios domiciliarios mandando ubicación
  a la vez, varios cajeros cambiando estados) en un solo repintado
  cada 400ms. Antes de reconstruir el HTML, `renderOrders()` guarda
  (con `captureFocusedNoteDraft`) el texto y la posición del cursor si
  alguien está escribiendo una nota interna, y lo restaura después
  (`restoreFocusedNoteDraft`) — mismo patrón aplicado al campo de
  conteo de inventario en `renderStockList`. Cualquier otra lista que
  se reconstruya por completo en respuesta a un `onValue` de alta
  frecuencia debería seguir este mismo patrón (agrupar + preservar
  foco) en vez de repintar directo.
- **Imprimir comanda**: `admin.js` llena `#print-ticket` (vive oculto
  en `admin.html`) y llama a `window.print()`; el `@media print` en
  `admin.css` oculta todo lo demás de la página durante la impresión.
  No hay integración real con impresoras térmicas — depende del
  diálogo de impresión del navegador y de que el usuario tenga su
  impresora configurada en el sistema operativo.
- **Geolocalización del cliente** (`btn-use-location` en el checkout)
  usa la API pública de OpenStreetMap (`nominatim.openstreetmap.org`,
  sin API key) para reverse-geocoding — es la única llamada de red a
  un servicio externo que no es Firebase en todo el proyecto. Si algún
  día se agrega Google Maps con clave propia, se podría reemplazar
  por una geocodificación más precisa, pero no hay necesidad urgente.

## Seguridad — reglas que no se deben romper

- `admins/{uid}: true` en Realtime Database **solo** se escribe a
  mano desde la consola de Firebase por el dueño del proyecto. Nunca
  agregar una forma de auto-otorgarse admin desde la app, ni ofrecer
  hacerlo vía una Service Account (esa clave es la llave maestra de
  todo el proyecto — no pedírsela al usuario para atajos).
- El login del panel de admin es **correo/contraseña**, separado a
  propósito del login de clientes (**Google**) — no fusionarlos.
- `drivers/{uid}/access: true` sigue exactamente la misma regla que
  `admins/{uid}` — **solo** a mano desde la consola por el dueño,
  nunca auto-otorgado desde `driver.js` ni desde ningún flujo de la
  app. El login de `driver.html` también es correo/contraseña, propio
  y separado (no reutiliza sesión con `admin.html` ni con la app de
  clientes).
- Placeholders de credenciales pendientes en `js/firebase-config.js`:
  ninguno — `firebaseConfig` y `VAPID_KEY` ya tienen valores reales del
  usuario. No sobrescribirlos con placeholders de vuelta. (App Check
  se integró, se evaluó y se quitó del todo a pedido del usuario — no
  lo necesita por ahora; ver más abajo.)
- **Auditoría de seguridad (previa a integrar pasarela de pago)**:
  revisión completa de XSS/inyección en las 3 apps. Se encontró y
  corrigió un caso real: `ui.js` (`renderCartDrawer`) insertaba
  `item.name`/`item.notes` sin `escapeHtml()` en el carrito del
  cliente — `item.notes` es texto libre que el propio cliente escribe
  en el modal de producto, así que sin escapar era XSS (bajo impacto:
  autoataque contra su propio navegador, el carrito es local a cada
  cliente) pero igual se corrigió. El resto del sistema (tarjetas de
  pedido en `admin.js`/`driver.js`, comanda impresa, recibo del
  cliente) ya pasaba `escapeHtml()` en cada campo de texto libre
  (`customerName`, `address`, `reference`, `internalNote`, notas por
  producto) antes de insertarlo en `innerHTML` — patrón correcto,
  replicarlo en cualquier campo de texto libre nuevo que se agregue.
  **Hallazgo más importante, pendiente de decisión del usuario**: hoy
  `auth.js` (`placeOrder`) guarda `subtotal`/`shipping`/`total` tal
  como los manda el navegador del cliente — nada en las reglas de RTDB
  ni en un backend valida que esos montos correspondan de verdad a los
  precios de `products` × cantidades. Mientras todo se pague en
  efectivo contra-entrega esto es un riesgo menor (el cajero ve el
  total raro al cobrar). **En cuanto se conecte una pasarela de pago
  real, esto deja de ser aceptable**: alguien con las herramientas de
  desarrollador de su navegador podría editar el total antes de
  confirmarlo y pagar de menos. La forma correcta de resolverlo es que
  el monto a cobrar lo calcule un backend de confianza (Cloud Function
  callable, o la propia pasarela con un webhook que verifique contra
  los precios reales de `products`) en vez de confiar en el número que
  manda el cliente — no implementar el cobro real sin resolver esto
  primero.
  También se agregaron cabeceras HTTP de seguridad de bajo riesgo en
  `firebase.json` (los 3 sitios) que antes no existían:
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: strict-origin-when-cross-origin`, y
  `Permissions-Policy` (bloquea cámara/micrófono, deja geolocalización
  solo para el propio sitio — la usan el checkout del cliente y el
  rastreo GPS del domiciliario). NO se agregó un `Content-Security-
  Policy`: definirlo mal rompe la app entera (bloquea Firebase,
  Google Fonts, Nominatim, y ahora también el CDN de ExcelJS) y
  requiere probarlo con calma — queda como recomendación pendiente,
  no como algo ya resuelto.
- **App Check quitado del todo** (a pedido del usuario, poco después
  de la auditoría de arriba): se había integrado como recomendación de
  seguridad, pero el usuario decidió que no lo necesita por ahora.
  Se removió por completo de `js/firebase-config.js` (el import de
  `firebase-app-check.js`, `RECAPTCHA_SITE_KEY`, y el bloque
  `initializeAppCheck`/`ReCaptchaV3Provider`) y de la documentación
  (`README.md`, este archivo). Si se vuelve a pedir más adelante
  (ej. al conectar la pasarela de pago), el patrón para reintegrarlo
  es el mismo que ya se usó: import del SDK de App Check, una
  constante `RECAPTCHA_SITE_KEY` con placeholder, e
  `initializeAppCheck` envuelto en `if (clave !== placeholder)` para
  que no rompa nada mientras no se configure.

## PWA — instalables las tres, por separado

Las tres páginas son instalables ("Agregar a pantalla de inicio" /
"Instalar app") de forma independiente, aunque comparten el mismo
`sw.js`:
- Cada una enlaza su propio manifest: `manifest.json` (clientes),
  `manifest-admin.json` (panel), `manifest-driver.json`
  (domiciliarios) — cada uno con su propio `start_url`, `name` y
  `short_name`, para que al instalar cada una abra la página correcta
  y se distinga en el launcher del teléfono/escritorio (el ícono es el
  mismo `icon.svg` para las tres, a propósito — son la misma marca).
- Cada página (`app.js`, `admin.js`, `driver.js`) registra `sw.js` por
  su cuenta (`registerServiceWorker()`, idéntico en las tres) —
  **no basta con que index.html ya lo haya registrado en otra
  visita**: los criterios de instalabilidad del navegador se evalúan
  por página, así que si alguien entra a `admin.html` o `driver.html`
  directamente sin haber visitado nunca `index.html`, igual necesita
  que esa página registre el service worker ella misma.
- El scope de `sw.js` sigue siendo la raíz (`/`) — un solo service
  worker controla las tres, no hay conflicto entre ellas.

## Estilo / diseño

- **Rojo de marca más puro (`--color-flame`/`--color-ember`)**: a
  pedido del usuario, se ajustó el acento principal de un rojo-
  anaranjado (`#d9502a`) a un rojo más intenso y menos anaranjado
  (`#d9342a`; `--color-flame-hover` `#c22a21`; `--color-ember`
  `#8a2016`) — manteniendo el fondo claro y el resto del diseño
  intactos, solo el tono. Como estas variables están centralizadas en
  `variables.css` y las 3 apps las comparten, el cambio se propagó
  solo. Lo que SÍ hubo que tocar a mano: varios archivos (`layout.css`,
  `components.css`, `admin.css`, `driver.css`, `animations.css`)
  repetían los mismos tonos como literales `rgba(...)` (para
  degradados/glows con transparencia, ej. el brillo del hero, el
  pulso del tab activo, el destello de pedido nuevo) en vez de
  referenciar la variable — sin actualizar esos literales el brillo
  se hubiera quedado con el rojo-anaranjado viejo aunque los botones
  ya usaran el rojo nuevo. Los tres literales que aparecían repetidos
  eran `rgba(232, 93, 44, ...)` (glow, ahora `232, 65, 44`),
  `rgba(217, 80, 42, ...)` (== flame exacto, ahora `217, 52, 42`) y
  `rgba(166, 47, 27, ...)` (== ember exacto, ahora `138, 32, 22`) — si
  se vuelve a ajustar este color en el futuro, buscar por esos tres
  triples de rgb además de por el nombre de la variable, no alcanza
  con editar solo `variables.css`. `--color-danger` (rojo de
  error/cancelar, `#b23434`) y `--color-gold` (dorado de precios) NO
  se tocaron — son colores semánticos aparte, no el acento de marca.
- **Header y barra inferior en rojo de marca** (a pedido del usuario,
  después del cambio de tono de arriba): antes casi negro
  (`rgba(23, 17, 14, ...)`) en las 3 apps — ahora `.app-header`
  (`layout.css`) usa un degradado `var(--color-flame)` →
  `var(--color-ember)`, y `.bottom-nav` usa `var(--color-ember)`
  sólido. Al cambiar el fondo de negro a rojo, varios elementos que
  dependían de ese fondo oscuro (no del tono) dejaron de contrastar y
  hubo que ajustarlos en el mismo cambio:
  - `.app-header .btn-danger-link` ("Cerrar sesión" del panel/
    domiciliarios, vive directo sobre la barra): era un coral
    (`#ff8a7a`) pensado para resaltar sobre negro — sobre el rojo
    nuevo se mezclaba con el fondo (ambos rojizos); pasó a blanco.
  - `.avatar-btn` (aro del ícono de cuenta): era `var(--color-flame)`
    — un aro del mismo rojo que ahora es el fondo del header
    desaparecía; pasó a un aro blanco translúcido.
  - `.bottom-nav-item` inactivo: era `var(--color-text-faint)` (gris
    cálido pensado para negro) — apagado sobre rojo; pasó a blanco
    translúcido (`rgba(255,255,255,0.65)`).
  - `.bottom-nav-item.is-active`: era `var(--color-flame)` — activo
    con el mismo rojo que ya es el fondo de la barra se volvía
    invisible. Se probó `var(--color-gold-soft)` ("brasa encendida")
    pero el usuario pidió dejarlo en **blanco puro** (`#fff`) — más
    simple y con más contraste contra el rojo y contra el blanco
    translúcido del texto inactivo.
  - `.bottom-nav-badge`: el aro que lo recorta (`box-shadow`) usaba
    `var(--color-bg)` (el crema de la página, tenía sentido cuando la
    barra era casi negra y el aro "recortaba" contra el fondo de la
    página) — pasó a `var(--color-ember)` para recortar contra la
    barra, que es lo que ahora tiene alrededor. El fondo del badge en
    sí (`var(--color-flame)`) NO se tocó, sigue siendo el mismo rojo
    de siempre (más claro que el `--color-ember` de la barra, por eso
    se sigue distinguiendo).
  Si se vuelve a tocar el color de fondo de `.app-header`/
  `.bottom-nav` en el futuro, revisar esta misma lista — son todos
  los elementos que asumen "fondo oscuro" en vez de leer el color
  real del fondo.
- **Animaciones "premium" (2 rondas, ambas hechas)**: se evaluó
  agregar más micro-interacciones para que la app se sienta menos
  genérica. Ronda 1 (cliente, mayor impacto visible) y ronda 2
  (panel/domiciliarios) — ambas completas.
  - **Entrada escalonada de la grilla de productos**: `.product-card`
    ya tenía la animación `rise-in` (`animations.css`), pero todas las
    tarjetas aparecían a la vez. Ahora `ui.js` (`renderMenu`) le pone
    a cada tarjeta un `--i` (índice continuo a través de TODA la
    grilla que se pinta en esa llamada, no reiniciado por categoría —
    para que la cascada se sienta como una sola secuencia) vía
    `card.style.setProperty('--i', cardIndex)`; el CSS usa
    `animation-delay: min(calc(var(--i, 0) * 35ms), 320ms)` — el
    `min()` evita que una categoría con muchos productos tarde
    segundos en terminar de aparecer completa.
  - **Botón "Confirmar pedido" con spinner + check animado**: antes
    solo cambiaba el texto a "Enviando pedido…". Ahora
    `handleConfirmOrder` (`app.js`) le agrega la clase `.is-loading`
    (spinner giratorio dibujado con `::before`, ver `components.css`)
    mientras espera la respuesta de Firebase, y al confirmar con
    éxito la cambia a `.is-success` (check verde animado) por 650ms
    ANTES de cerrar el drawer del carrito y mostrar el toast — ese
    remate visual antes de cualquier otra cosa es lo que lo hace
    sentir como una confirmación real, no solo un cambio de texto. Las
    clases `.btn.is-loading`/`.btn.is-success` son genéricas a
    propósito (no ligadas a "pedido"), pensadas para reusarse después
    en otras acciones de envío de las 3 apps (ej. cierre de turno del
    domiciliario, marcar "Entregado") si se pide esa segunda ronda.
  - **Sacudida del ícono de carrito al agregar un producto**: esta ya
    existía de antes (`ui.nudgeCartNav()`, clase `.is-nudging` en
    `#nav-carrito`) — se confirmó que sigue funcionando, no se tocó.
  - **Destello en pedido nuevo (panel)**: `admin.js` ya distinguía
    pedidos "nuevos" para el sonido/toast/badge (`state.seenOrderIds`)
    pero la tarjeta aparecía de golpe con el repintado agrupado. Se
    agregó `state.justArrivedOrderIds` (se llena junto con
    `seenOrderIds` al detectar pedidos nuevos, se vacía sola a los 2s
    con `setTimeout` — solo dura el primer repintado tras llegar) y
    `renderOrderCard` le pone la clase `.is-new-arrival` a esa
    tarjeta. **Ojo con dónde va el CSS de esto**: `admin.html` NO
    carga `css/animations.css` (solo `variables/base/layout/
    components/admin`), así que el keyframe `new-order-flash` vive en
    `admin.css`, no en `animations.css` — un intento inicial de
    ponerlo en `animations.css` no tuvo ningún efecto visible hasta
    que se movió. Antes de agregar una animación nueva al panel o a
    domiciliarios, confirmar primero qué hojas de estilo carga esa
    página (`admin.html`/`driver.html` no cargan `animations.css`).
  - **Spinner de carga en los botones de acción de domiciliarios**
    (Recogí el pedido / Marcar entregado / No se pudo entregar / No
    puedo tomar este pedido): mismo espíritu que el botón de
    confirmar pedido del cliente, pero SOLO el spinner, sin el check
    de éxito — la tarjeta del pedido cambia de pestaña y desaparece de
    la lista apenas Firebase confirma el cambio de estado, así que un
    check con su propia pausa de ~650ms nunca llegaría a verse
    completo (el elemento ya se destruyó por el repintado). El
    spinner solo evita el doble toque mientras se confirma. Estos
    botones usan sus propias clases (`.driver-primary-btn`/
    `.driver-secondary-btn`, no `.btn`) porque tienen su tamaño de
    toque propio (pensado para la calle) — por eso el CSS de
    `.is-loading` está duplicado en `driver.css` en vez de reusar
    `.btn.is-loading` de `components.css` directamente, aunque
    comparte la misma keyframe `btn-spin`.
  - **Spinner + check en "Cerrar turno"**: este sí lleva el ciclo
    completo (igual que "Confirmar pedido" del cliente) porque el
    botón se queda en pantalla después de la acción, a diferencia de
    los de arriba — el check de éxito ("¡Turno cerrado!") sí llega a
    verse completo antes de restaurar el texto original. Usa la clase
    `.btn` normal (`components.css`), no las clases propias de
    domiciliarios.
  - **Spinner en "Cancelar pedido" y "Bloquear/Desbloquear cliente"
    del panel** (detalle menor pendiente de la ronda 2, ya cerrado):
    mismo criterio que los botones de domiciliarios — solo spinner,
    sin check, porque la tarjeta del pedido se vuelve a pintar apenas
    Firebase confirma. Estos botones usan `.admin-block-btn` (no
    `.btn`), que por defecto es `display: block` — su variante
    `.is-loading` cambia a `display: flex` solo mientras carga, para
    centrar el spinner junto al texto sin afectar el layout normal.
- **Barra de búsqueda siempre visible**: ya no vive detrás de un
  botón de lupa que la mostraba/ocultaba — está fija justo debajo del
  hero (con un margen negativo para que "flote" sobre el borde
  inferior del hero, estilo pastilla elevada). El botón de lupa del
  header ahora solo hace scroll + foco hacia ella, no la
  muestra/oculta. Si se toca este flujo, recordar que
  `bindBottomNavEvents` (botón "Inicio") ya no pone `hidden` en
  `#search-bar` — ahora llama a `renderMenu()` directamente al limpiar
  la búsqueda (antes de este cambio, limpiar la búsqueda desde
  "Inicio" NO refrescaba la grilla si ya estaba filtrada — quedó
  corregido de paso).
- **Carrusel "Lo más pedido"** (`ui.renderFeaturedCarousel`, sección
  `#featured-section` en `index.html`): muestra en scroll horizontal
  los productos que tengan el campo `badge` puesto desde el panel
  (Menú → producto → "Insignia") — no es una lista curada aparte, así
  que un producto aparece ahí en el momento en que se le pone
  cualquier insignia (`Menú` → editar producto). Si ningún producto
  tiene insignia, la sección se oculta sola (nunca inventa
  destacados). Se repinta junto con `renderMenu()` en `app.js`, no
  tiene su propio ciclo de suscripción.
- Emojis: el usuario pidió explícitamente eliminar TODOS los emojis
  de la interfaz — se reemplazaron por íconos SVG inline. No
  reintroducir emojis en HTML/JS generado, ni en mensajes de la UI.
- Paleta clara tema "brasa/ceniza" (`variables.css`) — hubo una
  versión con modo oscuro/claro alternable (con botón en el header),
  el usuario pidió quitar el oscuro por completo y dejar un solo
  tema, sin botón para cambiarlo; no reintroducir `data-theme` ni
  `prefers-color-scheme`. Mobile-first con breakpoints de tablet
  (720px) y escritorio (1080px, 1440px, 1920px) en `layout.css` —
  desde la reorganización responsiva, `#app`/`#admin-app`/
  `#driver-app` ya no tienen ningún `max-width`/ancho tope, ocupan el
  100% real de la pantalla siempre (los drawers/modales siguen aparte,
  usan `--max-width`, fijo, NO crecen con la pantalla). Navegación
  principal = barra inferior fija (`bottom-nav`), no un menú de header
  tradicional.
- `sw.js`: subir el número de `CACHE_NAME` (`rodizio-cucuta-vN`)
  cada vez que se edite ese archivo o cualquier archivo listado en
  `APP_SHELL`, para que los navegadores con una versión vieja cacheada
  la reemplacen.

## Diálogos propios (confirm.js) en vez de window.confirm/prompt

`js/confirm.js` reemplaza los diálogos nativos del navegador con el
mismo lenguaje visual del resto de la app (usa `.overlay` compartido
+ una tarjeta `.confirm-dialog` con el fondo/radios de `--color-surface-raised`).
Lo importan las 3 apps. Dos funciones:
- `confirmDialog(mensaje, {confirmLabel, cancelLabel, danger})` →
  `Promise<boolean>`. Reemplaza `window.confirm()`. Usado hoy en
  "Cerrar sesión" (las 3 apps), "Reintentar entrega" y "Devolver
  asignación" (domiciliario).
- `pickReasonDialog(mensaje, arrayDeOpciones)` → `Promise<string|null>`.
  Lista de botones en vez de un `<select>` nativo — usado en "No se
  pudo entregar" (domiciliario elige el motivo).
`.confirm-overlay` tiene `z-index: calc(var(--z-modal) + 100)` a
propósito — tiene que quedar por encima de CUALQUIER otra cosa
abierta (drawers, modales), porque se puede disparar desde dentro de
ellos (ej. "Cerrar sesión" desde el drawer de perfil).

## Logística de domiciliarios — casos de la vida real

Cuatro mejoras agregadas sobre el flujo básico de recoger→en
camino→entregado, pensadas en lo que de verdad le pasa a un
domiciliario:

- **"No se pudo entregar" (`orders/{id}/status = 'no_entregado'`)**:
  aparte de "Entregado"/"Cancelado". El domiciliario la marca desde
  `driver.js` (botón junto a "Marcar como entregado") eligiendo un
  motivo con `pickReasonDialog` (`deliveryFailureReason` +
  `deliveryFailureAt`, sin campo de texto libre — a propósito, para
  no tener que construir un formulario aparte). Igual que al
  entregar, se deja de compartir `driverLocation`/`driverTrail` de
  inmediato. El panel (`admin.js`) le agregó una pestaña de filtro
  "No entregado" y, en vez de los botones normales de estado, un
  único botón "Reintentar entrega" (`handleRetryDelivery`) que
  vuelve a mandarlo a "en_camino" con quien haya quedado asignado en
  el selector de domiciliario — no hay flujo de reembolso/cancelación
  desde el panel todavía (pendiente, ver abajo).
- **Rechazar/devolver una asignación**: en la pestaña "Para recoger"
  de `driver.js`, botón "No puedo tomar este pedido"
  (`handleRejectAssignment`) — limpia `driverId`/`driverName`/
  `driverPhone` del pedido (vuelve a "Sin asignar" en el selector del
  panel) y deja un `statusHistory` con nota de quién lo devolvió y
  por qué (el motivo en sí no se pide, solo que fue el domiciliario
  quien lo devolvió).
- **Rendición de efectivo al cerrar turno**: como no hay pasarela de
  pago activa, TODO pedido a domicilio se paga contra-entrega, así
  que lo que el domiciliario debe tener encima es la suma de sus
  pedidos `entregado` con `cashSettled` todavía sin poner (nuevo
  campo en `orders/{id}`). Tarjeta "Cierre de turno" en
  `driver.html` (`renderCashCard`/`handleCloseShift` en `driver.js`)
  — al cerrar, marca esos pedidos `cashSettled: true` (multi-path
  `update`) y crea un registro nuevo (nunca editable) en
  `cashSettlements/{id}` con `{driverId, driverName, expectedCash,
  actualCash, difference, ordersCount, closedAt}`, además de poner
  `drivers/{uid}/available: false`. **Falta**: una pestaña en el
  panel para que el dueño revise esos cierres — hoy solo se pueden
  consultar a mano desde la consola de Firebase (nodo
  `cashSettlements`, reglas ya listas en `firebase-config.js`).
- **Aviso de GPS perdido**: `GPS_STALE_MS` en `ui.js` y
  `DRIVER_GPS_STALE_MS` en `admin.js` (ambas 5 minutos, duplicadas a
  propósito, mismo patrón que `trailMapsUrl`) — si
  `driverLocation.updatedAt` tiene más de eso, el cliente ve un aviso
  rojo "Perdimos la señal de [domiciliario]" en vez del enlace verde
  normal, y el panel ve "Sin señal del domiciliario" en vez del
  enlace a Maps. Como esto depende de que pase el tiempo (no de que
  lleguen datos nuevos de Firebase), `app.js` repinta la lista de
  pedidos del cliente cada 30s mientras el drawer de perfil está
  abierto (`ordersFreshnessInterval`) — sin esto, el aviso solo
  aparecería la próxima vez que Firebase mande un cambio real.

## Más logística de domiciliarios: propina, reasignar

Dos agregados más sobre el flujo de entrega, pensados para que la
información que registra el domiciliario le llegue al panel (hubo
un tercero, foto de evidencia de entrega, que se implementó y luego
se quitó a pedido del usuario — si se vuelve a pedir, el patrón para
guardarla sería el mismo que se usó para lo demás: comprimir en el
navegador con `<canvas>` y guardarla como *data URL* en RTDB, sin
Firebase Storage, que el proyecto no tiene configurado):

- **Propina**: al marcar "Entregado" en `driver.js`, antes de
  guardar se le pregunta con `promptNumberDialog` (nuevo en
  `confirm.js`, campo numérico con
  "Guardar"/"Sin propina") guarda `orders/{id}/tipAmount` si el
  domiciliario escribe algo mayor a 0. Se sube al panel como chip
  "Propina $X" en la tarjeta del pedido, y se suma en
  `driver-quick-stats` ("Propinas hoy"). A propósito NO se suma al
  cálculo de "efectivo esperado" del cierre de turno
  (`unsettledDeliveredOrders` en `driver.js`) — la propina es plata
  que el domiciliario se queda, no que le deba al restaurante.
- **Reasignar a mitad de camino**: no se construyó un flujo aparte
  — se reutiliza el ya existente de "No se pudo entregar"
  agregándole un motivo más a `DELIVERY_FAILURE_REASONS` ("Tuve un
  imprevisto y no puedo continuar"). El panel ya sabía reasignar
  domiciliario + "Reintentar entrega" sobre un pedido `no_entregado`
  — es exactamente lo que hace falta para esto, sin duplicar
  plomería ni perder el `statusHistory`.

## Legibilidad — panel y app de domiciliarios

`admin.css` y `driver.css` sobreescriben localmente la escala de
tipografía y el color de texto "faint" con un bloque
`body:has(#admin-app) { ... }` / `body:has(#driver-app) { ... }` al
inicio del archivo — NO se tocó `variables.css` (eso afectaría
también a `index.html`, que no lo necesita). El truco de usar
`body:has(...)` en vez de `#admin-app { ... }` / `#driver-app { ... }`
directamente es a propósito: los diálogos de `confirm.js` se insertan
como hijos directos de `<body>` (fuera de esos contenedores), y con
`:has()` en el body los heredan igual — si solo estuviera en
`#admin-app`/`#driver-app`, el diálogo de confirmar quedaría con
letra chica ahí adentro.

- **Panel** (`admin.css`): +1px en `--fs-xs`/`--fs-sm`/`--fs-base`
  (pensado para "no forzar tanto la vista" en jornadas largas, no
  para leer de lejos) + `--color-text-faint` más claro. También se
  subieron a mano todos los `font-size: 10px/11px` sueltos que había
  en el archivo (etiquetas, chips, botones de ETA) a 12-13px — los
  del recibo de impresión (`.ticket-*`, dentro de `@media print`) se
  dejaron intactos a propósito, esos no los lee nadie en pantalla.
- **Domiciliarios** (`driver.css`): salto bastante más grande
  (`--fs-md` 18px→22px, `--fs-lg` 22px→28px, etc.) porque el caso de
  uso es literal seguridad vial — el celular montado en la moto,
  hay que poder leer de un vistazo mientras se conduce, no solo
  "más cómodo". También se subió el contraste de
  `--color-text-faint`/`--color-text-muted`, el color de
  `.driver-order-items` (antes "faint", ahora "muted"), y el tamaño
  de toque de `.driver-action-btn` (Llamar/Abrir en Maps) a
  `min-height: 48px` con más padding — pensado para tocar con
  guantes o sin mirar mucho la pantalla.

## Marketplace — mínimo, direcciones, ETA sugerido

Tres mejoras pensadas en el uso real de un cliente cualquiera (hubo
una cuarta, el sistema de cupones de descuento, que se implementó y
luego se quitó por completo a pedido del usuario — sin rastro en
código, HTML, CSS ni reglas de RTDB; si se vuelve a pedir, el patrón
sería el mismo que tenía: un módulo `coupons.js` con el patrón de
`catalog.js`/`settings.js`, nodo `coupons/{código}` en RTDB, validado
en el navegador con `runTransaction` para el conteo de usos):

- **Sugerencia para el pedido mínimo** (`app.js` →
  `bestMinOrderSuggestion`): en vez de solo avisar que falta,
  recalcula en vivo (cada vez que cambia el carrito o la dirección)
  y sugiere el producto disponible más barato que alcance a cerrar
  la diferencia en un solo agregado — o el más caro disponible si
  ninguno alcanza solo. Vive en `#min-order-hint`, debajo del total.
- **Etiquetas en direcciones guardadas**: `users/{uid}/addresses/{id}`
  ahora también guarda `label` (opcional, ej. "Casa"/"Trabajo").
  El chip de dirección guardada muestra la etiqueta si existe (si no,
  cae a mostrar la dirección completa, como antes); la dirección
  completa siempre queda como `title` (tooltip) del chip.
- **ETA sugerido** (`admin.js` → `suggestedEtaMinutes`): antes de que
  el cajero elija el tiempo estimado, se marca con "· sugerido" el
  botón (15/30/45/60 min) que corresponde según cuántos pedidos
  activos hay en cola en ese momento — son umbrales simples (≤3→15,
  ≤6→30, ≤10→45, si no→60), no un cálculo real de tiempos de cocina
  (eso necesitaría datos históricos que el proyecto no tiene). Es
  solo una sugerencia visual: el cajero sigue siendo quien elige,
  esto nunca pone el ETA solo.

## Auditoría de lanzamiento a producción

Pasada completa antes de operar con clientes reales — esto es lo que
se encontró y se corrigió (no eran features nuevas, eran cosas que ya
debían estar bien):

- **`og:image`/`twitter:image` en `index.html` tenían el placeholder
  literal `TU-DOMINIO` sin reemplazar** — nunca se había actualizado
  después de publicar en Firebase Hosting. Corregido al dominio real
  (`rodiziomarketplace.web.app`); si se conecta un dominio propio más
  adelante, hay que volver a actualizar esto (y `og:url`).
- **Ícono solo en SVG** — `apple-touch-icon` en formato SVG no lo
  renderiza Safari/iOS al agregar a pantalla de inicio (a diferencia
  de Android, que sí soporta SVG en el manifest). Se encontró un
  `icon-512.png` ya generado pero sin usar en el proyecto; se conectó
  como `apple-touch-icon` en las 3 páginas y como ícono adicional
  (`purpose: "any maskable"`) en los 3 manifests — el SVG se queda
  como ícono principal para navegador/Android, el PNG cubre iOS.
- **`.gitignore` vacío** — lo creó el asistente de `firebase init`
  pero sin contenido. Se le agregó lo básico (`node_modules/`,
  `functions/node_modules/`, `.firebase/`, logs) para cuando el
  proyecto se conecte a un repositorio Git.
- **CSV de exportación de pedidos** (`exportOrdersCSV` en `admin.js`)
  no incluía propina — se agregó esa columna para que el dueño pueda
  cuadrar caja con un solo archivo. (En su momento también se agregó
  una columna de cupón/descuento, pero se quitó junto con todo el
  sistema de cupones — ver la nota en "Marketplace — mínimo,
  direcciones, ETA sugerido".)
- **Comanda impresa** (`printOrder`) tampoco mostraba propina —
  agregado, mismo criterio.
- **`functions/index.js`**: `STATUS_LABELS` no tenía texto para
  `no_entregado`/`cancelado` — sin desplegar todavía (sigue pendiente
  de plan Blaze), pero si se despliega sin este cambio esos dos
  estados mandarían un texto crudo poco claro en la notificación push.

## Panel — cancelar pedido y ver cierres de turno

Dos funciones agregadas pensadas en el uso diario real del cajero/dueño:

- **Cancelar pedido desde el panel** (`admin-cancel-order-btn` en
  `renderOrderCard`, `handleCancelOrderFromPanel`): a diferencia del
  botón del cliente (solo los primeros `CANCEL_WINDOW_MINUTES`),
  cualquier admin (cajero o dueño) puede cancelar un pedido en
  cualquier momento mientras no esté ya `entregado` — incluso uno
  `no_entregado`, como alternativa a "Reintentar entrega". Pide un
  motivo con `pickReasonDialog` (mismo patrón que "No se pudo
  entregar" del domiciliario) y lo deja en `statusHistory`. Mismo
  comportamiento que cancelar desde el cliente: no restaura
  inventario (simplificación ya aceptada en el proyecto).
- **Cierres de turno de domiciliarios** (pestaña Reportes,
  `subscribeCashSettlements`/`renderCashSettlementsList`): antes solo
  se podían ver a mano desde la consola de Firebase — ahora el panel
  lista los últimos 50 (`cashSettlements`, más recientes primero) con
  domiciliario, esperado vs. entregado, y la diferencia. Es de solo
  lectura a propósito: ese nodo es un historial de auditoría, las
  reglas de RTDB ya impiden editar un cierre que ya existe (ver nota
  en `firebase-config.js`).

## Búsqueda de pedidos, historial del domiciliario, pedido en curso, calificar domiciliario

Cuatro agregados más, pensados en el uso diario real de cada rol
(hubo un quinto, el sistema de reseñas — reseña por producto y muro
de reseñas — que se implementó y luego se quitó por completo a
pedido del usuario; no queda rastro en código, CSS ni reglas de RTDB):

- **Buscar pedido por nombre/teléfono** (`admin.js` →
  `applyOrderSearch`/`normalizeSearchText`): input sobre los filtros
  de estado — busca sin acentos ni mayúsculas, se aplica ENCIMA del
  filtro activo (ej. "Todos" + "maría" busca entre todos los estados).
- **Historial de cierres propios del domiciliario** (`driver.js` →
  `subscribeCashHistory`): `<details>` plegable bajo la tarjeta de
  cierre de turno, con sus propios cierres anteriores. Necesitó
  ampliar la regla de `cashSettlements` para que un domiciliario
  pueda leer (antes solo podía escribir uno nuevo, nunca leer
  ninguno) — con query por `driverId`, mismo patrón que `orders`.
- **Barra de "pedido en curso"** (`#active-order-bar` en `index.html`,
  `ui.renderActiveOrderBar`): flota sobre la barra inferior mientras
  haya un pedido activo (ni entregado, cancelado, ni no_entregado).
  La suscripción a "mis pedidos" (`app.js` → `startOrdersTracking`)
  se movió de "solo mientras el drawer de perfil está abierto" a
  "toda la sesión mientras haya alguien logueado" — la alimentan
  tanto el drawer como esta barra, un solo listener para las dos.
  Tocar la barra abre el drawer de perfil (no duplica la vista).
- **Calificar al domiciliario** (`auth.js` → `rateDriver`,
  nodo `driverRatings/{orderId}`): esta SÍ se queda — es la
  calificación al domiciliario que hizo la entrega, un concepto
  aparte del sistema de reseñas de producto que se quitó. Un pedido
  solo se puede calificar una vez (la regla exige `!data.exists()`);
  al calificar, también se marca `orders/{id}/driverRatingSubmitted:
  true` para que el botón desaparezca sin tener que releer
  `driverRatings`. Reutiliza `pickReasonDialog` con opciones tipo
  "★★★☆☆ Regular" en vez de construir un selector de estrellas aparte.
  **Se detectó que quedó a medias**: el cliente sí podía calificar y
  el dato se guardaba bien en Firebase, pero nada lo leía de vuelta —
  ni el domiciliario ni el panel lo mostraban en ningún lado.
  Corregido agregando los dos lados que faltaban, ambos vía la misma
  query por `driverId` que ya usan `orders`/`cashSettlements`:
  - `driver.js` (`subscribeRatings`/`renderRatingSummary`): el propio
    domiciliario ve su promedio y cantidad de calificaciones
    (`★ 4.8 · 12 calificaciones`) bajo su nombre en el saludo
    (`#driver-rating-summary`, oculto si todavía no tiene ninguna).
  - `admin.js` (`subscribeDriverRatings`/`renderDriverRatingsList`):
    el dueño ve el promedio de CADA domiciliario habilitado en la
    pestaña Domiciliarios (bloque "Calificaciones", arriba de
    "Cierres de turno") — a diferencia del domiciliario, el dueño lee
    el nodo `driverRatings` completo (sin query, las reglas ya le dan
    acceso total) y agrega por `driverId` en el cliente.

El "4.8 · calificación" del hero (que estaba **hardcodeado** desde
antes) se quitó del todo junto con las reseñas, en vez de dejarlo
como un número fijo inventado — el hero de `index.html` volvió a
tener solo 2 datos (tiempo de entrega, ciudad), no 3.

## Reorganización del panel — menos confusión al buscar cosas

El panel había ido creciendo pestaña por pestaña y dos de ellas se
volvieron "cajón de sastre" (mezclaban cosas sin relación real entre
sí). Reorganizado así:

- **Nueva pestaña "Domiciliarios"** (`data-role="dueno"`, mismo
  patrón de visibilidad que Menú/Reportes/Configuración): antes los
  "Cierres de turno" vivían dentro de Reportes, pero un dueño
  buscando algo de un domiciliario no piensa en "Reportes" — piensa
  en "Domiciliarios". Sola por ahora (un solo bloque), pero ya con
  pestaña propia para cuando se agregue más (ej. lista de
  domiciliarios activos).
- **"Reportes" quedó solo con métricas de negocio de verdad**: Ventas,
  Productos más vendidos, Exportar CSV — se sacaron "Cierres de
  turno" (ver arriba) y "Errores recientes" (ver abajo), que no son
  reportes de negocio.
- **"Errores recientes" se movió a Configuración**, dentro de un
  `<details>` plegado por defecto llamado "Avanzado" — es una
  herramienta técnica de depuración, no algo que un cajero necesite
  ver a diario; sigue ahí para cuando haga falta, pero no compite
  visualmente con lo que sí se usa seguido.
- **Navegación rápida (`.admin-jump-nav`)** al inicio de
  Configuración: pastillas ancla (`<a href="#config-...">`) a cada
  una de sus secciones (Datos del negocio, Zonas, Avanzado — antes
  también "Cupones", quitada junto con todo ese sistema) — evita
  tener que desplazarse a ciegas. Usa anclas HTML
  normales + `scroll-behavior: smooth` (nuevo en `base.css`, global
  a las 3 apps) — no hace falta JS aparte para el salto.
- Al agregar `#tab-domiciliarios`, no olvidar que existe una regla
  de layout de escritorio (`admin.css`, `@media (min-width: 1080px)`)
  que lista los IDs de sección explícitamente para ubicarlos en la
  columna del contenido (`grid-column: 2`) — un tab nuevo que no se
  agregue a esa lista se ve roto solo en pantallas anchas, no en
  celular (así se me pasó la primera vez con este mismo cambio).

## Reorganización de marketplace y domiciliarios — mismo criterio que el panel

Mismo espíritu que la reorganización del panel: lo que se usa a
diario queda primero y bien separado, lo que se usa poco se pliega o
se etiqueta aparte, sin cambiar ninguna lógica de negocio.

- **Checkout del cliente** (`index.html` → `#checkout-view`): era un
  solo formulario largo sin secciones visuales (modo de entrega,
  dirección, teléfono, hora y total, todo seguido). Se le agregaron
  encabezados cortos (`.checkout-section-title`): "¿Cómo lo quieres?",
  "Datos de contacto", "¿Cuándo?", "Resumen" (había un cuarto,
  "¿Tienes un cupón?", quitado junto con el sistema de cupones) — y
  el resumen de totales quedó en una caja con borde propia
  (`.checkout-summary-box`) en vez de flotar suelto al final.
  Ningún campo cambió de sitio, solo se agruparon visualmente.
- **App de domiciliarios** (`driver.html`): el orden de arriba a
  abajo antes era Saludo → Mi perfil (nombre/teléfono) → Cierre de
  turno → Pedidos — es decir, lo que el domiciliario más necesita ver
  al abrir la app (sus pedidos) quedaba enterrado debajo de dos
  tarjetas que casi no se tocan en el día a día. Nuevo orden: Saludo
  → **Pedidos** (tabs + lista, ahora lo primero) → Cierre de turno
  (se revisa varias veces al día, se deja visible) → **Mi perfil**
  (ahora un `<details open>` con su propio título y flecha — se llena
  una sola vez, por eso es plegable, pero abierto por defecto la
  primera vez para que no falte quien no sepa que existe).

## Pestañas del panel rotas en celular/tablet

`.admin-tabs` reutiliza `.segmented` (components.css), pensado para
2-3 botones repartidos en partes iguales (`flex:1`) — con las 6
pestañas que tiene hoy el panel (Pedidos/Inventario/Menú/
Domiciliarios/Reportes/Configuración), eso las aplastaba y cortaba
"Configuración" fuera de la pantalla en celular y tablet (se veía
bien solo desde 1080px, donde ya pasa a barra lateral vertical).
Corregido en `admin.css`: por debajo de 1080px, `.admin-tabs` ya no
reparte en partes iguales — se desliza horizontal (`overflow-x:
auto`) con cada botón del ancho de su propio texto (`flex: none`,
`white-space: nowrap`), mismo patrón que `.admin-filter-row`. A
1080px+ se resetea a `overflow-x: visible` porque ahí la barra lateral
ya no necesita deslizarse (los botones se apilan verticales y ocupan
el ancho completo). Si se agrega una séptima pestaña algún día, esto
ya escala solo — no hace falta tocar nada más.

## Funciones del checkout que ya existen (no volver a darlas por faltantes)

Comparando contra plataformas de pedidos de otros restaurantes se
detectó que estas 4 funciones **ya estaban implementadas** desde
antes pero no quedaban documentadas aquí — quedó registrado para no
"redescubrirlas" como pendientes en una futura sesión:

- **Costo de domicilio visible**: `app.js` (`currentShippingFee()`)
  calcula el valor según la zona (`matchZone`) o el
  `defaultShippingFee` de `settings`, y `ui.renderCheckoutTotals`
  lo muestra en la fila "Domicilio" del resumen del checkout, antes
  de confirmar el pedido.
- **Recoger en tienda**: toggle `#delivery-mode` con
  `data-mode="recoger"` en `index.html` — pone `state.deliveryMode`,
  oculta los campos de dirección (`#address-fields`), pone el
  domicilio en $0, y el pedido queda con `deliveryMode: 'recoger'`.
  El panel (`admin.js`, `renderOrderCard`) ya distingue "Recoger en
  tienda" de "A domicilio" en la etiqueta del pedido.
- **Pedido programado**: toggle `#schedule-mode` ("Lo antes
  posible"/"Programar") + `#ck-schedule-time` (solo hora, no día —
  a diferencia de otras plataformas que dejan elegir el día, aquí
  es siempre para el mismo día) — `resolveScheduledFor()` en
  `app.js` valida la hora y guarda `order.scheduledFor`; el panel
  muestra un chip "Programado HH:MM" en vez de "hace X minutos".
- **Nota por producto**: el modal de producto (`#modal-notes` en
  `openProductModal`, `ui.js`) guarda una nota de texto libre por
  ítem — `cart.js` la usa como parte de la clave del ítem (dos
  mismas hamburguesas con notas distintas quedan en filas separadas
  del carrito), se ve en el carrito (`· nota` junto al precio) y en
  la comanda impresa (`ticket-notes`). Lo único que le faltaba era
  aparecer también en el resumen rápido de la tarjeta de pedido del
  panel (antes solo `2× Combo Bacon`, sin la nota) — corregido en
  `renderOrderCard` (`admin.js`) para mostrar
  `2× Combo Bacon (sin cebolla)`.

## Un solo tema — se quitó el modo oscuro (historial)

Hubo una etapa donde el proyecto tuvo modo oscuro/claro alternable
con un botón en el header (`js/theme.js`, `data-theme="light"` en
`<html>`, preferencia en `localStorage`) — el usuario pidió quitar el
oscuro por completo y dejar un único tema claro, sin botón para
cambiarlo. Se eliminó todo rastro: `js/theme.js` borrado, el botón
`#btn-theme-toggle` y el script inline anti-parpadeo quitados de las
3 páginas, y `css/variables.css` quedó con un solo bloque `:root`
(los valores que antes eran del modo claro, que es el que se
conservó) — nunca más un bloque `:root[data-theme='light']` aparte.
Los bloques `body:has(#admin-app)`/`body:has(#driver-app)` que
redefinían `--color-text-faint`/`--color-text-muted` por app (ver
"Legibilidad — panel y app de domiciliarios" más abajo) volvieron a
ser una sola regla incondicional cada uno, sin el prefijo de tema que
tenían antes. Si en el futuro se vuelve a pedir un modo oscuro, no
hay que reconstruirlo desde cero: el historial de git (o la versión
antes de este cambio) tiene la implementación completa ya resuelta,
incluidos varios gotchas de especificidad CSS que costó encontrar
(ver más abajo qué se aprendió de eso, aunque el código en sí ya no
esté).

**Lo que quedó permanentemente del trabajo de ese modo claro** (el
tema final, ahora el único): la paleta cálida clara actual en
`variables.css`, el degradado suave del hero/pantalla de acceso
(`--hero-glow-1/2` en vez de un rgba fijo directo en el selector —
el valor original pensado para fundirse en negro se veía como un
lavado salmón muy intenso sobre fondo claro), `--color-surface-raised`
sin ser blanco puro (menos salto duro contra el crema del fondo), y
sombras (`--shadow-card`/`--shadow-float`) más suaves. También quedó
la corrección de `.app-header .brand-name`/`.app-header
.btn-danger-link` en `layout.css`: la barra del header es oscura a
propósito (contraste de marca), así que ese texto no puede seguir
`var(--color-text)`/`var(--color-danger)` (pensados para el fondo
claro del resto del sitio) — se fijaron a un color claro/rojo propio
que se lea sobre esa barra oscura, sin tocar esas mismas clases fuera
del header.

## Responsivo — sin ancho tope, ocupa toda la pantalla real

Versión final de esto (dos vueltas): primero se intentó que
`#app`/`#admin-app`/`#driver-app` crecieran con la pantalla pero con
un tope fluido (`min(1600px, 92vw)`, etc.) — visualmente eso seguía
dejando una franja/sombra notoria a los lados en cualquier celular
grande, tablet o monitor (el usuario lo describió como "se ve
recortado" y "esa sombra a la derecha"). Se quitó el tope por
completo: **`#app`, `#admin-app` y `#driver-app` ya no tienen
`max-width`/`margin: auto` en ningún breakpoint — ocupan el 100% real
del ancho de pantalla siempre**, en celular, tablet, portátil y
monitor de escritorio por igual. Lo único que cambia con el ancho de
pantalla es cuántas columnas tiene cada grilla de tarjetas
(`.product-grid`, listas del panel, `#driver-orders-list` — hasta 5
columnas a partir de 1920px) y algunos paddings/tamaños de texto —
nunca un tope de ancho del shell completo. Drawers y modales siguen
sin crecer (`--max-width`, fijo, sin tocar) porque un panel de
carrito no debe verse como una página completa en un monitor grande;
tampoco se tocaron topes puntuales de tarjetas sueltas como
`.driver-profile-card`/`.driver-quick-stats`, esos son intencionales.

**Ya no existe `--app-width`** (se quitó de `variables.css`) — si en
el futuro hace falta centrar algo fijo dentro de un shell que ahora
es 100% ancho, no revivir ese patrón; usar un `max-width` puntual en
el elemento mismo, como ya se hace con `.driver-profile-card`.

**La "sombra a la derecha" que el usuario seguía viendo después de
esto (en celular Y en escritorio, hasta en incógnito) NO era el ancho
del shell** — para cuando se reportó, el `max-width` de arriba ya
estaba desplegado y confirmado sin overflow (`scrollWidth ===
innerWidth` probado en vivo contra el sitio real). La causa de
verdad: `base.css` tiene una regla `::-webkit-scrollbar` global (para
que la barra de scroll se vea delgada/discreta en vez de la del
sistema) que le ponía color al "thumb" (`--color-border`) pero nunca
al "track" (el riel de fondo) — sin eso, el navegador dibuja el track
con su gris/negro por defecto, pegado al borde derecho de TODA la
página, de arriba a abajo — mucho más notorio en modo claro contra el
fondo crema. Se corrigió agregando `::-webkit-scrollbar-track {
background: var(--color-bg); }` (se adapta solo con el tema) más el
equivalente de Firefox (`scrollbar-width: thin; scrollbar-color:
var(--color-border) var(--color-bg);` en `html`). Ojo para el futuro:
el navegador de pruebas (Claude Browser) no renderiza la barra de
scroll del sistema en las capturas de pantalla, así que este tipo de
bug es invisible en las pruebas automatizadas de este proyecto — hay
que pedirle una captura real al usuario o razonarlo por descarte
cuando el ancho/overflow ya está descartado mediante JS
(`document.documentElement.scrollWidth` vs `innerWidth`).

**La causa de fondo de verdad, la que sobrevivió a las dos correcciones
anteriores** (el usuario la siguió reportando después del fix de
ancho Y del fix de scrollbar-track): `.drawer` (carrito/perfil, en
`layout.css`) tenía `box-shadow: -12px 0 40px rgba(0,0,0,0.5)` puesto
de forma incondicional, no solo en `.drawer.is-open`. Aunque el
drawer cerrado está fuera de pantalla (`transform: translateX(100%)`,
por `right: 0` eso lo saca exactamente al ras del borde derecho del
viewport), un `box-shadow` con 40px de desenfoque igual pinta más
allá de la caja del elemento — ese desenfoque se colaba de vuelta
hacia adentro del viewport por el borde derecho, visible como una
franja oscura vertical en TODA la pantalla (carrito y perfil son
drawers, así que siempre hay uno "cerrado" montado en el DOM). Esto
pasaba en cualquier navegador/dispositivo, a diferencia de los dos
bugs anteriores (ancho del shell, color del track del scroll) — por
eso sobrevivía a ambos fixes y hasta al modo incógnito. Corregido
moviendo el `box-shadow` a `.drawer.is-open` únicamente (con
`box-shadow: none` en el estado base y una transición de
`box-shadow` agregada junto a la de `transform`, para que no aparezca
de golpe). Si se agrega otro drawer/panel deslizante en el futuro,
revisar esto de una vez: cualquier `box-shadow` con blur grande en un
elemento `position: fixed` que se "esconde" solo con `transform`
(nunca con `display`/`visibility`) puede filtrarse de vuelta al
viewport de la misma forma.

**De paso, un bug de overflow en el header que ya venía de antes**
(no de este cambio puntual, pero se notó al probar el responsivo): con
6 botones de ícono en el header (tema, llamar, WhatsApp, Instagram,
buscar, cuenta) más el nombre de marca, en un celular angosto (~375-
430px) el conjunto ya no cabía y el ícono de cuenta se salía del
header en vez de quedar recortado o deslizable. Causa raíz:
`.header-actions` es un hijo flex, y un hijo flex por defecto no se
encoge por debajo del ancho de su propio contenido (`min-width: auto`
implícito) — así que un `overflow-x: auto` puesto ahí sin más nunca
llegaba a activarse. Se corrigió con `min-width: 0` en
`.header-actions` (para que el overflow sí aplique, mismo patrón de
`.admin-tabs`/`.admin-filter-row`: scroll horizontal con scrollbar
oculta) más un `@media (max-width: 480px)` que esconde el texto de
marca (queda el logo solo) y achica un poco los botones — entre las
dos cosas, en la práctica ya no hace falta deslizar en un celular
normal. Cualquier botón nuevo que se agregue al header en el futuro
debe tenerse en cuenta contra este mismo límite.

## Comanda impresa y exportación a Excel — dos bugs reales encontrados

- **Comanda impresa con páginas en blanco de más**: el `@media print`
  (`admin.css`) ocultaba el resto del panel con
  `body * { visibility: hidden }` en vez de `display: none`.
  `visibility: hidden` NO saca el elemento del flujo del documento —
  `#admin-app` (con toda la lista de pedidos, modales, etc.) seguía
  ocupando su alto real aunque invisible, así que el navegador
  generaba tantas páginas en blanco como hiciera falta para "imprimir"
  ese alto vacío (una comanda de una sola página terminaba en 5+
  páginas). Corregido con `body > *:not(#print-ticket) { display:
  none !important; }` — eso sí saca todo lo demás del flujo, el
  documento impreso mide exactamente lo que mide la comanda. Si se
  agrega otra plantilla de impresión en el futuro (ej. un recibo para
  el cliente), aplicar el mismo patrón, nunca `visibility: hidden`
  para "ocultar" contenido que no debe ocupar espacio.
- **Logo de la comanda invisible en computador pero no en celular**:
  `printOrder` (`admin.js`) insertaba el `<img>` del logo con
  `innerHTML` y llamaba a `window.print()` en el mismo instante,
  síncrono — en computador, la vista previa de impresión de Chrome
  puede generarse antes de que el navegador termine de cargar esa
  imagen recién creada, y sale en blanco. En celular casi nunca pasa
  porque abrir la hoja de compartir/imprimir nativa ya toma más
  tiempo, de sobra para que cargue. Corregido haciendo `printOrder`
  `async` y esperando el evento `load` (o `error`, o un margen de
  800ms) del `<img class="ticket-logo">` antes de llamar a
  `window.print()`. Si se agrega otra imagen a la comanda, debe pasar
  por el mismo `await` antes de imprimir.
- **Exportación a Excel reescrita de cero**: `exportOrdersCSV` (ahora
  `exportOrdersXLSX`, `admin.js`) generaba un `.csv` crudo — sin
  formato de moneda, la columna de productos como un solo texto largo
  sin ajustar, sin nada de marca — que se veía "desordenado" al
  abrirlo en Excel. Ahora genera un `.xlsx` de verdad con **ExcelJS**
  (librería externa, cargada solo cuando se pulsa el botón —
  `loadExcelJS()` inyecta el script de `cdn.jsdelivr.net` una sola vez
  y cachea la promesa; no vale la pena sumarla al App Shell para algo
  que se usa una vez cada tanto). El archivo generado tiene: una
  franja roja de encabezado con el logo (`icon-512.png`, insertado
  como imagen real — el `.svg` del proyecto no sirve para esto,
  ExcelJS solo embebe PNG/JPEG/GIF) y el nombre del restaurante,
  columnas con ancho fijo pensado para el contenido de cada una,
  texto de productos con salto de línea dentro de la celda
  (`\n` + `wrapText: true`, no todo en una sola línea con `|` como
  antes), montos con formato de pesos colombianos (`"$"#,##0`), y la
  fila de encabezados de columna congelada (`views: [{state:'frozen',
  ySplit: 4}]`) para poder desplazarse por muchos pedidos sin perder
  de vista qué es cada columna. Si el logo no se puede leer por
  cualquier motivo, la exportación sigue sin él (nunca bloquea todo el
  archivo por eso). El botón (`#btn-export-orders-csv` — el id se dejó
  igual para no tocar CSS/HTML de más, aunque ya no exporta CSV) queda
  con `.is-loading` mientras genera el archivo, mismo patrón visual
  que el resto de acciones de envío del sistema.

## Pendiente conocido (no asumir que ya está resuelto)

- Pasarela de pago: deliberadamente en pausa — el usuario no ha
  elegido proveedor (Wompi/PayU/Mercado Pago) ni tiene cuenta creada
  todavía. No implementar nada de esto sin que el usuario elija.
- Cloud Functions de notificaciones push (`functions/index.js`,
  `notifyOrderStatusChange` y `notifyDriverAssigned`) escritas pero no
  desplegadas (necesita plan Blaze + `firebase deploy` desde la
  sesión del usuario).
- Ningún domiciliario tiene `drivers/{uid}/access` todavía — hasta que
  el usuario habilite al menos uno a mano, el selector "Domiciliario"
  del panel va a aparecer vacío (solo "Sin asignar").
- No hay integración con un servicio de rutas/tiempos de viaje real
  (Google Maps Directions API o similar) — el rastreo del
  domiciliario es la posición cruda (lat/lng), no una ruta ni un ETA
  calculado por distancia. No agregar esto sin que el usuario decida
  pagar/conseguir una clave de ese tipo de API.
- Reglas de Realtime Database: revisar si lo que está publicado en la
  consola coincide con el bloque comentado al final de
  `js/firebase-config.js` antes de asumir que una función nueva
  relacionada con la base de datos ya funciona en producción.
