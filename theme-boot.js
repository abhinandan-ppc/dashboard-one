/* ════════════════════════════════════════════════════════════════════════════
   THEME BOOT — shared by every page in the hub.
   Load with <script src="theme-boot.js"></script> in <head>, BEFORE the
   stylesheet's first paint, so the stored theme/accent are applied to
   <html data-theme data-accent> before anything renders. That ordering is the
   whole point: applying them later (on DOMContentLoaded, or from the hub after
   an iframe loads) shows a flash of the wrong theme.

   The hub (index.html) is the source of truth and owns writing the keys. This
   script only reads them and reacts to changes, so the hub and the pages can
   never disagree. Three channels, each covering what the others cannot:
     • localStorage read at boot  — survives reload + direct/standalone visits
     • postMessage               — live push from the hub into the iframe
     • storage event             — a change made in another tab/page
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var THEME_KEY = "jspl-hub-theme";
  var ACCENT_KEY = "jspl-hub-accent";
  var VALID_THEMES = ["light", "dark", "contrast"];
  var ACCENTS = ["blue", "green", "grey", "violet", "rose", "orange", "teal", "cyan", "amber", "indigo", "lime", "magenta"];
  // Rake Planner and Order Status Report kept their own preference keys before
  // the hub unified them. Reading them as a fallback means an existing user who
  // had already picked a theme on one of those pages keeps it instead of
  // silently snapping back to dark.
  var LEGACY_THEME_KEYS = ["jspl-theme", "jspl-osr-theme"];

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function storedTheme() {
    var t = read(THEME_KEY);
    if (VALID_THEMES.indexOf(t) !== -1) return t;
    for (var i = 0; i < LEGACY_THEME_KEYS.length; i++) {
      var legacy = read(LEGACY_THEME_KEYS[i]);
      if (VALID_THEMES.indexOf(legacy) !== -1) return legacy;
    }
    return null;
  }

  function storedAccent() {
    var a = read(ACCENT_KEY);
    return ACCENTS.indexOf(a) !== -1 ? a : null;
  }

  // Exposed so pages that already own a theme manager (Rake Planner's
  // dark/light/auto, Order Status Report's pref state) can fold the hub's value
  // into their own state instead of having their effect immediately overwrite
  // the attribute this script just set.
  window.__hub_apply_theme = null;

  function apply(theme, accent) {
    var el = document.documentElement;
    if (!el) return;
    if (VALID_THEMES.indexOf(theme) !== -1 && el.getAttribute("data-theme") !== theme) {
      // A page with its own manager opts in here, so its React state stays the
      // source of truth and doesn't re-render the old theme over the top.
      if (typeof window.__hub_apply_theme === "function") {
        try { window.__hub_apply_theme(theme); } catch (e) {}
      }
      el.setAttribute("data-theme", theme);
    }
    if (ACCENTS.indexOf(accent) !== -1 && el.getAttribute("data-accent") !== accent) {
      el.setAttribute("data-accent", accent);
    }
  }

  // 1. Apply the stored values immediately, before first paint.
  apply(storedTheme(), storedAccent());

  // 2. Live push from the hub while embedded.
  window.addEventListener("message", function (e) {
    var d = e && e.data;
    if (!d) return;
    if (d.type === "theme" && d.value) apply(d.value, null);
    else if (d.type === "accent" && d.value) apply(null, d.value);
  });

  // 3. A change made in another tab, or a logout that removed the key
  //    (e.newValue === null), which resets this page to the defaults.
  window.addEventListener("storage", function (e) {
    if (!e || !e.key) return;
    if (e.key === THEME_KEY) apply(e.newValue === null ? "dark" : e.newValue, null);
    else if (e.key === ACCENT_KEY) apply(null, e.newValue === null ? "blue" : e.newValue);
  });
})();
