/* Promote the existing vanilla menus to the top layer without moving their
   DOM nodes or replacing their selection handlers. Nested glass otherwise
   clips the backdrop to a header/card instead of sampling the page. */
(() => {
  if (!HTMLElement.prototype.showPopover) return;
  const menus = [];
  let pending = 0;

  function attach(panel, anchor, state, openClass, width) {
    if (!panel || !anchor || !state) return;
    panel.setAttribute('popover', 'manual');
    panel.dataset.floatingMenu = '';
    if (!panel.id) panel.id = `floating-menu-${menus.length}`;
    anchor.setAttribute('aria-controls', panel.id);
    const entry = { panel, anchor, state, openClass, width };
    menus.push(entry);
    const sync = () => {
      const open = state.classList.contains(openClass);
      anchor.setAttribute('aria-expanded', String(open));
      if (open) {
        if (!panel.matches(':popover-open')) panel.showPopover();
        place(entry);
      } else if (panel.matches(':popover-open')) panel.hidePopover();
    };
    new MutationObserver(sync).observe(state, { attributes: true, attributeFilter: ['class'] });
    sync();
  }

  function place({ panel, anchor, width, state, openClass }) {
    const rect = anchor.getBoundingClientRect();
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft || 0;
    const topEdge = viewport?.offsetTop || 0;
    const rightEdge = leftEdge + (viewport?.width || innerWidth);
    const bottomEdge = topEdge + (viewport?.height || innerHeight);
    if (rect.bottom < topEdge || rect.top > bottomEdge || rect.right < leftEdge || rect.left > rightEdge) {
      state.classList.remove(openClass);
      return;
    }
    const w = Math.min(width || Math.max(220, rect.width), rightEdge - leftEdge - 24);
    const below = bottomEdge - rect.bottom - 20;
    const above = rect.top - topEdge - 20;
    const upward = below < 180 && above > below;
    panel.style.width = `${w}px`;
    panel.style.maxHeight = `${Math.max(80, upward ? above : below)}px`;
    panel.style.left = `${Math.max(leftEdge + 12, Math.min(rect.right - w, rightEdge - w - 12))}px`;
    panel.style.top = `${Math.max(topEdge + 12, upward ? rect.top - panel.getBoundingClientRect().height - 8 : rect.bottom + 8)}px`;
  }

  for (const [panel, button, width] of [
    ['analysis-dropdown', 'btn-analysis', 750],
    ['upload-dropdown', 'btn-upload-dd', 310],
    ['ctrl-dropdown', 'btn-ctrl', 380],
  ]) {
    const el = document.getElementById(panel);
    attach(el, document.getElementById(button), el, 'show', width);
  }
  document.querySelectorAll('.dd').forEach(root => {
    attach(root.querySelector('.dd-menu'), root.querySelector('.dd-btn'), root, 'open');
  });
  document.querySelectorAll('.suggestions').forEach(panel => {
    attach(panel, panel.parentElement.querySelector('input'), panel, 'open');
  });
  function reposition() {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      menus.filter(({ panel }) => panel.matches(':popover-open')).forEach(place);
    });
  }
  addEventListener('resize', reposition);
  addEventListener('scroll', reposition, true);
  visualViewport?.addEventListener('resize', reposition);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const entry = menus.findLast(({ panel }) => panel.matches(':popover-open'));
    if (!entry) return;
    entry.state.classList.remove(entry.openClass);
    entry.anchor.focus();
    event.preventDefault();
  });
})();
