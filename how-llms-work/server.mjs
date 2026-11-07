import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream';
import { createAuth } from './auth.mjs';
import { normalizeBasePath, stripBasePath, withBasePath } from './base-path.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
// Public course is the default. REQUIRE_AUTH=1 restores the login gate and is the only mode that opens the account database.
const requireAuth = process.env.REQUIRE_AUTH === '1';
const auth = requireAuth ? createAuth() : null;
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
const basePath = normalizeBasePath();
const courseEntry = withBasePath('/zh/chapters/overview', basePath);
const allowUpstreamModel = process.env.ALLOW_UPSTREAM_MODEL !== '0';
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
function rewriteHtml(html) {
  let out = html;
  if (!requireAuth) out = out.replace(/\s*<script type="module" src="\/account-client\.js"><\/script>/g, '');
  const flag = requireAuth ? '<script>globalThis.__HOW_LLMS_AUTH__=true;</script>' : '';
  const boot = basePath
    ? `<script>(function(){const base=${JSON.stringify(basePath)};globalThis.__HOW_LLMS_BASE__=base;const fix=el=>{if(!el||el.nodeType!==1)return;for(const attr of["href","src","action"]){if(!el.hasAttribute(attr))continue;const value=el.getAttribute(attr);if(!value||value[0]!=="/"||value[1]==="/"||value===base||value.startsWith(base+"/"))continue;el.setAttribute(attr,base+value);}};const walk=node=>{if(!node||node.nodeType!==1)return;fix(node);node.querySelectorAll("[href],[src],[action]").forEach(fix);};new MutationObserver(records=>{for(const record of records){if(record.type==="attributes")fix(record.target);for(const node of record.addedNodes)walk(node);}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["href","src","action"]});document.addEventListener("click",event=>{const el=event.target&&event.target.closest&&event.target.closest("a[href],area[href]");if(el)fix(el);},true);walk(document.documentElement);})();</script>`
    : '';
  const icon = basePath ? '<link rel="icon" href="data:,">' : '';
  if (flag || boot || icon) out = out.replace(/<head[^>]*>/i, match => `${match}${icon}${flag}${boot}`);
  if (!basePath) return out;
  return out.replace(/(\s(?:href|src|action)=["'])\/(?!\/)/g, `$1${basePath}/`);
}
async function serveHtml(req, res, file) {
  const body = Buffer.from(rewriteHtml(await fs.promises.readFile(file, 'utf8')));
  res.setHeader('Content-Type', mime['.html']);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Length', body.length);
  res.writeHead(200);
  if (req.method === 'HEAD') return res.end();
  res.end(body);
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
  let requestUrl;
  try { requestUrl = new URL(req.url, 'http://localhost'); }
  catch { return error(res, 400, 'Bad URL'); }
  let pathname;
  try { pathname = decodeURIComponent(requestUrl.pathname); }
  catch { return error(res, 400, 'Bad URL'); }
  if (basePath && pathname === basePath) {
    res.writeHead(308, { Location: `${basePath}/${requestUrl.search}`, 'Cache-Control': 'no-store' });
    return res.end();
  }
  const stripped = stripBasePath(pathname, basePath);
  if (stripped == null) return error(res, 404, 'Not found');
  if (!requireAuth && (stripped === '/api/auth' || stripped.startsWith('/api/auth/'))) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: 'not_found' }));
  }
  if (!requireAuth && (stripped === '/account' || stripped === '/auth' || stripped.startsWith('/auth/'))) {
    res.writeHead(302, { Location: courseEntry, 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (requireAuth && await auth.handle(req, res, stripped)) return;
  if (!['GET', 'HEAD'].includes(req.method)) return error(res, 405, 'Method not allowed');
  if (stripped === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({
      status: 'ok', basePath: basePath || '/', authRequired: requireAuth,
      modelLocal: fs.existsSync(path.join(modelRoot, 'model.safetensors')),
      webgpu: 'client-side', modelSource: allowUpstreamModel ? 'local files, otherwise original model host' : 'local files only',
    }));
  }
  const publicFiles = {
    '/auth.css': 'auth-ui/auth.css',
    '/auth.js': 'auth-ui/auth.js',
    '/account-client.js': 'auth-ui/account-client.js',
  };
  if (publicFiles[stripped]) {
    const file = path.join(root, publicFiles[stripped]);
    return serveFile(req, res, file, await fs.promises.stat(file));
  }
  if (['/auth/login', '/auth/register'].includes(stripped)) {
    const file = path.join(root, 'auth-ui/auth.html');
    return serveHtml(req, res, file);
  }
  if (requireAuth) {
    const currentUser = auth.user(req);
    if (!currentUser) {
      res.setHeader('Cache-Control', 'no-store');
      if (stripped.startsWith('/api/') || stripped.startsWith('/model/')
        || stripped.startsWith('/assets/') || stripped.startsWith('/worker/')
        || path.extname(stripped)) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'authentication_required' }));
      }
      const next = pathname + requestUrl.search;
      res.writeHead(302, { Location: `${withBasePath('/auth/login', basePath)}?next=${encodeURIComponent(next)}` });
      return res.end();
    }
    if (stripped === '/account') return serveHtml(req, res, path.join(root, 'auth-ui/auth.html'));
  }
  const isModel = stripped.startsWith('/api/model/') || stripped.startsWith('/model/');
  // Only published web resources may be served. Never expose server code, docs or account storage.
  if (!isModel && stripped !== '/index.html' && stripped !== '/mlx-core.opt.wasm'
    && !stripped.startsWith('/assets/') && !stripped.startsWith('/worker/')
    && path.extname(stripped)) return error(res, 404, 'Asset not found');
  const relative = isModel ? stripped.replace(/^\/(?:api\/)?model\//, '')
    : stripped.replace(/^\/worker\//, '/assets/').replace(/^\/+/, '');
  const base = isModel ? modelRoot : root;
  const file = path.resolve(base, relative || 'index.html');
  if (!file.startsWith(base + path.sep) && file !== base) return error(res, 403, 'Forbidden path');
  if (!isModel && file !== path.join(root, 'index.html') && file !== path.join(root, 'mlx-core.opt.wasm')
    && !file.startsWith(path.join(root, 'assets') + path.sep)) {
    if (path.extname(stripped)) return error(res, 404, 'Asset not found');
    return serveHtml(req, res, path.join(root, 'index.html'));
  }
  try {
    const stat = await fs.promises.stat(file);
    if (stat.isFile()) {
      if (file === path.join(root, 'index.html')) return serveHtml(req, res, file);
      return serveFile(req, res, file, stat);
    }
  } catch {}
  if (isModel) {
    if (!/^[a-zA-Z0-9_.-]+\.(?:json|safetensors|bin|model|txt)$/.test(relative))
      return error(res, 404, 'Unknown model file');
    if (!allowUpstreamModel) return error(res, 503, 'Model resource unavailable');
    return proxyModel(req, res, relative);
  }
  if (path.extname(stripped)) return error(res, 404, 'Asset not found');
  try { await serveHtml(req, res, path.join(root, 'index.html')); }
  catch { error(res, 503, 'Runtime files are not ready'); }
});
server.listen(port, host, () => {
  const origin = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
  console.log(`How LLMs Work: ${origin}${withBasePath('/zh/chapters/overview', basePath)}`);
  console.log(`Model directory: ${modelRoot}`);
  if (requireAuth && basePath && !process.env.PUBLIC_ORIGIN) {
    console.warn('PUBLIC_ORIGIN is unset. Behind TLS set PUBLIC_ORIGIN=https://api.garryai.icu so session cookies are Secure and login checks match the browser origin.');
  }
});
server.on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is occupied. Run with PORT=5174.` : e);
  process.exit(1);
});
