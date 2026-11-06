// edge-stretch.js — a rubber-band "edge stretch" cue when the page is pulled
// past its top or bottom scroll limit.
//
// This replaces the earlier Lenis-based smooth-scroll + overscroll-stretch
// setup (removed site-wide). That setup had two problems: Lenis took over
// native scrolling, and a previous overscroll-stretch attempt applied a CSS
// transform to html/body to visually "stretch" the page. A transform on
// html/body creates a new containing block for every position:fixed element
// on the page (headers, modals, boot overlays) — they stop being fixed to
// the viewport and start being fixed to the transformed box instead, which
// is what broke dashboards across the site before and is why it was reverted.
//
// This version never transforms real page content. It only grows/fades two
// thin fixed overlay bars at the very top/bottom of the viewport while the
// user keeps pulling past the edge, then springs them back on release — a
// purely additive visual cue with no layout or containing-block side effects.
(function(){'use strict';
  var MAX_PULL = 70; // px of raw wheel/touch delta that maxes the effect out
  var MAX_HEIGHT = 26; // px, how tall the glow bar gets at full pull
  var root = document.scrollingElement || document.documentElement;
  var topEl, bottomEl, amtTop = 0, amtBottom = 0;

  function ensureEls(){
    if (topEl) return;
    topEl = document.createElement('div'); topEl.className = 'edge-stretch edge-stretch-top'; topEl.setAttribute('aria-hidden', 'true');
    bottomEl = document.createElement('div'); bottomEl.className = 'edge-stretch edge-stretch-bottom'; bottomEl.setAttribute('aria-hidden', 'true');
    (document.body || document.documentElement).appendChild(topEl);
    (document.body || document.documentElement).appendChild(bottomEl);
  }
  function atTop(){ return root.scrollTop <= 0; }
  function atBottom(){ return Math.ceil(root.scrollTop + root.clientHeight) >= root.scrollHeight; }
  function paint(){
    ensureEls();
    var tp = Math.min(1, amtTop / MAX_PULL), bp = Math.min(1, amtBottom / MAX_PULL);
    topEl.style.height = Math.round(tp * MAX_HEIGHT) + 'px';
    topEl.style.opacity = tp;
    bottomEl.style.height = Math.round(bp * MAX_HEIGHT) + 'px';
    bottomEl.style.opacity = bp;
  }
  function pulling(on){
    if (!topEl) return;
    topEl.classList.toggle('is-pulling', on);
    bottomEl.classList.toggle('is-pulling', on);
  }
  function release(){
    if (!amtTop && !amtBottom) return;
    amtTop = 0; amtBottom = 0;
    pulling(false);
    paint();
  }

  window.addEventListener('wheel', function(e){
    if (atTop() && e.deltaY < 0) {
      ensureEls(); pulling(true);
      amtTop = Math.min(MAX_PULL, amtTop - e.deltaY * 0.5);
      paint();
    } else if (atBottom() && e.deltaY > 0) {
      ensureEls(); pulling(true);
      amtBottom = Math.min(MAX_PULL, amtBottom + e.deltaY * 0.5);
      paint();
    } else if (amtTop || amtBottom) {
      release();
    }
  }, { passive: true });

  var touchY = 0, touching = false;
  window.addEventListener('touchstart', function(e){
    touchY = e.touches[0].clientY; touching = true;
  }, { passive: true });
  window.addEventListener('touchmove', function(e){
    if (!touching) return;
    var y = e.touches[0].clientY, dy = y - touchY;
    touchY = y;
    if (atTop() && dy > 0) {
      ensureEls(); pulling(true);
      amtTop = Math.min(MAX_PULL, amtTop + dy);
      paint();
    } else if (atBottom() && dy < 0) {
      ensureEls(); pulling(true);
      amtBottom = Math.min(MAX_PULL, amtBottom - dy);
      paint();
    } else if (amtTop || amtBottom) {
      release();
    }
  }, { passive: true });
  window.addEventListener('touchend', release, { passive: true });
  window.addEventListener('touchcancel', release, { passive: true });
  // A real scroll happening (momentum, keyboard, anchor jump) means the pull
  // resolved into an actual scroll rather than an edge pull — snap back instead
  // of leaving a stale glow showing.
  window.addEventListener('scroll', function(){
    if (amtTop || amtBottom) release();
  }, { passive: true, capture: true });
})();
