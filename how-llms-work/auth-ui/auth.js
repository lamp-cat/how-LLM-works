const strings = {
  zh: {
    storyTitle: '从一个 token，\n看懂整个模型。', storyBody: '运行真实的语言模型，沿着 16 章交互式课程，一步步理解它如何计算、如何生成。',
    tokenize: '分词', embedding: '嵌入', generation: '生成', localCompute: '模型计算在你的浏览器中完成',
    name: '昵称', email: '邮箱', password: '密码', confirmPassword: '确认密码',
    passwordHint: '至少 8 个字符，最长 128 个字符', accountHint: '注册后即可使用账号登录',
    footer: '理解模型，从亲手运行开始。', loginTitle: '欢迎回来', registerTitle: '创建你的账号',
    accountTitle: '你的账户', loginSubtitle: '登录账号，继续探索模型的工作原理。',
    registerSubtitle: '注册后即可登录，开启你的模型探索之旅。', accountSubtitle: '你已登录，可以继续学习和运行模型。',
    login: '登录', register: '创建账号', noAccount: '还没有账号？', haveAccount: '已有账号？',
    goLogin: '去登录', joined: '注册时间', continueLearning: '继续学习', logout: '退出登录',
    showPassword: '显示密码', hidePassword: '隐藏密码', submitting: '正在提交…',
    registered: '注册成功！请使用新账号登录。', loggedOut: '你已退出登录。',
    invalid_email: '请输入有效的邮箱地址。', invalid_password: '密码长度须为 8–128 个字符。',
    invalid_name: '请输入 1–60 个字符的昵称。', passwordMismatch: '两次输入的密码不一致。',
    email_exists: '此邮箱已注册，请直接登录。', invalid_credentials: '邮箱或密码不正确，请检查后重试。',
    csrf_failed: '页面已过期，请刷新后重试。', rate_limited: '尝试次数过多，请 15 分钟后重试。',
    server_error: '服务暂时不可用，请稍后重试。', network_error: '连接失败，请检查网络后重试。',
  },
  en: {
    storyTitle: 'One token.\nThe whole model.', storyBody: 'Run a real language model and follow 16 interactive chapters to understand how it computes and generates text.',
    tokenize: 'Tokenization', embedding: 'Embedding', generation: 'Generation', localCompute: 'Model computation stays in your browser',
    name: 'Display name', email: 'Email', password: 'Password', confirmPassword: 'Confirm password',
    passwordHint: '8–128 characters', accountHint: 'Register an account, then sign in',
    footer: 'Understand the model by running it.', loginTitle: 'Welcome back', registerTitle: 'Create your account',
    accountTitle: 'Your account', loginSubtitle: 'Sign in to continue exploring how the model works.',
    registerSubtitle: 'Create an account, then sign in to start exploring.', accountSubtitle: 'You are signed in and ready to learn and run the model.',
    login: 'Sign in', register: 'Create account', noAccount: 'New here?', haveAccount: 'Already have an account?',
    goLogin: 'Sign in', joined: 'Joined', continueLearning: 'Continue learning', logout: 'Sign out',
    showPassword: 'Show password', hidePassword: 'Hide password', submitting: 'Submitting…',
    registered: 'Account created! Sign in with your new credentials.', loggedOut: 'You have signed out.',
    invalid_email: 'Enter a valid email address.', invalid_password: 'Use a password between 8 and 128 characters.',
    invalid_name: 'Use a display name between 1 and 60 characters.', passwordMismatch: 'The passwords do not match.',
    email_exists: 'This email is already registered. Please sign in.', invalid_credentials: 'The email or password is incorrect.',
    csrf_failed: 'This page has expired. Refresh and try again.', rate_limited: 'Too many attempts. Try again in 15 minutes.',
    server_error: 'The service is unavailable. Please try again later.', network_error: 'Connection failed. Please try again.',
  },
};
const params = new URLSearchParams(location.search);
function safeNext(raw) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f]/.test(raw)) return null;
  try {
    const url = new URL(raw, location.origin);
    if (url.origin !== location.origin || url.pathname.startsWith('/auth/')) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}
let storedLocale;
try { storedLocale = localStorage.getItem('mlx:preferences:locale'); } catch {}
const incomingNext = safeNext(params.get('next'));
let locale = ['zh', 'en'].includes(params.get('lang')) ? params.get('lang')
  : incomingNext ? (incomingNext.startsWith('/zh') ? 'zh' : 'en')
    : ['zh', 'en'].includes(storedLocale) ? storedLocale : 'zh';
