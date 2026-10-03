'use strict';
// 本機預覽：提供 docs/ 靜態網頁，並以模擬環境執行 apps-script/Code.gs 作為後端（資料只存在記憶體）
// 用法：node tools/dev-server.js  →  http://localhost:8080
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGas } = require('./gas-mock');

const ROOT = path.join(__dirname, '..', 'docs');
const PORT = Number(process.env.PORT) || 8080;
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, ''); // 例如 /ISMS_QUIZ66，模擬 GitHub Pages 子路徑
const gas = createGas();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/api') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const out = gas.context.doPost({ postData: { contents: body } });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(out.getContent());
    });
    return;
  }
  let pathname = url.pathname;
  if (BASE) {
    if (pathname === BASE) { res.writeHead(301, { Location: BASE + '/' }); res.end(); return; }
    if (!pathname.startsWith(BASE + '/')) { res.writeHead(404); res.end('Not found'); return; }
    pathname = pathname.slice(BASE.length);
  }
  // 本機預覽時改用 /api 作為後端網址
  if (pathname === '/js/config.js') {
    const cfg = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8').replace(/API_URL:\s*'[^']*'/, "API_URL: '/api'");
    res.writeHead(200, { 'Content-Type': TYPES['.js'] });
    res.end(cfg);
    return;
  }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (pathname.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`本機預覽：http://localhost:${PORT}${BASE}/（後台密碼 admin1234）`));
