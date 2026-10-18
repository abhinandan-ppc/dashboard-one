# Neomorphism / Soft-UI Design System (DESIGN_NEOMORPH.md)

## Overview & Philosophy

A **Neomorphism (Soft-UI)** preset for the JSPL dashboard — every surface appears extruded from a single, continuous canvas colour, or pressed into it. Faithful to the soft-UI doctrine:

- **Single-hue canvas:** Cards, buttons, inputs, tables, and chrome all rest at the same monochromatic background colour (`--neo-bg`), so elevation is communicated *only* by two opposed shadows — never by a different fill colour.
- **Dual soft shadows:** Every raised element carries `box-shadow: Xpx Xpx Ypx var(--neo-shadow-dark), -Xpx -Xpx Ypx var(--neo-shadow-light)`. The dark shadow sits bottom-right, the light shadow top-left (light source convention). Pressed/active/inset states flip the pair to `inset`.
- **Continuous theme integration:** Like SAP Classic, the palette blends from the shared continuous sliders — `--theme-d` (0 = light … 100 = dark, exposed as `--td`) and the accent HSL triple (`--ah/--as/--al`). There is no per-accent hard-coding.
- **Generous radii:** Soft-UI demands rounded geometry — radius tokens are lifted (`--radius-md: 16px`, `--radius-lg: 20px`, `--radius-xl: 24px`, pills at `999px`).
- **Strict Non-Destructive Layout Rule:** Every element keeps its exact geometric footprint, padding, margin, and positioning across all styles and viewports — only visual treatment changes.

## Switching / Wiring (no code changes needed to use it)

- The hub's Theme panel has a third preset button: `#presetNeoBtn` with `data-style="neomorph"` (`index.html`).
- `setStyle()` in `index.html` and `jsplTheme.setStyle()` in `theme-boot.js` both accept `"neomorph"` alongside `"classic"`, writing `data-theme-style="neomorph"` on `<html>` and persisting to the `jspl-hub-theme-style` localStorage key.
- `syncStyleControls()` toggles the `.active` class on the three preset buttons; the cross-tab `storage` listener and `pushThemeToPages()` propagate the style to iframes.
- CSS selectors target `html[data-theme-style="neomorph"]` — orthogonal to `data-theme` (light/dark), so the darkness slider and accent picker keep working inside the preset.

## Token Layer (`theme.css`, NEOMORPHISM section)

```css
html[data-theme-style="neomorph"] {
  /* Canvas — blends the neutral grey with the accent at both ends */
  --neo-bg: color-mix(in srgb,
      color-mix(in srgb, #e8eaed 92%, hsl(var(--ah) var(--as) 90%)),
      color-mix(in srgb, #1e2228 90%, hsl(var(--ah) var(--as) 10%)) var(--td));

  /* Opposed soft shadows — the whole depth language */
  --neo-shadow-light: color-mix(in srgb, rgba(255,255,255,0.72), rgba(255,255,255,0.06) var(--td));
  --neo-shadow-dark:  color-mix(in srgb, rgba(36,46,61,0.22),   rgba(0,0,0,0.55)     var(--td));
  --shadow-sm/md/lg/xl: dual light+dark pairs;
  --shadow-inset: inset pair for pressed wells;

  /* Text ramp, status colours, radius, accent-derived --primary* */
}
```

Status colours keep the project's SAP-derived baseline, retinted for the ramp: `--success #107e3e→#22c55e`, `--warning #c27800→#f59e0b`, `--danger #bb0000→#ef4444`, with `--green/--rose/--amber` aliases for the KPI colour contract.

## Component Layers (numbered sections, matching SAP Classic parity)

