import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { clientAddress, normalizeBasePath, stripBasePath, withBasePath } from './base-path.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = '/how-LLM-works';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function startServer(env) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: here,
    env: { ...process.env, HOST: '127.0.0.1', ALLOW_UPSTREAM_MODEL: '0', PUBLIC_ORIGIN: '', TRUST_PROXY: '', REQUIRE_AUTH: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start\n${logs}`)), 10000);
    child.stdout.on('data', () => {
      if (logs.includes('How LLMs Work:')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}\n${logs}`));
    });
  });
  return {
    child, ready,
    stop() {
      child.kill('SIGTERM');
      return new Promise(resolve => child.once('exit', resolve));
    },
    logs: () => logs,
  };
}

test('base path helper keeps the exact segment', () => {
  assert.equal(normalizeBasePath(''), '');
  assert.equal(normalizeBasePath('/how-LLM-works/'), '/how-LLM-works');
  assert.equal(normalizeBasePath('how-LLM-works'), '/how-LLM-works');
  assert.throws(() => normalizeBasePath('/how-LLM-works/extra'));
  assert.throws(() => normalizeBasePath('/how-image-models-work/../how-LLM-works'));
  assert.equal(stripBasePath('/how-LLM-works', base), '/');
  assert.equal(stripBasePath('/how-LLM-works/zh/chapters/overview/', base), '/zh/chapters/overview/');
  assert.equal(stripBasePath('/how-llm-works/health', base), null);
  assert.equal(stripBasePath('/how-image-models-work/', base), null);
  assert.equal(stripBasePath('/api/auth/session', base), null);
  assert.equal(withBasePath('/assets/app.js', base), '/how-LLM-works/assets/app.js');
  assert.equal(withBasePath('/how-LLM-works/assets/app.js', base), '/how-LLM-works/assets/app.js');
  const previous = process.env.TRUST_PROXY;
  delete process.env.TRUST_PROXY;
  assert.equal(clientAddress({
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-real-ip': '203.0.113.8' },
  }), '127.0.0.1');
  process.env.TRUST_PROXY = '1';
  assert.equal(clientAddress({
    socket: { remoteAddress: '172.17.0.1' },
    headers: { 'x-real-ip': '203.0.113.8' },
  }), '203.0.113.8');
  assert.equal(clientAddress({
    socket: { remoteAddress: '203.0.113.9' },
    headers: { 'x-real-ip': '198.51.100.4' },
  }), '203.0.113.9');
  if (previous === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = previous;
});

test('public prefixed course, assets, and retired auth routes', { timeout: 180000 }, async t => {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-prefix-'));
  const server = startServer({ PORT: String(port), BASE_PATH: base, AUTH_DATA_DIR: data });
  t.after(async () => {
    await server.stop();
    fs.rmSync(data, { recursive: true, force: true });
  });
  await server.ready;
  const origin = `http://127.0.0.1:${port}`;
  async function request(urlPath, options = {}) {
    const response = await fetch(`${origin}${urlPath}`, { ...options, redirect: 'manual' });
    assert.deepEqual(response.headers.getSetCookie?.() || [], [], urlPath);
    return response;
  }
  function assertIsolated(response) {
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  }

  const slash = await request(`${base}?from=root`);
  assert.equal(slash.status, 308);
  assert.equal(slash.headers.get('location'), `${base}/?from=root`);

  const health = await request(`${base}/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.basePath, base);
  assert.equal(healthBody.authRequired, false);
  assert.equal(healthBody.modelLocal, false);
  assertIsolated(health);

  for (const blocked of ['/health', '/assets/index-DTXKgRpf.css', '/api/auth/session', '/api/model/config.json', '/how-llm-works/health', '/how-image-models-work/', '/mlx-core.opt.wasm']) {
    const response = await request(blocked);
    assert.equal(response.status, 404, blocked);
  }

  const zhHome = await request(`${base}/zh`);
  const zhHtml = await zhHome.text();
  assert.equal(zhHome.status, 200);
  assert.equal(zhHome.headers.get('location'), null);
  assert.match(zhHtml, /src="\/how-LLM-works\/course-portal\.js"/);
  assert.match(zhHtml, /href="\/how-LLM-works\/course-portal\.css"/);
  assert.doesNotMatch(zhHtml, /account-client\.js|\/auth\/login/);
  assertIsolated(zhHome);
  const portalJs = await request(`${base}/course-portal.js`);
  assert.equal(portalJs.status, 200);
  assert.match(portalJs.headers.get('content-type'), /javascript/);
  assertIsolated(portalJs);
  assert.match(await portalJs.text(), /图像模型是如何运作的/);
  const portalCss = await request(`${base}/course-portal.css`);
  assert.equal(portalCss.status, 200);
  assert.match(portalCss.headers.get('content-type'), /css/);
  assertIsolated(portalCss);
  await portalCss.arrayBuffer();
  for (const outside of ['/learn/', '/how-image-models-work/', '/how-image-models-work']) {
    const response = await request(outside);
    assert.equal(response.status, 404, outside);
    assert.equal(response.headers.get('location'), null);
    await response.arrayBuffer();
  }

  const home = await request(`${base}/`);
  const homeHtml = await home.text();
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('location'), null);
  assert.match(homeHtml, /id="root"/);
  assert.doesNotMatch(homeHtml, /account-client\.js/);
  assert.doesNotMatch(homeHtml, /\/auth\/login/);
  assertIsolated(home);

  const nested = await request(`${base}/zh/chapters/tokenization/`);
  assert.equal(nested.status, 200);
  assert.equal(nested.headers.get('location'), null);
  assert.match(await nested.text(), /id="root"/);

  const legacy = await request(`${base}/auth/login?next=https://evil.example/phish`);
  assert.equal(legacy.status, 302);
  assert.equal(legacy.headers.get('location'), `${base}/zh`);
  assert.doesNotMatch(await legacy.text(), /auth-form|password|邮箱/);
  for (const retired of [`${base}/auth/register`, `${base}/account`, `${base}/auth/login/`]) {
    const response = await request(retired);
    assert.equal(response.status, 302, retired);
    assert.equal(response.headers.get('location'), `${base}/zh`);
    await response.arrayBuffer();
  }
  const secretEmail = 'hidden-user@example.com';
  for (const route of ['session', 'register', 'login', 'logout']) {
    const response = await request(`${base}/api/auth/${route}`, {
      method: route === 'session' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: 'llm_session=ab'.repeat(4) },
      body: route === 'session' ? undefined : JSON.stringify({ name: 'Hidden', email: secretEmail, password: 'prefix-pass-1' }),
    });
    assert.equal(response.status, 404, route);
    const body = await response.text();
    assert.equal(body, '{"error":"not_found"}');
    assert.equal(body.includes(secretEmail), false);
    assert.equal(body.includes('users'), false);
  }
  assert.equal(fs.existsSync(path.join(data, 'auth.sqlite')), false);

  const chapter = await request(`${base}/zh/chapters/tokenization`);
  const chapterHtml = await chapter.text();
  assert.equal(chapter.status, 200);
  assert.match(chapter.headers.get('content-type'), /text\/html/);
  assert.match(chapterHtml, /src="\/how-LLM-works\/assets\/index-/);
  assert.match(chapterHtml, /href="\/how-LLM-works\/assets\/index-/);
  assert.match(chapterHtml, /href="\/how-LLM-works\/zh\/chapters\//);
  assert.doesNotMatch(chapterHtml, /\ssrc="\/assets\//);
  assert.doesNotMatch(chapterHtml, /\shref="\/assets\//);
  assert.doesNotMatch(chapterHtml, /\shref="\/zh\//);
  assert.doesNotMatch(chapterHtml, /account-client\.js|\/auth\/login/);
  assertIsolated(chapter);

  const refreshed = await request(`${base}/zh/chapters/overview/`);
  assert.equal(refreshed.status, 200);
  assert.match(await refreshed.text(), /id="root"/);

  const cssUrl = `${base}/assets/index-DTXKgRpf.css`;
  const css = await request(cssUrl);
  const cssText = await css.text();
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  assert.match(cssText, /url\(KaTeX_AMS-Regular-BQhdFMY1\.woff2\)/);
  assert.equal(cssText.includes('url(/assets/'), false);
  const font = await request(`${base}/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2`);
  assert.equal(font.status, 200);
  assert.match(font.headers.get('content-type'), /font\/woff2/);
  const rootFont = await fetch(`${origin}/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2`);
  assert.equal(rootFont.status, 404);

  const script = await request(`${base}/assets/index-DdYUB_-s.js?v=panel-i18n-3`);
  assert.equal(script.status, 200);
  const scriptText = await script.text();
  assert.match(scriptText, /basepath:globalThis\.__HOW_LLMS_BASE__\|\|`\/`/);
  assert.match(scriptText, /__HOW_LLMS_BASE__\|\|``\)\.replace/);

  const worker = await request(`${base}/worker/mlx-worker-D0oSVjKz.js`);
  assert.equal(worker.status, 200);
  assertIsolated(worker);
  assert.match(await worker.text(), /function En\(e\)/);

  const model = await request(`${base}/api/model/config.json`);
  assert.equal(model.status, 200);
  assert.match(model.headers.get('content-type'), /application\/json/);
  const modelBody = await model.json();
  assert.equal(typeof modelBody, 'object');
  const missingModel = await request(`${base}/api/model/model.safetensors`, { method: 'HEAD' });
  assert.equal(missingModel.status, 503);

  const wasm = await request(`${base}/mlx-core.opt.wasm`, { headers: { Range: 'bytes=0-15' } });
  assert.equal(wasm.status, 206);
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.equal(wasm.headers.get('accept-ranges'), 'bytes');
  assert.equal(Number(wasm.headers.get('content-length')), 16);
  assertIsolated(wasm);
  await wasm.arrayBuffer();

  const escaped = await request(`${base}/assets/../server.mjs`);
  assert.notEqual(escaped.status, 200);
  const escapedText = await escaped.text();
  assert.equal(escapedText.includes('createAuth'), false);

  const retainPort = await freePort();
  const stripPort = await freePort();
  const retain = proxy(retainPort, port, false);
  const strip = proxy(stripPort, port, true);
  t.after(() => { retain.close(); strip.close(); });
  await Promise.all([once(retain, 'listening'), once(strip, 'listening')]);
  const retained = await fetch(`http://127.0.0.1:${retainPort}${base}/health`);
  assert.equal(retained.status, 200);
  const stripped = await fetch(`http://127.0.0.1:${stripPort}${base}/health`);
  assert.equal(stripped.status, 404);
  const ignored = await fetch(`http://127.0.0.1:${retainPort}/api/status`);
  assert.equal(ignored.status, 404);
  assert.equal(await ignored.text(), 'proxy-miss');

  await exerciseBrowser(origin);
});

test('root mode still serves the local entry path', async t => {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-root-'));
  const server = startServer({ PORT: String(port), BASE_PATH: '', AUTH_DATA_DIR: data });
  t.after(async () => {
    await server.stop();
    fs.rmSync(data, { recursive: true, force: true });
  });
  await server.ready;
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).basePath, '/');
  const page = await fetch(`http://127.0.0.1:${port}/zh/chapters/overview`, { redirect: 'manual' });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('location'), null);
  assert.deepEqual(page.headers.getSetCookie?.() || [], []);
  assert.match(await page.text(), /id="root"/);
});

test('REQUIRE_AUTH=1 keeps the login gate and does not open account mutations', async t => {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-auth-'));
  const server = startServer({
    PORT: String(port), BASE_PATH: base, AUTH_DATA_DIR: data, REQUIRE_AUTH: '1',
  });
  t.after(async () => {
    await server.stop();
    fs.rmSync(data, { recursive: true, force: true });
  });
  await server.ready;
  const origin = `http://127.0.0.1:${port}`;
  const chapter = await fetch(`${origin}${base}/zh/chapters/overview`, { redirect: 'manual' });
  assert.equal(chapter.status, 302);
  assert.match(chapter.headers.get('location'), new RegExp(`^${base}/auth/login\\?next=`));
  const asset = await fetch(`${origin}${base}/assets/index-DTXKgRpf.css`, { redirect: 'manual' });
  assert.equal(asset.status, 401);
  const session = await fetch(`${origin}${base}/api/auth/session`, { redirect: 'manual' });
  assert.equal(session.status, 200);
  const opened = await session.json();
  assert.equal(opened.user, null);
  assert.equal(typeof opened.csrfToken, 'string');
  const cookies = session.headers.getSetCookie?.() || [];
  assert.equal(cookies.some(line => line.startsWith('llm_csrf=')), true);
  assert.equal(JSON.stringify(opened).includes('@'), false);
  const rejected = await fetch(`${origin}${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ name: 'Nope', email: 'nope@example.com', password: 'prefix-pass-1' }),
  });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error, 'csrf_failed');
});

function proxy(listenPort, upstreamPort, strip) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('proxy-miss');
      return;
    }
    const upstreamPath = strip ? (url.pathname.slice(base.length) || '/') + url.search : req.url;
    const upstream = http.request({
      host: '127.0.0.1', port: upstreamPort, path: upstreamPath, method: req.method, headers: req.headers,
    }, remote => {
      res.writeHead(remote.statusCode, remote.headers);
      remote.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  }).listen(listenPort, '127.0.0.1');
}

function once(emitter, event) {
  return new Promise(resolve => emitter.once(event, resolve));
}

async function exerciseBrowser(origin) {
  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-chrome-'));
  const chrome = spawn('google-chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let chromeLog = '';
  chrome.stderr.on('data', chunk => { chromeLog += chunk; });
  chrome.stdout.on('data', chunk => { chromeLog += chunk; });
  try {
    const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const browser = new Cdp(new WebSocket(version.webSocketDebuggerUrl));
    await browser.opened;
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Network.enable', {}, sessionId);
    await browser.send('Runtime.enable', {}, sessionId);
    const requests = [];
    browser.on(message => {
      if (message.method === 'Network.requestWillBeSent' && message.sessionId === sessionId) {
        requests.push(message.params.request.url);
      }
    });

    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    await navigate(browser, sessionId, `${origin}${base}/zh`);
    await waitFor(async () => browser.eval(sessionId, `(() => {
      const link = document.querySelector('a[data-course-portal]');
      return !!link && document.body.innerText.includes('LLM 是如何');
    })()`), 20000);
    const desktopPortal = await browser.eval(sessionId, `(() => {
      const link = document.querySelector('a[data-course-portal]');
      const rect = link.getBoundingClientRect();
      return { href: link.getAttribute('href'), text: link.innerText, top: rect.top, height: rect.height, visible: rect.width > 40 && rect.top >= 0 && rect.bottom <= innerHeight };
    })()`);
    assert.equal(desktopPortal.href, '/how-image-models-work/');
    assert.match(desktopPortal.text, /图像模型是如何运作的/);
    assert.equal(desktopPortal.visible, true, JSON.stringify(desktopPortal));
    await saveShot(browser, sessionId, '/opt/cursor/artifacts/zh-home-desktop.png');
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    }, sessionId);
    await waitFor(async () => browser.eval(sessionId, `(() => {
      const link = document.querySelector('a[data-course-portal]');
      if (!link) return false;
      const rect = link.getBoundingClientRect();
      return rect.width > 40 && rect.top >= 0 && rect.bottom <= innerHeight;
    })()`), 5000);
    await saveShot(browser, sessionId, '/opt/cursor/artifacts/zh-home-mobile.png');
    await browser.eval(sessionId, `document.querySelector('a[data-course-portal]').click()`);
    await waitFor(async () => (await browser.eval(sessionId, 'location.pathname')) === '/how-image-models-work/', 10000);
    assert.equal(await browser.eval(sessionId, 'location.pathname'), '/how-image-models-work/');
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    await navigate(browser, sessionId, `${origin}${base}/zh/chapters/overview`);
    await waitFor(async () => (await browser.eval(sessionId, 'location.pathname')) === `${base}/zh/chapters/overview`, 20000);
    assert.equal(await browser.eval(sessionId, 'document.querySelector("a[data-course-portal]")'), null);
    assert.equal(await browser.eval(sessionId, 'location.pathname.includes("/auth/")'), false);
    await waitFor(async () => browser.eval(sessionId, `(() => {
      const slider = document.querySelector('input[type=range]');
      if (!slider) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(slider, '2.4');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      return document.body.innerText.includes('2.40');
    })()`), 20000);

    const quiz = await browser.eval(sessionId, `(() => {
      const choice = document.querySelector('input[type=radio]');
      if (!choice) return 'missing';
      choice.click();
      return choice.checked && location.pathname.startsWith(${JSON.stringify(base)}) ? 'ok' : location.pathname;
    })()`);
    assert.equal(quiz, 'ok');

    const moved = await browser.eval(sessionId, `(() => {
      const link = document.querySelector('a[href*="/chapters/tokenization"]');
      if (!link) return 'missing';
      link.click();
      return link.getAttribute('href');
    })()`);
    assert.match(moved, /^\/how-LLM-works\/zh\/chapters\/tokenization/);
    await waitFor(async () => (await browser.eval(sessionId, 'location.pathname')).includes('/tokenization'), 15000);
    const nested = await browser.eval(sessionId, 'location.pathname');
    assert.equal(nested, `${base}/zh/chapters/tokenization`);
    await browser.send('Page.reload', { ignoreCache: true }, sessionId);
    await browser.waitFor(message => message.method === 'Page.loadEventFired' && message.sessionId === sessionId, 20000);
    await waitFor(async () => browser.eval(sessionId, `(() => {
      const title = document.querySelector('h1')?.textContent || '';
      return title.includes('分词') || /token/i.test(title);
    })()`), 20000);
    assert.equal(await browser.eval(sessionId, 'location.pathname'), `${base}/zh/chapters/tokenization`);

    const english = await browser.eval(sessionId, `(() => {
      const button = document.querySelector('button[lang="en"], button[aria-label="English"]');
      if (!button) return 'missing';
      button.click();
      return true;
    })()`);
    assert.equal(english, true);
    await waitFor(async () => {
      const pathname = await browser.eval(sessionId, 'location.pathname');
      return pathname.startsWith(`${base}/chapters/`);
    }, 15000);

    const bad = requests.filter(url => {
      if (!url.startsWith(origin)) return false;
      const pathname = new URL(url).pathname;
      if (pathname === '/favicon.ico') return false;
      if (pathname === '/how-image-models-work' || pathname.startsWith('/how-image-models-work/')) return false;
      if (pathname === base || pathname.startsWith(`${base}/`)) return false;
      return true;
    });
    assert.deepEqual(bad, []);
    assert.ok(requests.some(url => new URL(url).pathname === '/how-image-models-work/'));
    const favicon = await fetch(`${origin}/favicon.ico`);
    assert.equal(favicon.status, 404);
    assert.ok(requests.some(url => new URL(url).pathname.startsWith(`${base}/assets/`) && url.includes('KaTeX')));
    await browser.close();
  } catch (error) {
    error.message += `\nChrome log:\n${chromeLog.slice(-4000)}`;
    throw error;
  } finally {
    chrome.kill('SIGKILL');
    await new Promise(resolve => {
      if (chrome.exitCode !== null || chrome.signalCode) resolve();
      else chrome.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }
}

async function saveShot(browser, sessionId, file) {
  const shot = await browser.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
}

async function navigate(browser, sessionId, url) {
  const loaded = browser.waitFor(message => message.method === 'Page.loadEventFired' && message.sessionId === sessionId, 20000);
  await browser.send('Page.navigate', { url }, sessionId);
  await loaded;
}

async function waitFor(check, timeout) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      if (await check()) return;
    } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`timed out${last ? `: ${last.message}` : ''}`);
}

async function waitForJson(url) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < 15000) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      last = `${response.status}`;
    } catch (error) { last = error.message; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`chrome debugger unavailable: ${last}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.opened = new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } else this.listeners.forEach(listener => listener(message));
    });
  }
  on(listener) { this.listeners.add(listener); }
  send(method, params = {}, sessionId) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  waitFor(predicate, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error('CDP event timed out'));
      }, timeout);
      const listener = message => {
        if (!predicate(message)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(message);
      };
      this.listeners.add(listener);
    });
  }
  async eval(sessionId, expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluation failed');
    return result.result.value;
  }
  close() { this.ws.close(); }
}
