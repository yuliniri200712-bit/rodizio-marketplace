# Rodízio Cúcuta — Menú, pedidos y panel de administración

App de pedidos para un restaurante, instalable como PWA en el celular
del cliente. HTML, CSS y JavaScript puro (sin frameworks ni build
step), conectada a un proyecto real de Firebase (**Realtime
Database**, no Firestore). Incluye un panel aparte para que el
restaurante administre pedidos y menú sin tocar código.

## Estado actual (resumen rápido)

✅ Funcionando: menú con búsqueda y categorías, carrito, checkout
(domicilio/recoger, programar entrega), horario de atención y pedido
mínimo a domicilio configurables, zonas de cobertura con costo de
domicilio propio, calculadora de porciones, botón de "usar mi
ubicación" en el checkout, botón para llamar al restaurante, login de
clientes con Google, pedidos en tiempo real con seguimiento de
estado, cancelar pedido los primeros minutos, calificar tras la
entrega, notificaciones push (lado cliente listo), favoritos, repetir
pedido, reseñas y calificación por producto, compartir pedido por
WhatsApp, direcciones guardadas, analítica (Firebase Analytics),
diseño responsivo (móvil/tablet/portátil/escritorio, **las tres apps**
— clientes, panel y domiciliarios); panel de administración
con login propio (correo/contraseña) y **roles** (dueño / cajero),
aviso sonoro de pedido nuevo, cola de pedidos priorizada, vista de
programados, cancelar pedidos, historial de cambios de estado,
imprimir comanda, reportes de ventas, editar el menú completo, y
configurar todo lo del párrafo anterior (horario, mínimo, zonas,
teléfono) sin tocar código. Además: aviso de "cerramos pronto", nota
para la cocina por producto, recibo detallado del pedido, "agregar
todos mis favoritos" con un toque, tiempo estimado de entrega que
pone el cajero, inventario con conteo de unidades ("quedan pocas"),
notas internas por pedido (no las ve el cliente), resumen de cierre
del día y exportar los pedidos de hoy a CSV, y marcar/desmarcar un
cliente problemático (solo el dueño).

