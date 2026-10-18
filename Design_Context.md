# JSPL Dashboard One — Design Context

## Design System Overview

**Style:** Glassmorphism — frosted-glass surfaces, translucent layers, subtle blur, luminous borders.
Three switchable style presets: **Modern Glass** (default), **Classic SAP** (boxy enterprise), **Neomorphism** (soft extruded Soft-UI).  
**Single source of truth:** [`theme.css`](file:///d:/Projects/dashboard-one-1/theme.css) (linked by every page).  
**Typography:** Plus Jakarta Sans (open-license twin of Product Sans) + JetBrains Mono for data/numbers.  
**Accent:** Continuous HSL slider (`--ah`, `--as`, `--al`). The RGB triple is exposed as `--primary-rgb` for alpha compositing.

### Key Design Tokens

| Token | Purpose |
|---|---|
| `--primary-rgb` | Accent colour as raw `R G B` triple (e.g. `41,182,246`) for `rgba()` calls |
| `--glass` | Frosted glass surface background |
| `--glass-blur` | `blur(16px)` — backdrop-filter value |
| `--glass-border` | Luminous hairline border |
| `--shadow-lg` | Large elevation shadow |
| `--shadow-inset` | Inner highlight for glass depth |
| `--theme-d` | Dark/light ramp (0 = light, 100 = dark) |
| `--tdn` | `--theme-d / 100` — normalised for calculations |

---

## Subtle & Seamless Dynamic Edge Glow Architecture

### Key Improvements

1. **Subtle & Seamless Edge Feathering:**
   - Softened peak border intensity to a relaxed `rgba(var(--primary-rgb), 0.38)` with ultra-smooth 4-stage gradient stops (`0.38 -> 0.12 -> 0.02 -> transparent`).
   - Hairline `1px` padding with a feathered `drop-shadow(0 0 3px rgba(..., 0.18))` for an ambient border aura rather than harsh lines.

2. **Border-Radius Synchronization (`--glow-radius`):**
   - In [`glow.js`](file:///d:/Projects/dashboard-one-1/glow.js), each element queries its computed `border-radius` upon initialization and assigns it to `--glow-radius`.
   - Pill buttons (`999px`), curved cards (`16px`/`20px`), and KPI chips keep their exact curvature without boxy corners.

3. **Specialized Table Row Smoothing:**
   - Table rows (`table tbody tr`, `.data-table-wrap tbody tr`) bypass rectangular perimeter masking.
   - Table rows feature an ambient horizontal glow wash (`linear-gradient(90deg, ...)`) and subtle top/bottom seam highlights (`box-shadow: inset 0 -1px 0 ...`).

4. **KPI Cards in Rake Planner & Across Pages:**
   - Fully enabled on Rake Planner KPI cards (`<KCard>` with `.kcard.kpi-card`) and consistent across every page's KPI cards.
   - Colours are deliberately minimal: red only for warnings, green only for profit, and a single neutral colour (`--tx` values / `--mute` labels) for everything else — no per-card accent variation.
   - Active across all KPI strips, status tiles, cards, and header bars.

---

## Technical Reference

### CSS ([`theme.css`](file:///d:/Projects/dashboard-one-1/theme.css))

```css
.has-glow-fx {
  --glow-x: 50%;
  --glow-y: 50%;
  --glow-edge-opacity: 0;
  --glow-sheen-opacity: 0;
  --glow-radius: inherit;
}

/* 1. Dynamic Soft Border / Edge Glow with subtle seamless feathering */
.glow-edge {
  position: absolute;
  inset: -1px;
  border-radius: var(--glow-radius, inherit);
  padding: 1px;
  pointer-events: none;
  z-index: 2;
  opacity: var(--glow-edge-opacity, 0);
  transition: opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  background: radial-gradient(
    380px circle at var(--glow-x) var(--glow-y),
    rgba(var(--primary-rgb), 0.38) 0%,
    rgba(var(--primary-rgb), 0.12) 30%,
    rgba(var(--primary-rgb), 0.02) 55%,
    transparent 75%
  );
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  filter: drop-shadow(0 0 3px rgba(var(--primary-rgb), calc(var(--glow-edge-opacity, 0) * 0.18)));
}

/* 2. Soft Ambient Surface Spotlight */
.glow-sheen {
  position: absolute;
  inset: 0;
  border-radius: var(--glow-radius, inherit);
  pointer-events: none;
  z-index: 1;
  opacity: var(--glow-sheen-opacity, 0);
  transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  background: radial-gradient(
    420px circle at var(--glow-x) var(--glow-y),
    rgba(var(--primary-rgb), 0.05) 0%,
    rgba(var(--primary-rgb), 0.015) 45%,
    transparent 70%
  );
}

/* Table Row Smoothing */
tr.has-glow-fx .glow-edge,
.data-table-wrap tr .glow-edge {
  border-radius: 6px;
  -webkit-mask: none;
  mask: none;
  padding: 0;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(var(--primary-rgb), 0.03) 15%,
    rgba(var(--primary-rgb), 0.08) 50%,
    rgba(var(--primary-rgb), 0.03) 85%,
    transparent 100%
  );
  box-shadow: inset 0 -1px 0 rgba(var(--primary-rgb), calc(var(--glow-edge-opacity, 0) * 0.22)),
              inset 0 1px 0 rgba(var(--primary-rgb), calc(var(--glow-edge-opacity, 0) * 0.08));
  filter: none;
}
```

---

## Active Pages

Integrated across all dashboard pages:
- [`index.html`](file:///d:/Projects/dashboard-one-1/index.html)
- [`PM-Yard.html`](file:///d:/Projects/dashboard-one-1/PM-Yard.html)
- [`Rake-Planner.html`](file:///d:/Projects/dashboard-one-1/Rake-Planner.html)
- [`admin.html`](file:///d:/Projects/dashboard-one-1/admin.html)
- [`Grade-Clubbing-Matrix.html`](file:///d:/Projects/dashboard-one-1/Grade-Clubbing-Matrix.html)
- [`Order-Status-Report.html`](file:///d:/Projects/dashboard-one-1/Order-Status-Report.html)
- [`Plate-Tagging-Tool.html`](file:///d:/Projects/dashboard-one-1/Plate-Tagging-Tool.html)
- [`Plate-Tracker.html`](file:///d:/Projects/dashboard-one-1/Plate-Tracker.html)
- [`SMS Heat Planner Daily.html`](file:///d:/Projects/dashboard-one-1/SMS%20Heat%20Planner%20Daily.html)
- [`SMS Heat Planner Monthly.html`](file:///d:/Projects/dashboard-one-1/SMS%20Heat%20Planner%20Monthly.html)
- [`SMS-Heat-Planner.html`](file:///d:/Projects/dashboard-one-1/SMS-Heat-Planner.html)
- [`VDO-Generator.html`](file:///d:/Projects/dashboard-one-1/VDO-Generator.html)
