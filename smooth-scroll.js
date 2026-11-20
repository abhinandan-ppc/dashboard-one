(function () {
  'use strict';
  var preference = matchMedia('(prefers-reduced-motion: reduce)');
  var instance = null;
  function sync() {
    if (instance) { instance.destroy(); instance = null; }
    if (!preference.matches && window.Lenis) {
      instance = new Lenis({
        autoRaf: true, smoothWheel: true, syncTouch: false,
        allowNestedScroll: true, lerp: 0.1,
        prevent: function (node) {
          return node.matches('dialog,[role="dialog"],input,textarea,select,[contenteditable="true"]') ||
            document.documentElement.classList.contains('card-reordering');
        }
      });
    }
  }
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/lenis@1.3.27/dist/lenis.min.js';
  script.onload = sync;
  document.head.appendChild(script);
  preference.addEventListener('change', sync);
  window.addEventListener('pagehide', function () { if (instance) instance.destroy(); instance = null; });
  window.addEventListener('pageshow', sync);
})();
