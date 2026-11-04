let account = null;
let checking = false;
const link = document.createElement('a');
link.id = 'llm-account-link';
link.href = '/account';
link.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;gap:6px;max-width:130px;min-height:32px;padding:5px 9px;border:1px solid var(--border,#302b38);border-radius:7px;color:var(--foreground,#eee9e5);font:12px -apple-system,BlinkMacSystemFont,sans-serif;white-space:nowrap;text-decoration:none;';
function mount() {
  if (!account) return;
  const zh = location.pathname === '/zh' || location.pathname.startsWith('/zh/');
  const text = zh ? '我的账户' : 'My account';
  if (link.textContent !== text) link.textContent = text;
  link.title = account.name;
  link.setAttribute('aria-label', `${text} · ${account.name}`);
  link.href = `/account?${new URLSearchParams({ lang: zh ? 'zh' : 'en', next: location.pathname + location.search })}`;
  const group = document.querySelector('[role="group"][aria-label="语言"],[role="group"][aria-label="Language"]');
  if (group?.parentElement && link.parentElement !== group.parentElement) group.before(link);
}
async function check() {
  if (checking) return;
  checking = true;
  try {
    const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    account = (await response.json()).user;
    if (!account) {
      const next = location.pathname + location.search;
      location.replace(`/auth/login?${new URLSearchParams({ next })}`);
      return;
    }
    mount();
  } catch {} finally { checking = false; }
}
// Router transitions rebuild the header; keep the account entry and language in sync.
new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('focus', check);
document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
window.addEventListener('storage', event => { if (event.key === 'llm:auth-change') check(); });
setInterval(check, 60000);
check();
