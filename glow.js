/**
 * glow.js — High-precision edge-detecting border & surface glow + interactive ripple
 * Built with zero layout side effects, no ::before/::after conflicts, no CSS position overrides.
 * Features corner radius synchronization and specialized row smoothing for tables.
 */
(function() {
  'use strict';

  var SELECTORS = [
    '.app-header',
    '.top-bar',
    '.top-wrapper > div',
    '.kpi',
    '.stat',
    '.kpi-card',
    '.stat-card',
    '.kcard',
    '.kpi-pill',
    '.kpi-group',
    '.kpi-dashboard > div',
    '.card',
    '.glass-card',
    '.m3-surface',
    '.card-lift',
    'button:not(.sw):not(.knob)',
    '.m3-button',
    '.btn',
    '.action-btn',
    '.tbtn',
    '.data-table-wrap tbody tr',
    'table tbody tr'
  ].join(', ');

  /* ── Card cursor tilt selectors (cards & KPI cards only) ── */
  var TILT_SELECTORS = [
    '.kpi', '.stat', '.kpi-card', '.stat-card', '.kcard',
    '.kpi-pill', '.kpi-group', '.kpi-dashboard > div',
    '.card', '.glass-card', '.card-lift',
    '.panel', '.best-card', '.compat-card', '.target-card',
    '.upload-card', '.upload-opt', '.pm-card', '.chartcard',
    '.coll-panel', '.user-card', '.slot', '.hero'
  ].join(', ');

  var activeElements = [];

  /* ── Tilt state ── */
  var tiltElements = [];
  var tiltTicking = false;
  var tiltMouseX = 0;
  var tiltMouseY = 0;
  var TILT_MAX = 6; // degrees

  function updateActiveList() {
    activeElements = Array.prototype.slice.call(document.querySelectorAll('.has-glow-fx'));
  }

  function initGlow(el) {
    if (el.dataset.glowReady) return;
    el.dataset.glowReady = 'true';

    // Ensure element has stacking context if static
    var comp = window.getComputedStyle(el);
    if (comp.position === 'static') {
      el.style.position = 'relative';
    }

    // Sync border-radius so edge overlays never look blocky/square on rounded cards
    var br = comp.borderRadius;
    if (br && br !== '0px') {
      el.style.setProperty('--glow-radius', br);
    } else if (el.tagName.toLowerCase() === 'tr') {
      el.style.setProperty('--glow-radius', '6px');
    }

    el.classList.add('has-glow-fx');

    // Create isolated overlay elements
    var edge = document.createElement('span');
    edge.className = 'glow-edge';
    edge.setAttribute('aria-hidden', 'true');

    var sheen = document.createElement('span');
    sheen.className = 'glow-sheen';
    sheen.setAttribute('aria-hidden', 'true');

    el.appendChild(sheen);
    el.appendChild(edge);

    // Ripple click interaction
    el.addEventListener('pointerdown', function(e) {
      // Don't intercept clicks on inputs, toggles or select boxes
      var targetTag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
      if (targetTag === 'input' || targetTag === 'select' || targetTag === 'textarea') return;

      var rect = el.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      var size = Math.max(rect.width, rect.height) * 1.6;

      var ripple = document.createElement('span');
      ripple.className = 'glow-ripple';
      ripple.style.width = size + 'px';
      ripple.style.height = size + 'px';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';

      el.appendChild(ripple);
      ripple.addEventListener('animationend', function() {
        ripple.remove();
      });
    });
  }

  function initTilt(el) {
    if (el.dataset.tiltReady) return;
    el.dataset.tiltReady = 'true';
    tiltElements.push(el);
  }

  function updateTilt() {
    if (tiltTicking) return;
    tiltTicking = true;

    window.requestAnimationFrame(function() {
      var mx = tiltMouseX;
      var my = tiltMouseY;
      var len = tiltElements.length;

      for (var i = 0; i < len; i++) {
        var el = tiltElements[i];
        var rect = el.getBoundingClientRect();

        if (mx >= rect.left && mx <= rect.right &&
            my >= rect.top && my <= rect.bottom) {
          var x = mx - rect.left;
          var y = my - rect.top;
          var cx = rect.width / 2;
          var cy = rect.height / 2;

          var rotateX = ((cy - y) / cy) * TILT_MAX;
          var rotateY = ((x - cx) / cx) * TILT_MAX;

          rotateX = Math.max(-TILT_MAX, Math.min(TILT_MAX, rotateX));
          rotateY = Math.max(-TILT_MAX, Math.min(TILT_MAX, rotateY));

          el.style.setProperty('--tilt-x', rotateX.toFixed(2) + 'deg');
          el.style.setProperty('--tilt-y', rotateY.toFixed(2) + 'deg');
        } else {
          el.style.setProperty('--tilt-x', '0deg');
          el.style.setProperty('--tilt-y', '0deg');
        }
      }
      tiltTicking = false;
    });
  }

  // Global mouse tracker with edge detection and proximity falloff
  var ticking = false;
  window.addEventListener('pointermove', function(e) {
    if (ticking) return;
    ticking = true;

    window.requestAnimationFrame(function() {
      var mouseX = e.clientX;
      var mouseY = e.clientY;
      var len = activeElements.length;

      for (var i = 0; i < len; i++) {
        var el = activeElements[i];
        var rect = el.getBoundingClientRect();

        // Edge detection threshold (pixels from perimeter)
        var prox = 45;
        if (
          mouseX >= rect.left - prox &&
          mouseX <= rect.right + prox &&
          mouseY >= rect.top - prox &&
          mouseY <= rect.bottom + prox
        ) {
          var relX = mouseX - rect.left;
          var relY = mouseY - rect.top;
          el.style.setProperty('--glow-x', relX + 'px');
          el.style.setProperty('--glow-y', relY + 'px');

          var isInside = (
            mouseX >= rect.left &&
            mouseX <= rect.right &&
            mouseY >= rect.top &&
            mouseY <= rect.bottom
          );

          if (isInside) {
            el.style.setProperty('--glow-edge-opacity', '1');
            el.style.setProperty('--glow-sheen-opacity', '1');
          } else {
            // Distance-based edge falloff: illuminates nearest boundary
            var dx = Math.max(rect.left - mouseX, 0, mouseX - rect.right);
            var dy = Math.max(rect.top - mouseY, 0, mouseY - rect.bottom);
            var dist = Math.sqrt(dx * dx + dy * dy);
            var edgeAlpha = Math.max(0, 1 - (dist / prox));
            el.style.setProperty('--glow-edge-opacity', (edgeAlpha * 0.75).toFixed(2));
            el.style.setProperty('--glow-sheen-opacity', '0');
          }
        } else {
          // If not near the element, turn off glow
          if (el.style.getPropertyValue('--glow-edge-opacity') !== '0') {
            el.style.setProperty('--glow-edge-opacity', '0');
            el.style.setProperty('--glow-sheen-opacity', '0');
          }
        }
      }
      ticking = false;
    });
  }, { passive: true });

  // Separate pointermove listener for tilt (shares the same event, lighter weight)
  window.addEventListener('pointermove', function(e) {
    tiltMouseX = e.clientX;
    tiltMouseY = e.clientY;
    updateTilt();
  }, { passive: true });

  function scan(root) {
    var targets = (root || document).querySelectorAll(SELECTORS);
    for (var i = 0; i < targets.length; i++) {
      initGlow(targets[i]);
    }
    updateActiveList();

    var tiltTargets = (root || document).querySelectorAll(TILT_SELECTORS);
    for (var i = 0; i < tiltTargets.length; i++) {
      initTilt(tiltTargets[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { scan(); });
  } else {
    scan();
  }

  if (window.MutationObserver) {
    var observer = new MutationObserver(function(mutations) {
      var needsRescan = false;
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length > 0) {
          needsRescan = true;
          break;
        }
      }
      if (needsRescan) {
        scan(document);
      }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
})();