| # | Section | Treatment |
|---|---------|-----------|
| — | Body / Canvas | `background-color: var(--neo-bg)` + soft dual radial sheens — canvas and cards are the *same* colour by construction |
| — | Header | Topmost plane: deep opposed shadows + `inset 0 1px 0` light-source highlight, `--header-border-color` edge, brand lockup (`l1` at `--text-hi`/900, eyebrow/l2 at `--mute`), extruded toolbar buttons (token borders, press-in hover/active), accent active `.view-tabs` |
| 1 | Surfaces (cards/panels/KPI/modals/drawers) | Raised dual shadows; hover lifts `-2px` with deeper shadow; `:active` flips inset |
| 2 | Buttons | Raised; hover brightens to `--primary`; active/`.on/.active` = inset pressed |
| — | Primary buttons | Accent gradient (`--ah/--as/--al`), white text, specular inset highlight |
| 3 | KPI values | **Unified colour contract:** neutral `--text-hi` for values, `--mute` for labels, `--danger` red for warning intent, `--success` green for profit intent |
| 4 | Badges & chips | Soft raised pills (999px), status text colours for success/warning/danger |
| 5 | Inputs | **Concave wells** — inset dual shadows; focus adds accent ring |
| 6 | Tables | Raised frame, flat rows, inset header band, accent-wash hover, inset selected row |
| 7 | Tabs & segmented | Inset track, raised active button in `--primary` |
| 8 | Alerts | Soft raised status boxes with semantic text colours |
| 9 | Progress | Inset track, accent gradient fill |
| 10 | Focus-visible | Dual inset shadow + double accent ring (accessibility preserved) |
| 11 | Disabled | Desaturated, inset, `pointer-events: none` |
| 12 | Reduced-transparency fallback | `data-reduce-transparency="1"` drops backdrop blur to a solid `--neo-bg` |
| 13 | Glow integration | Cursor-follow edge glow softened (0.7× opacity, drop-shadow) — no boxy mask |
| 14 | Hover transitions | Optimised to `box-shadow/transform/background/color` only — no layout thrash |
| 15 | Theme-picker controls | Rounded preset grid/sliders/chips inside the panel |

## Refinements (colour & header pass)

A defect/parity pass aligned the theme with its own doctrine and the typeui.sh `neumorphism` skill guidance (installed at `.claude/skills/design-system/SKILL.md`):

- **Canvas = cards, always.** The body no longer hard-codes `#e8eaed`/`#1e2228`; it paints `var(--neo-bg)` (accent-tinted, slider-blended) with two soft radial sheens whose own colours ramp via `--td`. Extrusion reads purely from shadow.
- **No fixed greys.** `--bdr`, `--glass-border`, `--glass-hi`, `--header-border-color`, `--input-hover`, and the header-button fills were hard-coded light values that glaringly broke in dark mode — all now `color-mix(... var(--td))` ramps.
- **Contrast fixes (WCAG AA on the `#e8eaed` canvas):** `--dim` `#68788b→#55677a`, `--mute` `#5d707f→#4d5d6e`, `--secondary` `#6c7580→#545f6c`. `--on-primary` rewritten to the base token shape (white → near-black), fixing a malformed double-percentage mix that produced mid-grey button text.
- **Header as the top plane.** Deepest dual shadow (6px/14px), inset top-edge highlight (light source), token border, brand lockup hierarchy (`jspl-brand-l1`/`brand-name` at `--text-hi` weight 900), full classic-parity button selectors (`.theme-menu`, `.dropdown-wrapper`, `.app-header-actions`), and an inset-accent active state for `.view-tabs`.
- **KPI intent stripe parity:** warning-intent cards get `border-top-color: var(--danger)`, profit `var(--success)` — width stays 1px (zero geometry change).
- **Theme-picker sliders:** track presses in (inset pair), thumb is a raised circular nub (`50%`, dual shadow, `grab/grabbing` cursor) — previously a `12px` radius was being forced onto the 16px round thumbs.
- **Housekeeping:** Classic sections 16–17 (KPI unification, hover transitions) moved out of the neomorph region back to the end of the Classic block.

## Accessibility & Performance Notes

- Focus-visible rings use the accent at 45%/15% alpha over the inset shadow — meets WCAG contrast on both ramps.
- KPI text honours the project-wide colour rule (neutral values, red warnings, green profit) so the semantic contract from `45577d7` carries over unchanged.
- Transitions are limited to paint-only properties (`box-shadow`, `transform`, `background`, `color`), keeping hover at ≤0.2s.
- The style switch is one attribute write (`data-theme-style`) — no reflow of layout, no JS re-render.

## Validation

```
node --test test/responsive-contract.test.mjs   # 64/64 pass
node check-html.mjs                            # structure OK
node check-js.mjs                              # js structure OK
```
