import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scrypt = promisify(scryptCallback);
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const publicUser = row => row ? { id: row.id, name: row.name, email: row.email, createdAt: row.created_at } : null;

export function createAuth() {
  const dataDir = path.resolve(process.env.AUTH_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'how-llms-work'));
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const dbPath = path.join(dataDir, 'auth.sqlite');
  const db = new DatabaseSync(dbPath);
  fs.chmodSync(dbPath, 0o600);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `);
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const insertUser = db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)');
  const insertSession = db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)');
  const removeSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const getSession = db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`);
  const expireSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  const attempts = new Map();
  const dummySalt = randomBytes(16).toString('hex');
  const dummyHash = awaitableDummy();
  function awaitableDummy() {
    return scrypt(randomBytes(32).toString('hex'), dummySalt, 64);
  }
  function cookies(req) {
    const result = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const index = part.indexOf('=');
      if (index > 0) result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
    return result;
  }
  function secure(req) {
    return Boolean(req.socket.encrypted) || process.env.PUBLIC_ORIGIN?.startsWith('https://');
  }
  function setCookie(req, res, name, value, maxAge, httpOnly = true) {
    const cookie = `${name}=${value}; Path=/; SameSite=Lax; Max-Age=${maxAge}${httpOnly ? '; HttpOnly' : ''}${secure(req) ? '; Secure' : ''}`;
    const existing = res.getHeader('Set-Cookie') || [];
    res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), cookie]);
  }
  function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  function user(req) {
    const session = cookies(req).llm_session;
    if (!session || !/^[a-f0-9]{64}$/.test(session)) return null;
    return publicUser(getSession.get(hash(session), Date.now()));
  }
  function csrf(req, res) {
    const existing = cookies(req).llm_csrf;
    if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;
    const value = token();
    setCookie(req, res, 'llm_csrf', value, SESSION_TTL / 1000);
    return value;
  }
  function allowedMutation(req) {
    const expected = process.env.PUBLIC_ORIGIN || `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
    if (req.headers.origin !== expected) return false;
    return equal(cookies(req).llm_csrf, req.headers['x-csrf-token']);
  }
  function limited(key, limit, period = 15 * 60 * 1000) {
    const now = Date.now();
    if (attempts.size > 10000) for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
    let entry = attempts.get(key);
    if (!entry || entry.until <= now) {
      entry = { count: 0, until: now + period };
      attempts.set(key, entry);
    }
    entry.count++;
    return entry.count > limit;
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) {
      const error = new Error('invalid_content_type'); error.status = 415; throw error;
    }
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 8192) {
        const error = new Error('body_too_large'); error.status = 413; throw error;
      }
      chunks.push(chunk);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch {
      const error = new Error('invalid_json'); error.status = 400; throw error;
    }
  }
  async function handle(req, res, pathname) {
    if (!pathname.startsWith('/api/auth/')) return false;
    if (pathname === '/api/auth/session' && req.method === 'GET') {
      expireSessions.run(Date.now());
      json(res, 200, { user: user(req), csrfToken: csrf(req, res) });
      return true;
    }
    if (!['/api/auth/register', '/api/auth/login', '/api/auth/logout'].includes(pathname)) {
      json(res, 404, { error: 'not_found' }); return true;
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method_not_allowed' }); return true;
    }
    if (!allowedMutation(req)) {
      json(res, 403, { error: 'csrf_failed' }); return true;
    }
    try {
      if (pathname === '/api/auth/logout') {
        const session = cookies(req).llm_session;
        if (session) removeSession.run(hash(session));
        setCookie(req, res, 'llm_session', '', 0);
        setCookie(req, res, 'llm_csrf', '', 0);
        json(res, 200, { ok: true }); return true;
      }
      const ip = req.socket.remoteAddress || 'unknown';
      const isRegister = pathname.endsWith('register');
      if (limited(`${isRegister ? 'register' : 'login'}:${ip}`, isRegister ? 10 : 40)) {
        res.setHeader('Retry-After', '900');
        json(res, 429, { error: 'rate_limited' }); return true;
      }
      const data = await body(req);
      const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
      const password = typeof data.password === 'string' ? data.password : '';
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        json(res, 400, { error: 'invalid_email' }); return true;
      }
      if (password.length < 8 || password.length > 128) {
        json(res, 400, { error: 'invalid_password' }); return true;
      }
      if (isRegister) {
        const name = typeof data.name === 'string' ? data.name.trim() : '';
        if (name.length < 1 || name.length > 60 || /[\u0000-\u001f]/.test(name)) {
          json(res, 400, { error: 'invalid_name' }); return true;
        }
        if (byEmail.get(email)) {
          json(res, 409, { error: 'email_exists' }); return true;
        }
        const salt = randomBytes(16).toString('hex');
        const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
        try { insertUser.run(token(), email, name, passwordHash, salt, Date.now()); }
        catch (error) {
          if (error.code?.startsWith('ERR_SQLITE') && byEmail.get(email)) {
            json(res, 409, { error: 'email_exists' }); return true;
          }
          throw error;
        }
        // Registration deliberately does not create a session: log in with the new credentials.
        json(res, 201, { ok: true }); return true;
      }
      if (limited(`account:${email}`, 15)) {
        res.setHeader('Retry-After', '900');
        json(res, 429, { error: 'rate_limited' }); return true;
      }
      const row = byEmail.get(email);
      const supplied = await scrypt(password, row?.salt || dummySalt, 64);
      const expected = row ? Buffer.from(row.password_hash, 'hex') : await dummyHash;
      if (!timingSafeEqual(supplied, expected) || !row) {
        json(res, 401, { error: 'invalid_credentials' }); return true;
      }
      attempts.delete(`account:${email}`);
      // Rotate any previous browser session on successful login.
      const previous = cookies(req).llm_session;
      if (previous) removeSession.run(hash(previous));
      const session = token();
      insertSession.run(hash(session), row.id, Date.now() + SESSION_TTL, Date.now());
      setCookie(req, res, 'llm_session', session, SESSION_TTL / 1000);
      setCookie(req, res, 'llm_csrf', token(), SESSION_TTL / 1000);
      json(res, 200, { ok: true, user: publicUser(row) });
      return true;
    } catch (error) {
      if (!error.status) console.error('Authentication request failed:', error.message);
      json(res, error.status || 500, { error: error.status ? error.message : 'server_error' });
      return true;
    }
  }
  return { handle, user, dbPath };
}
