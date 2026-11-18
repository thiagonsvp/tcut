const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = __dirname;
const port = Number(process.env.PORT) || 4173;
const bridgeRoot = process.env.TCUT_BRIDGE_DIR || os.tmpdir();
const bridge = {
  input: path.join(bridgeRoot, 'tcut-corel-input.svg'),
  output: path.join(bridgeRoot, 'tcut-corel-output.svg'),
};
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml; charset=utf-8' };
const maxSvgBytes = 20 * 1024 * 1024;

function respond(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function handler(req, res) {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host}`); }
  catch { respond(res, 400, 'Endereço inválido'); return; }

  if (url.pathname.startsWith('/api/corel/')) {
    const origin = req.headers.origin;
    if (origin && origin !== `http://localhost:${port}` && origin !== `http://127.0.0.1:${port}`) {
      respond(res, 403, 'Origem não permitida'); return;
    }
    if (url.pathname === '/api/corel/ping' && req.method === 'GET') {
      respond(res, 200, 'tcut-corel-bridge-v1'); return;
    }
    if (url.pathname === '/api/corel/input' && req.method === 'GET') {
      fs.readFile(bridge.input, (error, data) => {
        if (error) { respond(res, 404, 'Nenhuma seleção enviada pelo CorelDRAW.'); return; }
        if (data.length > maxSvgBytes) { respond(res, 413, 'SVG maior que 20 MB.'); return; }
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(data);
      });
      return;
    }
    if (url.pathname === '/api/corel/output' && req.method === 'POST') {
      const chunks = [];
      let size = 0;
      let rejected = false;
      req.on('data', chunk => {
        if (rejected) return;
        size += chunk.length;
        if (size > maxSvgBytes) { rejected = true; respond(res, 413, 'SVG maior que 20 MB.'); return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (rejected) return;
        const data = Buffer.concat(chunks);
        if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(data.toString('utf8', 0, 300))) {
          respond(res, 400, 'Envie um SVG válido.'); return;
        }
        fs.writeFile(bridge.output, data, error => error ? respond(res, 500, 'Falha ao salvar o SVG.') : respond(res, 200, 'SVG pronto para importar no CorelDRAW.'));
      });
      return;
    }
    respond(res, 404, 'Rota não encontrada');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') { respond(res, 405, 'Método não permitido'); return; }
  let name;
  try { name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); }
  catch { respond(res, 400, 'Endereço inválido'); return; }
  const file = path.resolve(root, name);
  if ((!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) || name.split(/[\\/]/).some(part => part.startsWith('.'))) {
    respond(res, 403, 'Acesso negado'); return;
  }
  fs.readFile(file, (error, data) => {
    if (error) { respond(res, 404, 'Arquivo não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

if (require.main === module) http.createServer(handler).listen(port, '127.0.0.1', () => console.log(`T-Cut disponível em http://localhost:${port}`));

module.exports = { handler, bridge };
