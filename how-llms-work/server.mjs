import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream';
import { createAuth } from './auth.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const auth = createAuth();
const port = Number(process.env.PORT || 5173);
const modelRoot = path.resolve(process.env.MODEL_DIR || path.join(root, 'model'));
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};
function headers(res) {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
function error(res, status, message) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}
function serveFile(req, res, file, stat) {
  const size = stat.size;
  let start = 0, end = size - 1, status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return error(res, 416, 'Invalid byte range');
    }
    start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return error(res, 416, 'Range not satisfiable');
    }
    status = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', end - start + 1);
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store');
  res.writeHead(status);
  if (req.method === 'HEAD' || size === 0) return res.end();
  pipeline(fs.createReadStream(file, { start, end }), res, () => {});
}
// Only model files are proxied. Prompts and inference never go through this server.
function proxyModel(req, res, modelPath, redirects = 0, target) {
  const url = target || `https://mlx.void.app/api/model/${modelPath}`;
  const upstreamHeaders = { Accept: 'application/octet-stream', 'User-Agent': 'How-LLMs-Work-local' };
  if (req.headers.range) upstreamHeaders.Range = req.headers.range;
  const upstream = https.request(url, { method: req.method, headers: upstreamHeaders }, remote => {
    if ([301, 302, 307, 308].includes(remote.statusCode) && remote.headers.location && redirects < 3) {
      remote.resume();
      return proxyModel(req, res, modelPath, redirects + 1, new URL(remote.headers.location, url).href);
    }
    res.statusCode = remote.statusCode || 502;
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) {
      if (remote.headers[key]) res.setHeader(key, remote.headers[key]);
    }
    res.setHeader('Cache-Control', 'private, no-store');
    pipeline(remote, res, () => {});
  });
  upstream.setTimeout(60000, () => upstream.destroy(new Error('Model host timed out')));
  upstream.on('error', e => error(res, 502, `Model download failed: ${e.message}`));
  res.on('close', () => upstream.destroy());
  upstream.end();
}

const server = http.createServer(async (req, res) => {
  headers(res);
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { return error(res, 400, 'Bad URL'); }
  if (await auth.handle(req, res, pathname)) return;
  if (!['GET', 'HEAD'].includes(req.method)) return error(res, 405, 'Method not allowed');
  if (pathname === '/health') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      status: 'ok', modelLocal: fs.existsSync(path.join(modelRoot, 'model.safetensors')),
      webgpu: 'client-side', modelSource: 'local files, otherwise original model host',
    }));
  }
  const publicFiles = {
    '/auth.css': 'auth-ui/auth.css',
    '/auth.js': 'auth-ui/auth.js',
    '/account-client.js': 'auth-ui/account-client.js',
  };
  if (publicFiles[pathname]) {
    const file = path.join(root, publicFiles[pathname]);
    return serveFile(req, res, file, await fs.promises.stat(file));
  }
  if (['/auth/login', '/auth/register'].includes(pathname)) {
    const file = path.join(root, 'auth-ui/auth.html');
    return serveFile(req, res, file, await fs.promises.stat(file));
  }
  const currentUser = auth.user(req);
  if (!currentUser) {
    res.setHeader('Cache-Control', 'no-store');
    if (pathname.startsWith('/api/') || pathname.startsWith('/model/')
      || pathname.startsWith('/assets/') || pathname.startsWith('/worker/')
      || path.extname(pathname)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'authentication_required' }));
    }
    res.writeHead(302, { Location: `/auth/login?next=${encodeURIComponent(req.url)}` });
    return res.end();
  }
  if (pathname === '/account') {
    const file = path.join(root, 'auth-ui/auth.html');
    return serveFile(req, res, file, await fs.promises.stat(file));
  }
  const isModel = pathname.startsWith('/api/model/') || pathname.startsWith('/model/');
  // Only published web resources may be served. Never expose server code, docs or account storage.
  if (!isModel && pathname !== '/index.html' && pathname !== '/mlx-core.opt.wasm'
    && !pathname.startsWith('/assets/') && !pathname.startsWith('/worker/')
    && path.extname(pathname)) return error(res, 404, 'Asset not found');
  const relative = isModel ? pathname.replace(/^\/(?:api\/)?model\//, '')
    : pathname.replace(/^\/worker\//, '/assets/').replace(/^\/+/, '');
  const base = isModel ? modelRoot : root;
  const file = path.resolve(base, relative || 'index.html');
  if (!file.startsWith(base + path.sep) && file !== base) return error(res, 403, 'Forbidden path');
  if (!isModel && file !== path.join(root, 'index.html') && file !== path.join(root, 'mlx-core.opt.wasm')
    && !file.startsWith(path.join(root, 'assets') + path.sep)) {
    if (path.extname(pathname)) return error(res, 404, 'Asset not found');
    const index = path.join(root, 'index.html');
    return serveFile(req, res, index, await fs.promises.stat(index));
  }
  try {
    const stat = await fs.promises.stat(file);
    if (stat.isFile()) return serveFile(req, res, file, stat);
  } catch {}
  if (isModel) {
    if (!/^[a-zA-Z0-9_.-]+\.(?:json|safetensors|bin|model|txt)$/.test(relative))
      return error(res, 404, 'Unknown model file');
    return proxyModel(req, res, relative);
  }
  if (path.extname(pathname)) return error(res, 404, 'Asset not found');
  const index = path.join(root, 'index.html');
  try { serveFile(req, res, index, await fs.promises.stat(index)); }
  catch { error(res, 503, 'Runtime files are not ready'); }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`How LLMs Work: http://localhost:${port}/zh/chapters/overview`);
  console.log(`Model directory: ${modelRoot}`);
});
server.on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is occupied. Run with PORT=5174.` : e);
  process.exit(1);
});