🛡️ Preparado para crecer: el panel ya no carga el historial completo
de pedidos de una sola vez (pagina de 400 en 400, con botón "Cargar
pedidos anteriores"), el inventario se descuenta de forma atómica al
confirmar un pedido (evita sobrevender en horas pico), y hay un
registro básico de errores de JavaScript visible en el panel
(Reportes → "Errores recientes") para enterarte si algo se rompe sin
esperar a que un cliente se queje. Ver la sección "Preparado para
crecer" más abajo — incluye lo que **no** se puede resolver sin que
tú revises algo (el plan de Firebase, por ejemplo).

🛵 **Nueva app de domiciliarios** (`driver.html`) — el panel asigna
un pedido a domicilio a un domiciliario concreto (selector
"Domiciliario" en cada tarjeta del pedido), ese domiciliario ve solo
sus pedidos asignados, marca "Recogí el pedido" (empieza a compartir
su ubicación en vivo) y "Entregado" — el cliente ve esa ubicación en
tiempo real en "Mi cuenta" con un enlace a Google Maps. Ver la
sección **"App de domiciliarios"** más abajo para el detalle completo.

⏳ Pendiente de acción tuya (ver detalle en cada sección más abajo):
1. **Volver a publicar las reglas de Realtime Database** — cambiaron
   otra vez (nodo `customerFlags`, nodo `errorLogs`, nodo `drivers`
   nuevo para domiciliarios, nodo `consents` nuevo para el
   consentimiento de datos, y las reglas de `outOfStock` y `orders`
   ajustadas).
2. **Habilitar al menos un domiciliario** — igual que con los admins,
   alguien se registra en `driver.html` y tú le agregas
   `drivers/{uid}/access: true` a mano en la consola (ver detalle en
   la sección "App de domiciliarios").
3. **Desplegar las Cloud Functions** de notificaciones push (necesita
   plan Blaze) para que las notificaciones se envíen de verdad —
   tanto la del cliente (cambio de estado) como la del domiciliario
   (pedido asignado).
4. **Pasarela de pago** — todavía no se integró; en pausa hasta que
   tengas cuenta con Wompi, PayU o Mercado Pago.

## Cómo abrir la app

Los navegadores exigen `http(s)://` (no `file://`) para que los
módulos JS, el manifest y el service worker funcionen — **no abras
`index.html` con doble clic**, no va a cargar.

**Necesitas [Node.js](https://nodejs.org/) instalado** (trae `npm`
incluido). Con eso, desde una terminal en la carpeta del proyecto:

```bash
npm install   # solo la primera vez (o si cambia package.json)
npm start     # levanta el servidor local
```

Deja esa terminal abierta mientras uses la app, y abre en el
navegador:

- App de clientes: `http://localhost:8080/`
- Panel de administración: `http://localhost:8080/admin.html`
- App de domiciliarios: `http://localhost:8080/driver.html`

Para cerrar el servidor, vuelve a la terminal y presiona `Ctrl+C`.

> No hay dependencias externas que descargar — `npm install` solo
> deja listo el proyecto para correr con `npm start`, que internamente
> ejecuta el servidor local propio (`server.js`, sin frameworks).

## Estructura del proyecto

```
index.html            → App de clientes: menú, carrito, checkout, perfil.
admin.html             → Panel del restaurante (página aparte).
driver.html             → App de domiciliarios (página aparte).
privacidad.html           → Aviso de tratamiento de datos personales (enlazado desde las 3 apps).
manifest.json            → Metadatos de la PWA (app de clientes).
manifest-admin.json        → Metadatos de la PWA del panel (propio start_url/nombre).
manifest-driver.json         → Metadatos de la PWA de domiciliarios (propio start_url/nombre).
sw.js                     → Service Worker: caché offline + notificaciones push en 2do plano (debe vivir en la raíz para controlar todo el sitio).
server.js                  → Servidor local mínimo (lo ejecuta "npm start").
package.json                 → Define el comando "npm start".
firebase.json                  → Config del Firebase CLI (para desplegar las Cloud Functions).
.firebaserc                       → Proyecto de Firebase por defecto (rodiziomarketplace).
icon.svg                            → Logo / ícono de la PWA.

css/
  variables.css | base.css | layout.css | components.css | animations.css | admin.css | driver.css
                        → Estilos, en capas de responsabilidad separadas (driver.css reutiliza admin.css).

js/
  firebase-config.js    → ÚNICO archivo con credenciales/claves de Firebase.
  data.js                → Menú "de fábrica" (semilla + respaldo si la BD está vacía).
  catalog.js               → Categorías/productos en Realtime Database (lee la app, escribe el panel).
  settings.js                → Configuración del negocio (horario, mínimo, zonas de cobertura) en Realtime Database.
  cart.js                      → Estado del carrito (localStorage).
  favorites.js                   → Favoritos del cliente (localStorage).
  auth.js                          → Login (Google para clientes, correo/contraseña para panel/domiciliarios) + pedidos + reseñas + direcciones en Realtime Database.
  notifications.js                   → Notificaciones push: pedir permiso, guardar token (clientes o domiciliarios, según a quién se llame).
  errors.js                            → Registro de errores de JavaScript en Realtime Database (lo usan app.js y admin.js).
  analytics.js                           → Un solo punto de entrada (track) para Firebase Analytics.
  ui.js                                    → Funciones de renderizado del lado cliente (pintan HTML a partir del estado).
  app.js                                     → Orquestador de la app de clientes.
  admin.js                                     → Lógica del panel de administración (independiente de app.js/ui.js).
  driver.js                                      → Lógica de la app de domiciliarios (independiente de las otras dos).

functions/               → Cloud Functions: avisan al cliente cuando cambia el estado de su pedido, y al domiciliario cuando le asignan uno (se despliegan aparte, ver más abajo).

images/                   → Fotos del menú (+ CREDITS.json con la atribución de las que trae el proyecto).
```

## Firebase — qué está conectado

El proyecto real ya está conectado en `js/firebase-config.js`
(`rodiziomarketplace`, Realtime Database en
`https://rodiziomarketplace-default-rtdb.firebaseio.com`). Si alguna
vez necesitas reconectar a otro proyecto, ese es el único archivo que
hay que tocar — trae comentarios explicando de dónde sale cada valor.

Servicios de Firebase en uso: **Authentication** (Google + Email/Password),
**Realtime Database**, **Cloud Messaging** (push), **Analytics**,
**Cloud Functions** (solo la de notificaciones, se despliega aparte).

### Reglas de Realtime Database

Debes tener publicadas las reglas completas que están comentadas al
final de `js/firebase-config.js` (cubren `orders`, `drivers`,
`consents`, `users` —fcmTokens y addresses—, `admins`, `outOfStock`,
`errorLogs`, `customerFlags`, `categories`, `products`, `settings`,
`cashSettlements` y `driverRatings`). Si agregaste una
función nueva y algo deja de leer/escribir sin razón aparente, lo
primero que hay que revisar es si las reglas publicadas coinciden con
las de ese archivo.

## Consentimiento de tratamiento de datos

Las tres apps (clientes, panel, domiciliarios) piden autorización
explícita antes de crear una cuenta o iniciar sesión:

- **App de clientes**: en el modal de "Iniciar sesión", una casilla
  obligatoria bloquea el botón "Continuar con Google" hasta que se
  marca — enlaza a [`privacidad.html#cliente`](privacidad.html#cliente).
  Una vez aceptada en un dispositivo, no vuelve a pedirla en ese mismo
  navegador (se recuerda con `localStorage`), pero si inicia sesión
  desde otro dispositivo la vuelve a pedir.
- **Panel** (`privacidad.html#panel`) **y app de domiciliarios**
  (`privacidad.html#domiciliario`): la casilla solo aparece en el
  formulario de **registro** (crear cuenta nueva) — es obligatoria, si
  no está marcada no deja crear la cuenta.

[`privacidad.html`](privacidad.html) no es un solo texto genérico
repetido tres veces — tiene tres secciones distintas (con su propio
enlace directo, ver arriba), cada una escrita en concreto para lo que
esa app en particular hace con los datos: la de clientes explica los
favoritos/carrito guardados solo en el celular, las reseñas públicas y
quién ve tu ubicación si la compartes; la del panel explica el
historial de auditoría de acciones (qué cajero cambió qué pedido y
cuándo) y qué datos sensibles de clientes/domiciliarios vas a ver; la
de domiciliarios explica en detalle cuándo empieza y —sobre todo—
cuándo termina de compartirse tu ubicación en vivo.

Cada vez que alguien acepta, queda un registro de auditoría en
Realtime Database (`consents/{uid}`, con fecha y desde cuál de las
tres apps) — cada quien solo puede escribir el suyo, y solo un admin
puede leer los de los demás. Esto **no reemplaza una asesoría legal**:
es un aviso honesto de lo que cada app realmente hace con los datos,
pero si operas este negocio de forma real, te recomendamos que un
abogado lo revise y confirmes si necesitas registrar tu base de datos
ante la Superintendencia de Industria y Comercio (SIC).

## Panel de administración (`admin.html`)

Página aparte para el restaurante: ver todos los pedidos (con aviso
sonoro cuando llega uno nuevo), cambiar su estado con un clic,
cancelar pedidos, ver el historial de quién cambió cada estado,
imprimir la comanda de un pedido, ver los pedidos programados por
separado, marcar productos agotados, ver reportes de ventas, editar
el menú completo, y configurar el horario/mínimo/zonas del negocio —
todo sin tocar código.

**Login del panel = correo y contraseña** (no Google — la app de
clientes sí sigue usando Google; son sistemas de login separados a
propósito). Requiere tener habilitado **Authentication → Sign-in
method → Email/Password** en Firebase Console.

### Roles: dueño y cajero

Hay dos niveles de acceso, según el valor que le pongas a
`admins/{uid}` en Realtime Database:

| Valor en `admins/{uid}` | Rol | Qué puede hacer |
|---|---|---|
| `true` (como antes) | Dueño | Todo — pestañas Pedidos, Inventario, Menú, Reportes y Configuración. |
| `"dueno"` | Dueño | Igual que `true` — forma nueva y recomendada para cuentas nuevas. |
| `"cajero"` | Cajero | Solo Pedidos e Inventario. No ve Menú, Reportes ni Configuración. |

Para darle acceso a alguien:
1. Esa persona entra a `admin.html`, hace clic en "¿No tienes cuenta?
   Regístrate", crea su cuenta con correo y contraseña (le va a decir
   "No tienes acceso" después de crearla — es normal, crear la cuenta
   no da acceso automático).
2. Tú vas a **Authentication → pestaña "Users"** en Firebase Console,
   copias su `User UID`.
3. Vas a **Realtime Database → pestaña "Datos"** → agregas a mano
   `admins/{ese-uid}` con el valor `true`/`"dueno"` (dueño) o
   `"cajero"` (cajero, según la tabla de arriba). Esto NUNCA se hace
   desde la app, a propósito (por seguridad — ni la app ni Claude
   pueden auto-otorgar acceso de administrador).

### Configuración del negocio (pestaña "Configuración", solo dueño)

Un formulario que controla, sin tocar código:
- **Aceptando pedidos ahora mismo** — si lo apagas, los clientes ven
  un aviso y no pueden confirmar pedidos hasta que lo vuelvas a
  encender.
- **Pedido mínimo a domicilio** y **costo de domicilio por defecto**.
- **Zonas de cobertura**: le pones un nombre, unas palabras clave
  (ej. "centro, quinta, manzano") y un costo de domicilio propio —
  cuando la dirección del cliente contiene esas palabras, se usa ese
  costo en vez del de por defecto. No es un mapa real, es una
  coincidencia de texto simple. Si activas "Rechazar pedidos fuera de
  las zonas", un cliente cuya dirección no coincida con ninguna zona
  no podrá confirmar el pedido.
- **Teléfono del restaurante** — aparece como botón de llamar en el
  header de la app de clientes.

### Reportes de ventas (pestaña "Reportes", solo dueño)

Ventas de hoy y de los últimos 7 días (con cantidad de pedidos), y
los 5 productos más vendidos de los últimos 30 días. Se calcula en
el navegador a partir de los pedidos ya cargados — no hace falta
configurar nada aparte.

### Imprimir comanda

Cada pedido tiene un botón de imprimir que abre el diálogo de
impresión normal del navegador con solo los datos de ese pedido
(cliente, dirección, productos, total, nota interna si tiene) —
funciona con cualquier impresora ya configurada en el computador
(térmica de recibos o normal), sin necesitar un driver especial.

### Tiempo estimado de entrega

En cada pedido activo (pestaña "Pedidos") hay botones rápidos — 15,
30, 45 o 60 minutos — que guardan un estimado y el momento en que se
puso. El cliente lo ve en "Mi cuenta" como "Listo aprox. HH:MM".

### Nota interna del pedido

Cada pedido tiene un campo colapsable "Nota interna" (ej. "cliente
llamó, cambia la dirección", "pagó por transferencia") que **nunca**
ve el cliente — solo queda en el panel, y también se imprime en la
comanda si tiene algo escrito.

### Inventario con conteo de unidades (pestaña "Inventario")

Además del interruptor de "agotado", cada producto tiene un campo
numérico opcional para anotar cuántas unidades quedan. Si lo dejas
vacío, el producto se trata como disponible sin límite. Cuando quedan
3 unidades o menos aparece la etiqueta "Quedan pocas" (solo en el
panel); si llega a 0, el producto se oculta automáticamente para el
cliente igual que si lo hubieras marcado agotado a mano.

### Cierre del día y exportar a CSV (pestaña "Reportes", solo dueño)

Debajo de las ventas de hoy/7 días se agregaron tarjetas con el
desglose de hoy — entregados, pendientes y cancelados — y un botón
para descargar los pedidos de hoy en un archivo CSV (hora, cliente,
teléfono, productos, totales, estado), listo para abrir en Excel o
Google Sheets.

### Bloquear un cliente problemático (solo dueño)

En cada pedido con cliente identificado hay un botón "Bloquear
cliente" (y "Desbloquear" si ya está bloqueado). Un cliente bloqueado
sigue pudiendo ver el menú y sus pedidos anteriores, pero la app le
avisa que no puede confirmar pedidos nuevos — pensado para casos de
muchas cancelaciones o pedidos no reclamados, no borra nada de su
cuenta ni de su historial.

## Cómo editar el menú

El menú real vive en Realtime Database (`categories` / `products`),
editable 100% desde `admin.html` → pestaña **"Menú"** (agregar,
editar y borrar categorías y productos — el campo "Imagen" acepta una
ruta local `images/algo.jpg` o una URL completa).

`js/data.js` ya **no** es la fuente de verdad — es solo el "menú de
fábrica": el valor por defecto mientras la app carga, y la semilla
que copia el botón "Cargar menú de fábrica" del panel (solo aparece
si la base de datos está vacía; nunca pisa datos ya editados).

Las fotos que trae el proyecto por defecto viven en `images/` (ver
`images/CREDITS.json` para la atribución/licencia de cada una).

## Experiencia del cliente — funciones agregadas

- **Cancelar pedido**: en "Mi cuenta", un pedido recién hecho (menos
  de 2 minutos, todavía "Recibido") tiene un botón para cancelarlo.
- **Calificar tras la entrega**: cuando un pedido pasa a "Entregado",
  aparece un botón para calificarlo — abre el mismo producto con la
  sección de reseñas.
- **Calculadora de porciones**: en el inicio, un selector de "¿para
  cuántas personas?" sugiere cuántos cortes pedir (estimación simple,
  no hay peso real por producto en el menú).
- **Usar mi ubicación**: botón junto al campo de dirección en el
  checkout — pide permiso de ubicación al navegador y llena la
  dirección automáticamente (con la API pública de OpenStreetMap, sin
  necesitar clave). El cliente siempre debe revisarla antes de
  confirmar. Además de llenar el texto, guarda las coordenadas exactas
  con el pedido, para que el domiciliario navegue directo al punto en
  vez de depender de que el texto se interprete bien — se descartan si
  el cliente edita la dirección a mano después.
- **Teléfono recordado**: no hay que volver a escribirlo en cada
  pedido (se guarda en el propio celular del cliente).
- **Nota por producto**: al agregar cualquier producto al carrito hay
  un campo de notas para la cocina (ej. "término tres cuartos, sin
  cebolla") — viaja con ese ítem hasta la comanda.
- **Agregar todos mis favoritos**: en la vista de Favoritos, un botón
  agrega de una vez todos los favoritos disponibles al carrito (los
  agotados quedan afuera automáticamente).
- **Recibo detallado**: cada pedido en "Mi cuenta" tiene un botón "Ver
  recibo" con el detalle completo — productos, notas, subtotal,
  domicilio y total — sin tener que adivinarlo del resumen corto.
- **Aviso de "cerramos pronto"**: si configuras una hora de cierre en
  el panel (Configuración → "Hora de cierre"), la app avisa al cliente
  cuando faltan 30 minutos o menos, para que no haga un pedido que
  llegaría después del cierre.
- **Tiempo estimado de entrega**: cuando el cajero pone un estimado
  (ver panel), el cliente lo ve en "Mi cuenta" como "Listo aprox.
  HH:MM".

## Instalar las apps en el celular/computador (PWA)

Las tres se pueden instalar por separado, cada una con su propio
ícono y nombre en el launcher:

- **App de clientes**: desde el navegador, menú → "Instalar app" o
  "Agregar a pantalla de inicio".
- **Panel de administración** (`admin.html`): mismo botón, entrando
  primero a esa dirección — queda instalada como "Panel Rodízio",
  aparte de la app de clientes.
- **App de domiciliarios** (`driver.html`): igual, queda como
  "Domicilios Rodízio".

Cada una abre directo en su propia pantalla al abrirla instalada (no
mezcla con las otras dos), aunque las tres compartan el mismo
dominio y el mismo Service Worker por debajo.

## Notificaciones push

Lado del cliente ya listo: en "Mi cuenta" hay un botón "Activar
notificaciones de pedidos" (`notifications.js`) que pide permiso,
obtiene el token del dispositivo y lo guarda en
`users/{uid}/fcmTokens`. El domiciliario tiene el mismo botón en
`driver.html` ("Activar avisos de pedidos nuevos"), que guarda su
token en `drivers/{uid}/fcmTokens` — el mismo módulo `notifications.js`
sirve a los dos, solo cambia a qué nodo apunta. `sw.js` recibe las
notificaciones cuando la app está cerrada o en segundo plano. La
`VAPID_KEY` en `js/firebase-config.js` ya está puesta con un valor
real.

Falta lo que solo tú puedes hacer (necesita tu propia sesión y no se
puede automatizar):

**Desplegar las Cloud Functions** — el código de las dos ya está
listo en `functions/index.js`, con las instrucciones de despliegue
exactas comentadas al final de ese mismo archivo (necesita el plan
Blaze de Firebase — tiene capa gratuita generosa, pero exige tarjeta
registrada):
- `notifyOrderStatusChange`: avisa al cliente cuando cambia el estado
  de su pedido.
- `notifyDriverAssigned`: avisa **solo** al domiciliario que el panel
  eligió cuando le asignan un pedido — nunca al resto de
  domiciliarios registrados.

Sin desplegarlas, cliente y domiciliario pueden *activar*
notificaciones pero nadie se las *envía* todavía (el domiciliario sí
sigue viendo el aviso sonoro dentro de la app si la tiene abierta).

## Analítica

Conectada (`analytics.js`) usando el `measurementId` que ya tenías en
`js/firebase-config.js`. Sin nada que configurar: en Firebase Console →
Analytics vas a ver vistas de producto, agregados al carrito, inicios
de checkout y compras confirmadas.

## Vista previa al compartir el link

Los meta tags (Open Graph / Twitter Card) ya están en `index.html`,
apuntando al dominio real de Hosting (`rodiziomarketplace.web.app`).
Si más adelante conectas un dominio propio (ver "Dominio personalizado"
más abajo), actualiza esos mismos tags (`og:url`, `og:image`,
`twitter:image`) con el dominio nuevo — si no, la imagen de vista
previa al compartir el link por WhatsApp puede no cargar.

## Pasarela de pago — en pausa

Hoy el pedido se confirma sin cobro dentro de la app (pago
contraentrega o coordinado aparte). Se dejó en pausa a propósito:
falta que crees cuenta de comercio con un proveedor (Wompi
recomendado para Colombia — el más simple de integrar; también se
consideraron PayU y Mercado Pago) antes de tocar código, porque cada
uno pide credenciales distintas que solo tú puedes generar.

## App de domiciliarios (`driver.html`)

Página aparte, pensada ante todo para usarse desde el celular del
domiciliario mientras se mueve — botones grandes, poca lectura por
pantalla — pero también responsiva en tablet/portátil/escritorio (la
lista de pedidos pasa a 2 o 3 columnas según el ancho), por si algún
domiciliario la revisa desde otro dispositivo. Corre en el mismo
servidor que todo lo demás (`npm start`), no hace falta nada aparte.

**Login = correo y contraseña**, igual que el panel de administración
(y separado del login con Google de los clientes).

### Darle acceso a un domiciliario

1. Esa persona entra a `driver.html` → "¿No tienes cuenta?
   Regístrate" → crea su cuenta (le va a decir "No tienes acceso
   todavía" después — es normal, crear la cuenta no da acceso).
2. Tú copias su `User UID` desde **Authentication → Users** en
   Firebase Console.
3. Vas a **Realtime Database → Datos** → agregas a mano
   `drivers/{ese-uid}/access: true`. Igual que con los admins, esto
   NUNCA se hace desde la app — ni la app ni Claude pueden
   auto-otorgar este acceso.

Una vez adentro, el propio domiciliario llena su nombre y teléfono
(pestaña de perfil arriba de la lista de pedidos) — eso sí lo edita
él mismo, no hace falta que tú lo hagas.

### Cómo lo usa un domiciliario real

1. **Marca "Disponible para recoger pedidos ahora"** cuando empieza
   su turno (un interruptor simple — el panel lo ve al elegir a quién
   asignar).
2. Cuando el panel le asigna un pedido a domicilio (ver abajo), le
   suena un aviso en la app (si la tiene abierta) y aparece en la
   pestaña **"Para recoger"**.
3. En el restaurante, revisa el pedido (cliente, dirección, productos,
   nota del cajero si hay una) y presiona **"Recogí el pedido — salir
   a domicilio"** — desde ese momento la app empieza a mandar su
   ubicación en tiempo real (con el permiso de ubicación del
   navegador) hasta que marca el pedido como entregado.
4. Tiene botones directos para **llamar al cliente** y para **abrir
   la dirección en Google Maps** (ruta paso a paso, sin necesitar
   clave propia de mapas — usa el enlace público de Maps). Si el
   cliente compartió su ubicación exacta al hacer el pedido (ver más
   abajo), navega directo a ese punto en vez de a la dirección escrita
   — la tarjeta lo marca con la etiqueta **"Ubicación exacta"**.
5. Al llegar, presiona **"Marcar como entregado"** — deja de
   compartir ubicación (con ese cliente y con el panel) y el pedido
   pasa a su pestaña de **"Historial"** (últimos 20).

Si cierra la app o se le bloquea la pantalla a mitad de una entrega y
vuelve a abrirla, el rastreo se retoma solo — no tiene que volver a
presionar "Recogí el pedido".

### Dos pedidos por la misma ruta

Un domiciliario puede tener más de un pedido asignado "en camino" al
mismo tiempo — el panel no restringe cuántos se le asignan, y la app
no lo obliga a entregar uno antes de recoger el siguiente. Cuando
lleva dos o más así, la pestaña "En camino" se lo recuerda ("Llevas 2
pedidos activos por la misma ruta"), y su ubicación se comparte **con
los dos clientes a la vez** (una sola señal de GPS, repartida a cada
pedido activo) — hasta que marca cada uno como entregado por
separado, momento en el que ese cliente en particular deja de ver su
ubicación, aunque el otro pedido siga en camino.

### Cómo lo asigna el panel

En la pestaña **Pedidos** del panel, cada tarjeta de un pedido a
domicilio (que no esté entregado ni cancelado) tiene un selector
**"Domiciliario"** con la lista de domiciliarios habilitados — lo
puede usar cualquier admin (dueño o cajero), no hace falta ser dueño.
Al elegir uno, ese domiciliario (y solo ese) recibe el aviso; el
panel también muestra un enlace **"Ver ubicación"** (o **"Ver
recorrido"**, si ya hay más de un punto registrado) una vez el
domiciliario empieza a compartirla, y — si el cliente compartió su
ubicación exacta al hacer el pedido — un enlace aparte **"Ver
ubicación del cliente"**. Ambos enlaces desaparecen solos en cuanto
el pedido se marca como entregado.

### Notificaciones — solo al domiciliario elegido

Igual que con los avisos de estado del pedido al cliente, esto
necesita la Cloud Function desplegada (`functions/index.js` →
`notifyDriverAssigned`, ver la sección de notificaciones push más
abajo). Está escrita para leer únicamente los tokens guardados bajo
`drivers/{ese uid}/fcmTokens` — nunca manda un aviso a todos los
domiciliarios registrados, solo al que el panel seleccionó. Mientras
tanto (sin desplegar), el domiciliario igual ve el aviso sonoro/visual
dentro de la app si la tiene abierta.

### Seguimiento en vivo — lado del cliente

En "Mi cuenta", un pedido "En camino" con un domiciliario asignado
muestra un enlace verde con su recorrido reciente (o solo su posición
actual, si todavía no hay suficientes puntos) que abre Google Maps,
más hace cuánto se actualizó. Es la posición real del domiciliario,
no una ruta calculada por un motor de rutas — no hay integración con
un servicio de tiempos de viaje reales (necesitaría una clave de
Google Maps Directions o similar); el tiempo estimado que sí se
muestra ("Listo aprox. HH:MM") sigue siendo el que pone el cajero a
mano. En cuanto el domiciliario marca el pedido como entregado, este
enlace desaparece — deja de compartir su ubicación con ese cliente.

### Ubicación exacta del cliente — solo la ve el domiciliario asignado y el panel

Si el cliente usa el botón **"Usar mi ubicación"** en el checkout (ver
"Experiencia del cliente" más abajo), esas coordenadas exactas viajan
con el pedido. Nadie más las puede leer: ni otros clientes, ni
domiciliarios sin asignar — las reglas de Realtime Database ya
existentes (el dueño del pedido, el domiciliario asignado, o un admin)
cubren esto sin necesitar una regla nueva. Si el cliente escribe la
dirección a mano (o edita el texto después de usar la ubicación), no
se guardan coordenadas — solo el texto, como siempre.

## Preparado para crecer

Si el negocio crece (más pedidos por día, más de un local), esto es
lo que ya se adaptó y lo que sigue siendo un límite real:

**Ya adaptado:**
- **Paginación del historial de pedidos**: el panel pedía siempre el
  nodo `orders` completo (`onValue(ref(db,'orders'))`). Con meses de
  historial eso se vuelve lento y consume datos de más cada vez que
  se abre el panel. Ahora pide solo los últimos 400 (`orderByKey()` +
  `limitToLast()` — las llaves de Firebase ya vienen ordenadas por
  fecha de creación, no hace falta indexar nada nuevo) y hay un botón
  "Cargar pedidos anteriores" en la pestaña Pedidos para pedir 400 más
  cuando de verdad se necesite ver más atrás.
- **Inventario a prueba de sobreventa**: si un producto tiene conteo
  de unidades (pestaña Inventario), al confirmar un pedido `auth.js`
  descuenta esas unidades con una transacción atómica de Realtime
  Database (`runTransaction`), no con un `set()` simple — así dos
  clientes pidiendo el último producto disponible casi al mismo
  tiempo no pueden dejar el conteo en negativo ni "perderse" el
  descuento de uno de los dos. Las reglas de RTDB solo dejan que un
  cliente *baje* ese número, nunca lo suba ni toque un producto
  marcado `true` — si esto falla por lo que sea, nunca bloquea ni
  revierte el pedido, es solo un ajuste de inventario.
- **Registro básico de errores**: `js/errors.js` escucha los errores
  de JavaScript no capturados (tanto en la app de clientes como en el
  panel) y los manda a un nodo `errorLogs` en Realtime Database. El
  dueño los ve en el panel, pestaña Reportes → "Errores recientes"
  (últimos 30) — para enterarte de que algo se rompió sin depender de
  que un cliente te escriba a avisar.

**Sigue siendo un límite real (no se puede resolver solo con código):**
- **Plan de Firebase**: si el proyecto sigue en el plan gratuito
  (Spark), tiene un tope de ~100 conexiones simultáneas a Realtime
  Database y una cuota mensual de transferencia/almacenamiento. Un
  restaurante con tráfico real puede acercarse a ese límite en horas
  pico. Revisa en Firebase Console → Uso y facturación qué plan tienes
  hoy — pasar a Blaze (pago por uso, con capa gratuita) es un cambio
  de configuración tuyo, no de código.
- **Validación de negocio solo en el navegador**: cosas como el total
  del pedido, la zona de cobertura o el pedido mínimo se calculan y
  validan en el JavaScript del cliente. Las reglas de RTDB sí protegen
  los permisos (quién puede leer/escribir qué), pero no validan la
  lógica de negocio en sí — alguien con conocimientos técnicos y mala
  intención podría, en teoría, mandar un pedido con un total
  manipulado directamente a Firebase sin pasar por la app. Cerrar esto
  del todo requiere Cloud Functions que validen cada pedido en el
  servidor (el código base ya existe en `functions/index.js`, pero
  igual que las notificaciones push, necesita el plan Blaze +
  `firebase deploy` desde tu sesión).
- **Sin monitoreo más allá del registro de errores nuevo**: no hay
  alertas automáticas, dashboards de salud del sistema, ni pruebas
  automatizadas — cada cambio se sigue verificando a mano.

## Lista de lanzamiento a producción

La app ya está publicada en Firebase Hosting:
`https://rodiziomarketplace.web.app/` (cliente), `/admin.html` (panel),
`/driver.html` (domiciliarios). Esto es lo que ya quedó listo para uso
real, y lo que sigue pendiente de tu parte antes de anunciarla a
clientes de verdad:

**✅ Ya listo (código + configuración):**
- Las tres apps publicadas con HTTPS real, instalables como PWA.
- Reglas de Realtime Database publicadas y verificadas (pedidos,
  domiciliarios, cierres de turno, todo con los permisos correctos).
- Encabezados de caché configurados para que un despliegue nuevo
  llegue de inmediato a los celulares, sin esperar horas.
- Ícono real (PNG + SVG) en las tres apps y en las vistas previas de
  WhatsApp/redes (Open Graph ya apunta al dominio real, no a un
  placeholder).
- Flujo completo de pedido, cocina, domiciliario y entrega probado de
  punta a punta, incluidos los casos reales de domiciliarios (no
  pudo entregar, rechazo de asignación, cierre de turno, propinas).
- Pedido mínimo con sugerencia, y ETA sugerido.
- Política de tratamiento de datos y consentimiento obligatorio en
  las tres apps.

**⚠️ Pendiente de TU parte antes de operar de verdad (no es código):**
1. **Habilitar al menos un domiciliario** — ve a Realtime Database →
   Datos → agrega a mano `drivers/{su-uid}/access: true` (el uid lo
   sacas de Authentication → Users, después de que esa persona se
   registre en `driver.html`). Sin esto, el selector de domiciliario
   del panel va a aparecer vacío.
2. **Revisar el plan de Firebase** — Firebase Console → Uso y
   facturación. El plan gratuito (Spark) tiene topes de conexiones
   simultáneas y transferencia; si esperas tráfico real diario,
   revisa si te conviene pasar a Blaze (pago por uso, con capa
   gratuita generosa — normalmente no vas a pagar nada operando un
   restaurante, pero necesita tarjeta registrada).
3. **Decidir sobre notificaciones push y validación en el servidor**
   — `functions/index.js` ya tiene el código listo
   (`notifyOrderStatusChange`, `notifyDriverAssigned`), pero
   requiere el plan Blaze + que corras `firebase deploy --only
   functions` desde tu sesión. Sin esto, las notificaciones push NO
   funcionan (el resto de la app sí, con normalidad).
4. **Probar un pedido real de principio a fin** con tu propio celular
   antes de anunciarlo a clientes — como cliente, como cajero y como
   domiciliario, en la vida real, no solo en el navegador de pruebas.
5. **Definir si vas a usar pasarela de pago** (Wompi/PayU/Mercado
   Pago) — hoy todo pedido a domicilio es contra-entrega en efectivo.
   Es una decisión tuya, no hay nada roto por no tenerla.
6. **(Opcional) Dominio propio** — si quieres algo como
   `pedidos.turodizio.com` en vez de `rodiziomarketplace.web.app`,
   ver la sección de dominio personalizado en Firebase Hosting; si lo
   haces, actualiza los meta tags de Open Graph en `index.html` con
   el dominio nuevo.
7. **(Opcional) Revisión legal de `privacidad.html`** — está escrita
   en buena fe siguiendo la Ley 1581 de 2012, pero no reemplaza una
   revisión de un abogado si vas a operar esto como negocio formal.
