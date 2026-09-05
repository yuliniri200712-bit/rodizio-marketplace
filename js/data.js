/* =========================================================
   DATOS DEL MENÚ
   =========================================================
   CATEGORIES y PRODUCTS empiezan con este menú "de fábrica"
   como valor por defecto (para que la app nunca se vea vacía
   mientras carga o si Realtime Database no tiene nada aún),
   pero catalog.js los reemplaza en vivo con lo que haya en la
   base de datos vía setCategories()/setProducts() — que es lo
   que el panel de administración edita. Este mismo array
   también sirve como semilla la primera vez (ver
   catalog.seedCatalogIfEmpty).
   ========================================================= */

export let CATEGORIES = [
  { id: 'cortes', name: 'Cortes de Res' },
  { id: 'aves', name: 'Aves' },
  { id: 'cerdo', name: 'Cerdo' },
  { id: 'embutidos', name: 'Embutidos' },
  { id: 'acompanamientos', name: 'Acompañamientos' },
  { id: 'postres', name: 'Postres' },
  { id: 'bebidas', name: 'Bebidas' },
];

export let PRODUCTS = [
  // --- Cortes de res ---
  {
    id: 'picanha',
    categoryId: 'cortes',
    name: 'Picanha',
    description: 'El corte insignia del rodízio, asado lento al espeto con sal gruesa.',
    price: 38000,
    image: 'images/picanha.jpg',
    badge: 'Más pedido',
  },
  {
    id: 'ancho',
    categoryId: 'cortes',
    name: 'Bife Ancho',
    description: 'Corte jugoso con marmoleo generoso, término a elección.',
    price: 34000,
    image: 'images/ancho.jpg',
  },
  {
    id: 'chorizo-bife',
    categoryId: 'cortes',
    name: 'Bife de Chorizo',
    description: 'Corte alto y tierno, sellado a la parrilla de carbón.',
    price: 36000,
    image: 'images/chorizo-bife.jpg',
  },
  // --- Aves ---
  {
    id: 'pollo-parrilla',
    categoryId: 'aves',
    name: 'Pollo a la Parrilla',
    description: 'Muslos y contramuslos marinados en hierbas de la casa.',
    price: 22000,
    image: 'images/pollo-parrilla.jpg',
  },
  {
    id: 'alitas-bbq',
    categoryId: 'aves',
    name: 'Alitas BBQ',
    description: 'Bañadas en salsa BBQ ahumada, punto crocante.',
    price: 24000,
    image: 'images/alitas-bbq.jpg',
    badge: 'Picante suave',
  },
  // --- Cerdo ---
  {
    id: 'costillas',
    categoryId: 'cerdo',
    name: 'Costillas de Cerdo',
    description: 'Cocción lenta de 6 horas, glaseadas antes de servir.',
    price: 30000,
    image: 'images/costillas.jpg',
  },
  {
    id: 'lomo-cerdo',
    categoryId: 'cerdo',
    name: 'Lomo de Cerdo al Espeto',
    description: 'Con costra de panela y mostaza dulce.',
    price: 27000,
    image: 'images/lomo-cerdo.jpg',
  },
  // --- Embutidos ---
  {
    id: 'chorizo-parrilla',
    categoryId: 'embutidos',
    name: 'Chorizo a la Parrilla',
    description: 'Receta santandereana, servido con limón.',
    price: 15000,
    image: 'images/chorizo-parrilla.jpg',
  },
  {
    id: 'morcilla',
    categoryId: 'embutidos',
    name: 'Morcilla Criolla',
    description: 'Con arroz, cebolla larga y especias de la casa.',
    price: 14000,
    image: 'images/morcilla.jpg',
  },
  // --- Acompañamientos ---
  {
    id: 'arroz-blanco',
    categoryId: 'acompanamientos',
    name: 'Arroz Blanco',
    description: 'Grano suelto, porción para compartir.',
    price: 8000,
    image: 'images/arroz-blanco.jpg',
  },
  {
    id: 'yuca-frita',
    categoryId: 'acompanamientos',
    name: 'Yuca Frita',
    description: 'Crocante por fuera, suave por dentro.',
    price: 9000,
    image: 'images/yuca-frita.jpg',
  },
  {
    id: 'ensalada-casa',
    categoryId: 'acompanamientos',
    name: 'Ensalada de la Casa',
    description: 'Mix de hojas verdes, tomate cherry y vinagreta de maracuyá.',
    price: 12000,
    image: 'images/ensalada-casa.jpg',
  },
  // --- Postres ---
  {
    id: 'flan-casero',
    categoryId: 'postres',
    name: 'Flan Casero',
    description: 'Receta tradicional con caramelo oscuro.',
    price: 11000,
    image: 'images/flan-casero.jpg',
  },
  {
    id: 'brigadeiro',
    categoryId: 'postres',
    name: 'Brigadeiro (3 uds)',
    description: 'Trufas brasileñas de chocolate, hechas a mano.',
    price: 10000,
    image: 'images/brigadeiro.jpg',
  },
  // --- Bebidas ---
  {
    id: 'jugo-natural',
    categoryId: 'bebidas',
    name: 'Jugo Natural',
    description: 'Elige entre maracuyá, mango o lulo.',
    price: 8000,
    image: 'images/jugo-natural.jpg',
  },
  {
    id: 'gaseosa',
    categoryId: 'bebidas',
    name: 'Gaseosa 400ml',
    description: 'Variedades disponibles en caja fría.',
    price: 6000,
    image: 'images/gaseosa.jpg',
  },
  {
    id: 'cerveza',
    categoryId: 'bebidas',
    name: 'Cerveza Nacional',
    description: 'Botella 330ml, bien fría.',
    price: 9000,
    image: 'images/cerveza.jpg',
  },
];

// Reasignan el binding vivo — cualquier archivo que haga
// `import { CATEGORIES } from './data.js'` ve el valor nuevo
// automáticamente, sin tener que re-importar nada.
export function setCategories(categories) {
  CATEGORIES = categories;
}
export function setProducts(products) {
  PRODUCTS = products;
}

export function formatCOP(value) {
  return value.toLocaleString('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  });
}
