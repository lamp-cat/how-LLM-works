// Public mount path for a shared host. Empty means the process owns the origin root.
export function normalizeBasePath(value = process.env.BASE_PATH || '') {
  const raw = String(value ?? '').trim();
  if (raw === '' || raw === '/') return '';
  const path = (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/+$/, '');
  if (!/^\/[A-Za-z0-9._~-]+$/.test(path)) {
    throw new Error(`BASE_PATH must be one case-sensitive URL segment, received ${JSON.stringify(value)}`);
  }
  return path;
}

export function stripBasePath(pathname, basePath) {
  if (!basePath) return pathname;
  if (pathname === basePath) return '/';
  if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length) || '/';
  return null;
}

export function withBasePath(urlPath, basePath) {
  if (!basePath || !urlPath.startsWith('/') || urlPath.startsWith('//')) return urlPath;
  if (urlPath === basePath || urlPath.startsWith(`${basePath}/`)) return urlPath;
  return `${basePath}${urlPath}`;
}

function isPrivatePeer(address) {
  const ip = String(address || '').replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(ip) || /^192\.168\.\d+\.\d+$/.test(ip)) return true;
  const match = /^172\.(\d+)\.\d+\.\d+$/.exec(ip);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return ip.startsWith('fc') || ip.startsWith('fd');
}

// Only a private reverse proxy may supply the client address. A public peer
// cannot spoof the rate-limit key by sending X-Real-IP.
export function clientAddress(req) {
  const peer = req.socket?.remoteAddress || '';
  const header = req.headers?.['x-real-ip'];
  const forwarded = typeof header === 'string' ? header.trim() : '';
  if (process.env.TRUST_PROXY === '1' && isPrivatePeer(peer)
    && forwarded && /^[0-9a-fA-F:.]+$/.test(forwarded)) return forwarded;
  return peer || 'unknown';
}
