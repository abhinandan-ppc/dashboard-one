/* Pointer tilt only. Header chrome, touch, dragging and reduced motion stay still. */
(function () {
  'use strict';
  const enabled = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
  const targets = '.kpi,.stat,.kpi-card,.stat-card,.kcard,.card-lift,a.card';
  const excluded = '.app-header,.app-header-shell,.top-bar,.top-wrapper,.header-fixed,.header-enter,[data-motion="static"],.dragging';
  let active = null;
  let frame = 0;
  let point = null;
  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (active) {
      active.style.removeProperty('--tilt-x');
      active.style.removeProperty('--tilt-y');
      active.removeAttribute('data-card-tilt');
      active = null;
    }
  }
  document.addEventListener('pointermove', function (event) {
    if (!enabled.matches || event.pointerType !== 'mouse' || event.buttons) return reset();
    const card = event.target.closest?.(targets);
    if (!card || card.closest(excluded) || card.style.transform) return reset();
    if (active !== card) {
      reset();
      active = card;
      card.setAttribute('data-card-tilt', '');
    }
    point = { x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = 0;
      if (!active?.isConnected) return reset();
      const rect = active.getBoundingClientRect();
      if (!rect.width || !rect.height) return reset();
      const clamp = value => Math.max(-6, Math.min(6, value));
      active.style.setProperty('--tilt-x', clamp((.5 - (point.y - rect.top) / rect.height) * 12).toFixed(2) + 'deg');
      active.style.setProperty('--tilt-y', clamp(((point.x - rect.left) / rect.width - .5) * 12).toFixed(2) + 'deg');
    });
  }, { passive: true });
  document.addEventListener('pointerout', event => { if (active && (!event.relatedTarget || !active.contains(event.relatedTarget))) reset(); }, { passive: true });
  document.addEventListener('pointerdown', reset, { passive: true });
  document.addEventListener('pointercancel', reset, { passive: true });
  document.addEventListener('dragstart', reset);
  document.addEventListener('scroll', event => {
    if (active && (event.target === document || event.target.contains?.(active))) reset();
  }, { passive: true, capture: true });
  document.addEventListener('visibilitychange', reset);
  window.addEventListener('blur', reset);
  enabled.addEventListener('change', reset);
})();
