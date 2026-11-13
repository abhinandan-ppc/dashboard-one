// Shared edge elasticity. Never reparent application DOM or transform a scroller.
(function () {
  'use strict';
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var root = document.scrollingElement || document.documentElement;
  var state = null, frame = 0, idle = 0, touch = null;
  var ignored = 'input,textarea,select,[contenteditable="true"],[data-edge-stretch="off"]';

  function owner(target) {
    if (!(target instanceof Element) || target.closest(ignored)) return null;
    for (var el = target; el && el !== document.body && el !== root; el = el.parentElement) {
      var css = getComputedStyle(el);
      if (/(auto|scroll)/.test(css.overflowY) && el.scrollHeight > el.clientHeight + 1) return el;
      if (css.position === 'fixed') return null;
    }
    return root.scrollHeight > root.clientHeight + 1 ? root : null;
  }

  function clear() {
    cancelAnimationFrame(frame);
    clearTimeout(idle);
    frame = idle = 0;
    if (!state) return;
    state.parts.forEach(function (part) {
      part.el.style.removeProperty('--edge-scale');
      part.el.style.removeProperty('--edge-origin');
      part.el.classList.remove('edge-stretch-surface');
    });
    state = null;
  }

  function begin(scroller, edge) {
    clear();
    var bounds = scroller === root ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
    var parts = [];
    // Split branches containing pinned controls or independent scrollers.
    // React roots, flex/grid children and table structure retain their parents.
    function collect(el) {
      var rect = el.getBoundingClientRect();
      // Large reports can contain thousands of offscreen cells. Do not inspect
      // descendants of offscreen branches or promote those branches to layers.
      if (rect.height > 0 && (rect.bottom <= bounds.top || rect.top >= bounds.bottom)) return { safe: false, parts: [] };
      var css = getComputedStyle(el);
      if (/^(SCRIPT|STYLE|LINK|IFRAME|SVG)$/.test(el.tagName) ||
          css.position === 'fixed' || css.position === 'sticky' || css.display === 'none' ||
          el.matches(ignored)) return { safe: false, parts: [] };
      var children = [], safe = css.transform === 'none' && (css.scale === 'none' || !css.scale);
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY) && el.scrollHeight > el.clientHeight + 1) return { safe: false, parts: [] };
      Array.from(el.children).forEach(function (child) {
        var result = collect(child);
        safe = safe && result.safe;
        children = children.concat(result.parts);
      });
      if (safe && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom) {
        return { safe: true, parts: [{ el: el, top: rect.top }] };
      }
      return { safe: safe, parts: children };
    }
    Array.from((scroller === root ? document.body : scroller).children).forEach(function (el) {
      parts = parts.concat(collect(el).parts);
    });
    if (!parts.length) return false;
    state = { scroller: scroller, edge: edge, parts: parts, raw: 0, value: 0,
      height: scroller.clientHeight, max: scroller.scrollHeight - scroller.clientHeight,
      releasing: false, started: 0 };
    var anchor = edge === 'top' ? bounds.top : bounds.bottom;
    parts.forEach(function (part) {
      part.el.style.setProperty('--edge-origin', '50% ' + (anchor - part.top) + 'px');
      part.el.classList.add('edge-stretch-surface');
    });
    return true;
  }

  function paint(now) {
    frame = 0;
    if (!state) return;
    if (state.releasing) {
      if (!state.started) state.started = now;
      // Critically damped return, without bouncing past rest.
      var t = (now - state.started) / 65;
      state.value = state.releasedValue * (1 + t) * Math.exp(-t);
      if (t > 9 || state.value < 0.0001) { clear(); return; }
    } else {
      var limit = Math.min(0.045, 32 / Math.max(1, state.height));
      state.value = limit * state.raw / (state.raw + 110);
    }
    state.parts.forEach(function (part) {
      part.el.style.setProperty('--edge-scale', String(1 + state.value));
    });
    if (state.releasing) frame = requestAnimationFrame(paint);
  }

  function release() {
    clearTimeout(idle);
    if (!state || state.releasing) return;
    state.releasing = true;
    state.releasedValue = state.value;
    state.started = 0;
    if (!frame) frame = requestAnimationFrame(paint);
  }

  // Positive dy moves toward the bottom, matching WheelEvent.
  function pull(scroller, dy, event) {
    if (!event.cancelable || motion.matches) { clear(); return; }
    if (!scroller || !dy) { release(); return; }
    if (state && state.scroller !== scroller) clear();
    var max = state ? state.max : scroller.scrollHeight - scroller.clientHeight;
    var edge = dy < 0 && scroller.scrollTop <= 1 ? 'top'
      : dy > 0 && scroller.scrollTop >= max - 1 ? 'bottom' : null;
    if (!edge) { clear(); return; }
    if (!state || state.edge !== edge) { if (!begin(scroller, edge)) return; }
    event.preventDefault();
    if (state.releasing) {
      var limit = Math.min(0.045, 32 / Math.max(1, state.height));
      state.raw = 110 * state.value / Math.max(0.00001, limit - state.value);
      state.releasing = false;
    }
    state.raw = Math.min(900, state.raw + Math.min(100, Math.abs(dy)));
    if (!frame) frame = requestAnimationFrame(paint);
  }

  window.addEventListener('wheel', function (event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) { release(); return; }
    var scroller = owner(event.target);
    var unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (scroller ? scroller.clientHeight : 600) : 1;
    pull(scroller, event.deltaY * unit, event);
    clearTimeout(idle);
    idle = setTimeout(release, 110);
  }, { passive: false });

  window.addEventListener('touchstart', function (event) {
    release();
    touch = event.touches.length === 1 ? { owner: owner(event.target),
      x: event.touches[0].clientX, y: event.touches[0].clientY, axis: null } : null;
  }, { passive: true });
  window.addEventListener('touchmove', function (event) {
    if (!touch || event.touches.length !== 1 || event.defaultPrevented) { touch = null; release(); return; }
    var point = event.touches[0], dx = point.clientX - touch.x, dy = touch.y - point.clientY;
    if (!touch.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 5) return;
      touch.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    touch.x = point.clientX;
    touch.y = point.clientY;
    if (touch.axis === 'y') pull(touch.owner, dy, event);
  }, { passive: false });
  function endTouch() { touch = null; release(); }
  window.addEventListener('touchend', endTouch, { passive: true });
  window.addEventListener('touchcancel', endTouch, { passive: true });
  window.addEventListener('scroll', function (event) {
    if (state && (event.target === state.scroller || (state.scroller === root && event.target === document))) clear();
  }, { passive: true, capture: true });
  window.addEventListener('blur', function () { touch = null; clear(); });
  window.addEventListener('resize', clear);
  window.addEventListener('pagehide', clear);
  document.addEventListener('visibilitychange', function () { if (document.hidden) { touch = null; clear(); } });
  motion.addEventListener('change', clear);
})();
