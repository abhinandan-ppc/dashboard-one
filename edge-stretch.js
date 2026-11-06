// edge-stretch.js — iOS/Android-style content stretch on overscroll.
//
// Pulling past the top/bottom of the page stretches the page content itself
// (like Android 12+'s edge-effect, or iOS's rubber-band), then springs back
// on release. A plain `transform` on <body> would do this in one line, but
// `transform` on an element creates a new containing block for every
// position:fixed/absolute DESCENDANT of it — every fixed header, modal and
// overlay on the page would stop being fixed to the viewport and start being
// fixed to the transformed box instead. That is exactly what broke dashboards
// site-wide the last time an overscroll-stretch effect was tried here (see
// commit b70e94d). So instead of transforming <body>, this moves every
// non-fixed/sticky child of <body> into one wrapper div and stretches only
// that — fixed/sticky elements (headers, modals, the sync/boot overlays) are
// left as direct children of <body>, completely untouched.
(function(){'use strict';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var MAX_PULL = 100;      // px of raw wheel/touch delta that maxes the effect out
  var MAX_STRETCH = 0.14;  // peak extra length at full pull (14% taller)
  var SPRING_MS = 420;
  var root = document.scrollingElement || document.documentElement;
  var wrap = null, amtTop = 0, amtBottom = 0;

  function isExempt(el){
    var p = getComputedStyle(el).position;
    return p === 'fixed' || p === 'sticky';
  }
  // Lazy: only touches the DOM the first time a pull actually happens, and
  // only on pages that really scroll (see the scrollable() guard below) —
  // a page like PM-Yard's full-viewport fixed body never calls this.
  function ensureWrap(){
    if (wrap) return wrap;
    var body = document.body;
    wrap = document.createElement('div');
    wrap.id = 'edge-stretch-wrap';
    Array.prototype.slice.call(body.children).forEach(function(el){
      if (isExempt(el)) return;
      wrap.appendChild(el);
    });
    body.insertBefore(wrap, body.firstChild);
    return wrap;
  }
  function scrollable(){ return root.scrollHeight > root.clientHeight + 1; }
  function atTop(){ return root.scrollTop <= 0; }
  function atBottom(){ return Math.ceil(root.scrollTop + root.clientHeight) >= root.scrollHeight; }

  function paint(instant){
    ensureWrap();
    wrap.classList.toggle('is-pulling', !!instant);
    if (amtTop > 0) {
      wrap.style.transformOrigin = 'top';
      wrap.style.transform = 'scaleY(' + (1 + Math.min(1, amtTop / MAX_PULL) * MAX_STRETCH) + ')';
    } else if (amtBottom > 0) {
      wrap.style.transformOrigin = 'bottom';
      wrap.style.transform = 'scaleY(' + (1 + Math.min(1, amtBottom / MAX_PULL) * MAX_STRETCH) + ')';
    } else {
      wrap.style.transform = '';
    }
  }
  function release(){
    if (!amtTop && !amtBottom) return;
    amtTop = 0; amtBottom = 0;
    paint(false);
  }

  window.addEventListener('wheel', function(e){
    if (!scrollable()) return;
    if (atTop() && e.deltaY < 0) {
      amtTop = Math.min(MAX_PULL, amtTop - e.deltaY * 0.5);
      paint(true);
    } else if (atBottom() && e.deltaY > 0) {
      amtBottom = Math.min(MAX_PULL, amtBottom + e.deltaY * 0.5);
      paint(true);
    } else if (amtTop || amtBottom) {
      release();
    }
  }, { passive: true });

  var touchY = 0, touching = false;
  window.addEventListener('touchstart', function(e){
    touchY = e.touches[0].clientY; touching = true;
  }, { passive: true });
  window.addEventListener('touchmove', function(e){
    if (!touching || !scrollable()) return;
    var y = e.touches[0].clientY, dy = y - touchY;
    touchY = y;
    if (atTop() && dy > 0) {
      amtTop = Math.min(MAX_PULL, amtTop + dy);
      paint(true);
    } else if (atBottom() && dy < 0) {
      amtBottom = Math.min(MAX_PULL, amtBottom - dy);
      paint(true);
    } else if (amtTop || amtBottom) {
      release();
    }
  }, { passive: true });
  window.addEventListener('touchend', release, { passive: true });
  window.addEventListener('touchcancel', release, { passive: true });
  // A real scroll happening (momentum, keyboard, anchor jump) means the pull
  // resolved into an actual scroll rather than an edge pull — snap back instead
  // of leaving the content stretched.
  window.addEventListener('scroll', function(){
    if (amtTop || amtBottom) release();
  }, { passive: true, capture: true });

  document.documentElement.style.setProperty('--edge-stretch-spring-ms', SPRING_MS + 'ms');
})();
