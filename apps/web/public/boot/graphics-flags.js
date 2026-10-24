// Runs before the app: marks the page for the lighter graphics fallbacks in
// styles.scss. Kept out of index.html so the page has no inline scripts.
(function () {
  var ua = navigator.userAgent;
  // Support kill switch: localStorage promptops.linux-perf = off.
  try { if (localStorage.getItem('promptops.linux-perf') === 'off') return; } catch (e) {}
  // WebKitGTK (Linux desktop app): "(X11; Linux x86_64) AppleWebKit" without Chrome.
  if (/Linux/.test(ua) && /AppleWebKit/.test(ua) && !/Chrome|Chromium|Android/.test(ua)) {
    document.documentElement.classList.add('po-webkitgtk');
  }
  // Intel Mac (flag injected by the native side): dual GPU and external
  // monitors can saturate the compositor, so the same fallbacks apply.
  if (window.__PROMPTOPS_INTEL_MAC__ === true) {
    document.documentElement.classList.add('po-lite-gfx');
  }
})();
