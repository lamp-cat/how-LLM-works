// Shows the image-course entry only on the Chinese LLM landing page.
(function () {
  const imageCourse = '/how-image-models-work/';
  document.addEventListener('click', event => {
    const link = event.target && event.target.closest && event.target.closest('a[data-course-portal]');
    if (!link) return;
    event.stopImmediatePropagation();
  }, true);

  function barePath() {
    const base = (globalThis.__HOW_LLMS_BASE__ || '').replace(/\/+$/, '');
    let path = location.pathname;
    if (base && (path === base || path.startsWith(`${base}/`))) path = path.slice(base.length) || '/';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return path;
  }

  function sync() {
    const home = barePath() === '/zh';
    const existing = document.querySelector('a[data-course-portal]');
    const host = home ? document.querySelector('.landing-content') : null;
    if (!home || !host) {
      existing?.remove();
      return;
    }
    if (existing && host.contains(existing)) return;
    existing?.remove();
    const link = document.createElement('a');
    link.className = 'course-portal';
    link.dataset.coursePortal = 'image';
    link.href = imageCourse;
    link.setAttribute('aria-label', '图像模型是如何运作的');
    link.innerHTML = '<span class="course-portal-copy"><span class="course-portal-kicker">另一门课程</span><span class="course-portal-title">图像模型是如何运作的</span></span><span class="course-portal-go" aria-hidden="true">→</span>';
    const sub = host.querySelector('.landing-sub');
    if (sub) sub.insertAdjacentElement('afterend', link);
    else host.append(link);
  }

  new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', sync);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync);
  else sync();
})();
