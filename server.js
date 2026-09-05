/* =========================================================
   Servidor local minimo (sin dependencias) para poder abrir
   la app por http:// en vez de file://, que es obligatorio
   para que funcionen los modulos JS, el manifest y el
   service worker. Ver "Iniciar la app.bat".
   ========================================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado: ' + urlPath);
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // El service worker nunca debe quedar cacheado por el navegador:
    // si no, las actualizaciones del código no llegan a los usuarios.
    if (path.basename(filePath) === 'sw.js') {
      headers['Cache-Control'] = 'no-cache';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Rodizio Cucuta corriendo en:');
  console.log('');
  console.log('  App de clientes:            http://localhost:' + PORT + '/');
  console.log('  Panel de administración:    http://localhost:' + PORT + '/admin.html');
  console.log('  App de domiciliarios:       http://localhost:' + PORT + '/driver.html');
  console.log('');
  console.log('  Deja esta ventana abierta mientras uses la app.');
  console.log('  Ciérrala cuando termines.');
  console.log('');
});
