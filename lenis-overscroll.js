// lenis-overscroll.js — iOS/Android elastic end-scroll stretch
// Works alongside Lenis smooth scroll. Stretches content when pulling
// past the top/bottom boundary on the page and on any scrollable container
// (tables, .table-scroll, .scroll-container, etc.).
(function(){
  'use strict';

  const MAX_STRETCH = 60;      // max stretch px
  const PULL_RATIO  = 0.35;    // stretch px per wheel/touch px
  const SPRING      = 0.18;    // snap-back spring coefficient

  // ── CSS ──────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = [
    'html, body { overscroll-behavior: none !important; }',
    '.os-container { overscroll-behavior: contain; }',
    '[data-os-dir] { will-change: transform; transform: translate3d(0, var(--os-y, 0), 0); }',
    '.os-snap { transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1); }',
  ].join('\n');
  document.head.appendChild(style);

  function isAtTop(el){ return el.scrollTop <= 0; }
  function isAtBottom(el){ return el.scrollTop >= el.scrollHeight - el.clientHeight - 1; }

  function setup(el){
    if (!el || el.dataset.osReady) return;
    el.dataset.osReady = '1';
    el.classList.add('os-container');

    let stretch = 0;
    let raf = null;
    let releasing = false;
    let touchStartY = 0;

    function release(){
      if (releasing || stretch === 0) return;
      releasing = true;
      el.classList.add('os-snap');
      (function frame(){
        stretch *= (1 - SPRING);
        if (Math.abs(stretch) < 0.4){
          stretch = 0;
          el.removeAttribute('data-os-dir');
          el.style.removeProperty('--os-y');
          el.classList.remove('os-snap');
          releasing = false;
          raf = null;
          return;
        }
        apply();
        raf = requestAnimationFrame(frame);
      })();
    }

    function apply(){
      el.style.setProperty('--os-y', stretch + 'px');
      el.dataset.osDir = stretch > 0 ? 'bottom' : 'top';
    }

    function onWheel(e){
      if (releasing) return;
      const atTop = isAtTop(el);
      const atBottom = isAtBottom(el);
      let stretched = false;

      if (atTop && e.deltaY < 0){
        e.preventDefault();
        e.stopPropagation();
        stretch = Math.min(MAX_STRETCH, stretch - e.deltaY * PULL_RATIO);
        stretched = true;
      } else if (atBottom && e.deltaY > 0){
        e.preventDefault();
        e.stopPropagation();
        stretch = Math.min(MAX_STRETCH, stretch + e.deltaY * PULL_RATIO);
        stretched = true;
      }

      if (stretched){
        apply();
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      } else if (stretch !== 0 && raf === null){
        release();
      }
    }

    function onTouchStart(e){ touchStartY = e.touches[0].clientY; }
    function onTouchMove(e){
      if (releasing) return;
      const atTop = isAtTop(el);
      const atBottom = isAtBottom(el);
      const dy = touchStartY - e.touches[0].clientY; // + = scrolling up
      let stretched = false;

      if (atTop && dy < 0){
        e.preventDefault();
        e.stopPropagation();
        stretch = Math.min(MAX_STRETCH, stretch - dy * PULL_RATIO);
        stretched = true;
      } else if (atBottom && dy > 0){
        e.preventDefault();
        e.stopPropagation();
        stretch = Math.min(MAX_STRETCH, stretch + dy * PULL_RATIO);
        stretched = true;
      }

      if (stretched){
        apply();
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      } else if (stretch !== 0 && raf === null){
        release();
      }
    }
    function onTouchEnd(){ release(); }

    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('mouseup', release);
    el.addEventListener('mouseleave', release);
  }

  function init(){
    setup(document.documentElement);
    setup(document.body);
    document.querySelectorAll('table, .table-scroll, .scroll-container, [data-scroll-stretch]').forEach(setup);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.setupOverscrollStretch = setup;
})();