const mode = location.pathname === '/account' ? 'account' : location.pathname.endsWith('/register') ? 'register' : 'login';
let next = incomingNext || (locale === 'zh' ? '/zh/chapters/overview' : '/chapters/overview');
let csrfToken = '';
let account = null;
let busy = true;
let noticeKey = params.get('registered') ? 'registered' : params.get('loggedOut') ? 'loggedOut' : null;
let noticeSuccess = Boolean(noticeKey);
const $ = id => document.getElementById(id);
const form = $('auth-form');
function link(route, extras = {}) {
  return `${route}?${new URLSearchParams({ next, lang: locale, ...extras })}`;
}
function notify(key, success = false) {
  noticeKey = key; noticeSuccess = success; render();
}
function render() {
  const t = strings[locale];
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  document.title = `${t[`${mode}Title`]} · How LLMs Work`;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t[el.dataset.i18n];
    if (el.dataset.i18n === 'storyTitle') el.style.whiteSpace = 'pre-line';
  });
  document.querySelectorAll('[data-language]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.language === locale)));
  document.querySelector('.language-switch').setAttribute('aria-label', locale === 'zh' ? '语言' : 'Language');
  $('form-title').textContent = t[`${mode}Title`];
  $('form-subtitle').textContent = t[`${mode}Subtitle`];
  form.hidden = mode === 'account';
  $('account-details').hidden = mode !== 'account';
  $('switch-mode').hidden = mode === 'account';
  $('name-field').hidden = mode !== 'register';
  $('confirm-field').hidden = mode !== 'register';
  $('name').required = mode === 'register';
  $('confirm-password').required = mode === 'register';
  $('password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  $('submit-label').textContent = busy ? t.submitting : t[mode];
  $('submit-button').disabled = busy;
  $('logout-button').disabled = busy;
  $('switch-text').textContent = mode === 'register' ? t.haveAccount : t.noAccount;
  $('switch-link').textContent = mode === 'register' ? t.goLogin : t.register;
  $('switch-link').href = link(mode === 'register' ? '/auth/login' : '/auth/register');
  $('continue-link').href = next;
  document.querySelector('.brand').href = locale === 'zh' ? '/zh/chapters/overview' : '/chapters/overview';
  $('toggle-password').setAttribute('aria-label', $('password').type === 'password' ? t.showPassword : t.hidePassword);
  $('notice').hidden = !noticeKey;
  $('notice').classList.toggle('success', noticeSuccess);
  $('notice').textContent = noticeKey ? t[noticeKey] || t.server_error : '';
  if (account) {
    $('account-name').textContent = account.name;
    $('account-email').textContent = account.email;
    $('account-joined').textContent = new Date(account.createdAt).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en');
  }
}
document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => {
  locale = button.dataset.language;
  try { localStorage.setItem('mlx:preferences:locale', locale); } catch {}
  if (next === '/zh' || next.startsWith('/zh/')) next = next.slice(3) || '/';
  if (locale === 'zh' && !next.startsWith('/zh') && next !== '/account') next = next === '/' ? '/zh' : `/zh${next}`;
  const url = new URL(location.href);
  url.searchParams.set('lang', locale); url.searchParams.set('next', next);
  history.replaceState(null, '', url);
  render();
}));
$('toggle-password').addEventListener('click', () => {
  $('password').type = $('password').type === 'password' ? 'text' : 'password';
  render();
});
async function request(route, data) {
  const response = await fetch(`/api/auth/${route}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'server_error');
  return result;
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const email = $('email').value.trim();
  const password = $('password').value;
  const name = $('name').value.trim();
  if (mode === 'register' && (!name || name.length > 60)) { notify('invalid_name'); $('name').focus(); return; }
  if (!email || !$('email').validity.valid) { notify('invalid_email'); $('email').focus(); return; }
  if (password.length < 8 || password.length > 128) { notify('invalid_password'); $('password').focus(); return; }
  if (mode === 'register' && password !== $('confirm-password').value) { notify('passwordMismatch'); $('confirm-password').focus(); return; }
  busy = true; noticeKey = null; render();
  try {
    await request(mode === 'register' ? 'register' : 'login', { email, password, ...(mode === 'register' ? { name } : {}) });
    if (mode === 'register') {
      sessionStorage.setItem('llm:registered-email', email);
      location.replace(link('/auth/login', { registered: '1' }));
    } else {
      try { localStorage.setItem('llm:auth-change', String(Date.now())); } catch {}
      location.replace(next);
    }
  } catch (error) { notify(strings[locale][error.message] ? error.message : 'network_error'); }
  finally { busy = false; render(); }
});
$('logout-button').addEventListener('click', async () => {
  if (busy) return;
  busy = true; render();
  try {
    await request('logout', {});
    try { localStorage.setItem('llm:auth-change', String(Date.now())); } catch {}
    // Remove model cache entries from this application's origin on sign-out.
    if ('caches' in window) {
      try { for (const key of await caches.keys()) await caches.delete(key); } catch {}
    }
    location.replace(link('/auth/login', { loggedOut: '1' }));
  } catch (error) { busy = false; notify(strings[locale][error.message] ? error.message : 'network_error'); }
});
render();
try {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('server_error');
  const result = await response.json();
  csrfToken = result.csrfToken; account = result.user;
  if (mode === 'account' && !account) location.replace(link('/auth/login'));
  if (mode !== 'account' && account) location.replace(next);
  if (mode === 'login' && params.has('registered')) {
    const email = sessionStorage.getItem('llm:registered-email');
    if (email) $('email').value = email;
    sessionStorage.removeItem('llm:registered-email');
  }
} catch { notify('network_error'); }
finally { busy = !csrfToken; render(); }
