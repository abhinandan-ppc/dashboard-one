/* ════════════════════════════════════════════════════════════════════════════
   THEME BOOT — shared by every page in the hub.
   Load with <script src="theme-boot.js"></script> in <head>, BEFORE the
   stylesheet's first paint, so the stored theme/accent are applied to
   <html data-theme data-accent> before anything renders. That ordering is the
   whole point: applying them later (on DOMContentLoaded, or from the hub after
   an iframe loads) shows a flash of the wrong theme.

   The hub is the source of truth and owns writing the keys. This script only
   reads them and reacts to changes, so the hub and the pages can never
   disagree. Three channels, each covering what the others cannot:
     • localStorage read at boot  — survives reload + direct/standalone visits
     • postMessage               — live push from the hub into the iframe
     • storage event             — a change made in another tab/page

   The theme is one continuous number, --theme-d (0 = light, 100 = dark), and
   the accent is a colour (--ah/--as/--al). theme.css blends every token from
   those, so applying the theme is just writing four custom properties. A
   derived data-theme="light"|"dark" is written alongside them, because the
   pages that own their own theme managers (Rake Planner, Order Status Report)
   and the pages that pick a hand-tuned canvas palette still branch on that
   attribute; the hub only ever sends those two values.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var THEME_KEY = "jspl-hub-theme";
  var ACCENT_KEY = "jspl-hub-accent";
  // Below this the derived data-theme is "light", at or above it "dark". It is
  // 41, not 50, because the surfaces ramp steeper than the slider (see
  // theme.css --tds): by 41 the background is already well past mid, so the
  // step to light text happens on a surface dark enough to carry it. Keep this
  // equal to the threshold scripts/theme-contrast-check.mjs reports.
  var DARK_THRESHOLD = 41;
  var DEFAULT_DARKNESS = 100;
  var DEFAULT_ACCENT = { h: 199, s: 90, l: 52 };
  // Older builds stored a theme NAME and a NAMED accent. Map both forward so an
  // existing device keeps its choice instead of silently reverting to defaults.
  var LEGACY_THEME_VALUES = { light: 0, dark: 100, contrast: 100, auto: null };
  var LEGACY_ACCENTS = {
    blue: [199, 90, 52], green: [152, 72, 40], grey: [215, 16, 50],
    violet: [258, 90, 55], rose: [343, 79, 51], orange: [24, 92, 45],
    teal: [174, 76, 40], cyan: [192, 89, 37], amber: [32, 94, 40],
    indigo: [239, 84, 59], lime: [84, 76, 44], magenta: [330, 80, 54]
  };
  // Rake Planner and Order Status Report kept their own preference keys before
  // the hub unified them. Reading them as a fallback means an existing user who
  // had already picked a theme on one of those pages keeps it instead of
  // silently snapping back to dark.
  var LEGACY_THEME_KEYS = ["jspl-theme", "jspl-osr-theme"];

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

  // Returns 0..100. Accepts a stored number, or a theme NAME written by an
  // older build, or one of the two legacy per-page keys.
  function storedDarkness() {
    var raw = read(THEME_KEY);
    if (raw === null) {
      for (var i = 0; i < LEGACY_THEME_KEYS.length; i++) {
        var legacy = read(LEGACY_THEME_KEYS[i]);
        if (legacy === "light" || legacy === "dark") return LEGACY_THEME_VALUES[legacy];
      }
      return DEFAULT_DARKNESS;
    }
    if (Object.prototype.hasOwnProperty.call(LEGACY_THEME_VALUES, raw)) {
      var mapped = LEGACY_THEME_VALUES[raw];
      return mapped === null ? DEFAULT_DARKNESS : mapped;
    }
    var n = parseFloat(raw);
    return isFinite(n) ? clamp(n, 0, 100) : DEFAULT_DARKNESS;
  }

  // Returns {h,s,l}. Accepts "h,s,l" or a named accent from an older build.
  function storedAccent() {
    var raw = read(ACCENT_KEY);
    if (!raw) return DEFAULT_ACCENT;
    if (LEGACY_ACCENTS[raw]) {
      var a = LEGACY_ACCENTS[raw];
      return { h: a[0], s: a[1], l: a[2] };
    }
    var parts = String(raw).split(",");
    if (parts.length !== 3) return DEFAULT_ACCENT;
    var h = parseFloat(parts[0]), s = parseFloat(parts[1]), l = parseFloat(parts[2]);
    if (!isFinite(h) || !isFinite(s) || !isFinite(l)) return DEFAULT_ACCENT;
    return { h: ((h % 360) + 360) % 360, s: clamp(s, 0, 100), l: clamp(l, 0, 100) };
  }

  // hsl() -> "R G B" for the rgba(var(--primary-rgb), ...) call sites. The
  // accent is lifted at the dark end and dropped at the light end, matching how
  // theme.css blends --primary, so the triple tracks the visible colour.
  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = (((h % 360) + 360) % 360) / 60;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    var m = l - c / 2;
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    ];
  }

  // Exposed so pages that already own a theme manager (Rake Planner's
  // dark/light/auto, Order Status Report's pref state) can fold the hub's value
  // into their own state instead of having their effect immediately overwrite
  // the attribute this script just set.
  window.__hub_apply_theme = null;

  // Writes the continuous values plus the derived attribute. Everything the
  // theme needs to paint comes from these five properties, so this is the one
  // function a page, the hub, or a live push all go through.
  function apply(darkness, accent) {
    var el = document.documentElement;
    if (!el) return;
    var d = clamp(Number(darkness), 0, 100);
    if (!isFinite(d)) d = DEFAULT_DARKNESS;
    var a = accent || DEFAULT_ACCENT;
    var st = el.style;
    st.setProperty("--theme-d", String(d));
    st.setProperty("--ah", String(a.h));
    st.setProperty("--as", a.s + "%");
    st.setProperty("--al", a.l + "%");
    var lit = a.l * (d < DARK_THRESHOLD ? 0.78 : 1.06);
    st.setProperty("--primary-rgb", hslToRgb(a.h, a.s, lit).join(","));
    var derived = d < DARK_THRESHOLD ? "light" : "dark";
    if (el.getAttribute("data-theme") !== derived) el.setAttribute("data-theme", derived);
    // A page with its own manager opts in here, so its React state stays the
    // source of truth and doesn't re-render the old theme over the top.
    if (typeof window.__hub_apply_theme === "function") {
      try { window.__hub_apply_theme(derived); } catch (e) {}
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  // Every page loads this script, so this is the one place the theme protocol
  // lives. Pages used to each keep their own copy of "apply the theme and
  // remember it" — and because the store is continuous (a NUMBER, not a name)
  // every one of those copies silently broke: each read the stored value,
  // failed to match it against 'light'/'dark', fell back to dark, and wrote
  // 'dark' back over the slider. A page opened standalone then showed a theme
  // nobody had chosen. Routing them all through here is what keeps the pages
  // in sync, and it is the reason a page never has to know the storage format.
  window.jsplTheme = {
    // 0..100. Reads the stored value, mapping a legacy name forward.
    read: function () { return storedDarkness(); },
    readAccent: function () { return storedAccent(); },
    // Accepts a number, a legacy name, or the derived 'light'/'dark'. Always
    // returns a number, so no caller can end up holding an unrecognised value.
    normalize: function (v) {
      if (v === null || v === undefined) return storedDarkness();
      if (typeof v === 'number') return clamp(v, 0, 100);
      var s = String(v).trim().toLowerCase();
      if (s === 'light') return 0;
      if (s === 'dark') return 100;
      if (Object.prototype.hasOwnProperty.call(LEGACY_THEME_VALUES, s)) return LEGACY_THEME_VALUES[s];
      var n = parseFloat(s);
      return isFinite(n) ? clamp(n, 0, 100) : storedDarkness();
    },
    // The reduced value the pages' own light/dark logic branches on.
    derived: function (v) { return this.normalize(v) < DARK_THRESHOLD ? "light" : "dark"; },
    // Paint without persisting — for a live push from the hub, where the hub
    // has already written the value every other page reads.
    apply: function (darkness, accent) { apply(this.normalize(darkness), accent || storedAccent()); },
    // Paint AND persist. This is what a page's OWN toggle must call: the
    // number it writes is what every other page and the next load will read.
    set: function (darkness, accent) {
      var d = this.normalize(darkness);
      var a = accent || storedAccent();
      apply(d, a);
      try { localStorage.setItem(THEME_KEY, String(d)); } catch (e) {}
      if (accent) { try { localStorage.setItem(ACCENT_KEY, a.h + "," + a.s + "," + a.l); } catch (e) {} }
    },
    DARK_THRESHOLD: DARK_THRESHOLD,
    DEFAULT_DARKNESS: DEFAULT_DARKNESS,
    DEFAULT_ACCENT: DEFAULT_ACCENT
  };

  // ── Reduced-transparency escape hatch ───────────────────────────────────
  // Backdrop blur is the most expensive effect in the shared surface contract
  // and is what makes low-end devices stutter. Respect the OS-level signal, and
  // let a visitor override it either way, mirroring the choice onto <html> where
  // theme.css keys its solid-surface fallbacks. Read BEFORE first paint so the
  // correct surfaces are in place from the start.
  var REDUCE_KEY = "jspl-reduce-transparency";
  function applyTransparencyPreference() {
    var stored = null;
    try { stored = read(REDUCE_KEY); } catch (e) {}
    var wanted = stored === null
      ? !!(window.matchMedia && window.matchMedia("(prefers-reduced-transparency: reduce)").matches)
      : stored === "1";
    document.documentElement.setAttribute("data-reduce-transparency", wanted ? "1" : "0");
    return wanted;
  }
  applyTransparencyPreference();
  if (window.matchMedia) {
    try {
      var mqBlur = window.matchMedia("(prefers-reduced-transparency: reduce)");
      // Only follow the OS while the visitor has not made an explicit choice.
      if (mqBlur.addEventListener) {
        mqBlur.addEventListener("change", function () {
          try { if (read(REDUCE_KEY) === null) applyTransparencyPreference(); } catch (e) {}
        });
      }
    } catch (e) {}
  }

  window.jsplTransparency = {
    // Returns the active state and persists an explicit override.
    set: function (on) { try { localStorage.setItem(REDUCE_KEY, on ? "1" : "0"); } catch (e) {} return applyTransparencyPreference(); },
    get: function () { return document.documentElement.getAttribute("data-reduce-transparency") === "1"; },
  };

  // 1. Apply the stored values immediately, before first paint.
  apply(storedDarkness(), storedAccent());

  // 2. Live push from the hub while embedded. The continuous payload is
  //    `theme-vars`; the older named `theme`/`accent` messages are still
  //    honoured so a page holding an older copy of this script keeps up.
  window.addEventListener("message", function (e) {
    var d = e && e.data;
    if (!d) return;
    if (d.type === "theme-vars" && typeof d.darkness === "number") {
      apply(d.darkness, d.accent || storedAccent());
      return;
    }
    if (d.type === "theme" && d.value) {
      var mapped = LEGACY_THEME_VALUES[d.value];
      apply(mapped === undefined || mapped === null ? DEFAULT_DARKNESS : mapped, storedAccent());
    }
  });

  // 3. A change made in another tab, or a logout that removed the keys
  //    (e.newValue === null), which resets this page to the defaults.
  window.addEventListener("storage", function (e) {
    if (!e || !e.key) return;
    if (e.key === THEME_KEY || e.key === ACCENT_KEY) {
      apply(storedDarkness(), storedAccent());
    }
  });
})();
