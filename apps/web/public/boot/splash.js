// Hides the splash screen: instantly on internal reloads (session switch),
// with the fade-out on the first start.
(function () {
  var splashScreen = document.querySelector('#splash-screen');
  if (!splashScreen) return;
  if (sessionStorage.getItem('promptops_booted')) {
    splashScreen.style.display = 'none';
  } else {
    sessionStorage.setItem('promptops_booted', '1');
    splashScreen.classList.add('remove');
  }
})();
