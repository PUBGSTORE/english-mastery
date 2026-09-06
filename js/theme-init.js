// Applies the saved theme before first paint (kept external so the Content-Security-Policy can forbid inline scripts).
try {
  var t = localStorage.getItem('em.theme');
  if (!t) t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
} catch (e) { /* ignore */ }
