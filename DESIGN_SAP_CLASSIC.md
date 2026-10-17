# SAP Classic + Frosted Glass Design System (DESIGN_SAP_CLASSIC.md)

## Overview & Philosophy

A high-performance enterprise interface marrying the time-tested structure and ergonomics of **SAP GUI Classic / Signature (CorBu)** with the luminous depth and modern sophistication of **Frosted Glass (Glassmorphism)**.

- **Enterprise Heritage & Boxy Architecture:** Faithful to SAP GUI Signature/CorBu visual hallmarks: sharp **0px boxy corners** across all panels, tables, cards, inputs, and buttons; signature slate-blue gradient titlebars; authentic ALV data grid structures with 1px cell gridlines; key-column ice-blue tints; and the iconic warm amber-gold (`#f5cb74`) row selection.
- **Dynamic Accent Integration:** While maintaining the classic SAP corporate baseline, the theme responds in real time to the user's chosen Accent Hue (`--ah`), Saturation (`--as`), Lightness (`--al`), and RGB triple (`--primary-rgb`) for interactive focus states, primary actions, and cursor-follow edge glow.
- **Glassmorphic Depth:** Translucent ice-glass surfaces (`rgba(240, 246, 252, 0.82)`), multi-stage specular inner highlights (`inset 0 1px 0 rgba(255,255,255,0.95)`), and smooth backdrop blur (`blur(14px) saturate(135%)`) that feel airy, tactile, and modern without sacrificing industrial clarity.
- **Strict Non-Destructive Layout Rule:** Every element maintains its exact geometric footprint, padding, margin, and positioning across desktop, tablet, and mobile views.

---

## Color Palette & Design Tokens

### Core Colors
```css
/* Canvas & Atmosphere */
--sap-bg: #d9e5f2;
--sap-bg-gradient: linear-gradient(180deg, #d1e0f0 0%, #e3edf7 35%, #edf3f9 100%);

/* Header / Title Bar (Iconic SAP Slate Gradient with Dynamic Accent Tone) */
--sap-header-bg: linear-gradient(180deg,
  color-mix(in srgb, rgba(162, 190, 220, 0.94) 84%, hsl(var(--ah) var(--as) 70%)) 0%,
  color-mix(in srgb, rgba(198, 218, 238, 0.88) 84%, hsl(var(--ah) var(--as) 85%)) 48%,
  color-mix(in srgb, rgba(179, 204, 230, 0.92) 84%, hsl(var(--ah) var(--as) 75%)) 100%
);
--sap-header-border: 1px solid color-mix(in srgb, rgba(125, 156, 188, 0.75) 75%, hsl(var(--ah) var(--as) 50%));
--sap-header-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 rgba(115, 148, 182, 0.45), 0 3px 12px rgba(20, 50, 80, 0.12);

/* Surfaces & Frosted Glass */
--sap-glass-card: rgba(248, 251, 254, 0.88);
--sap-glass-panel: rgba(240, 246, 252, 0.82);
--sap-glass-hi: rgba(224, 236, 248, 0.95);
--sap-glass-border: 1px solid rgba(140, 168, 196, 0.50);
--sap-glass-border-hi: 1px solid rgba(95, 136, 175, 0.75);
--sap-glass-blur: blur(14px) saturate(135%);

/* Typography (High contrast enterprise navy & slate) */
--sap-text: #132a42;
--sap-text-hi: #0b1a2a;
--sap-text-dim: #3f5a77;
--sap-text-mute: #627d98;

/* Dynamic Brand Accents */
--primary: hsl(var(--ah) var(--as) calc(var(--al) * 0.88));
--primary-hover: hsl(var(--ah) var(--as) calc(var(--al) * 0.76));
--primary-active: hsl(var(--ah) var(--as) calc(var(--al) * 0.64));
--on-primary: #ffffff;
--primary-bg: hsl(var(--ah) var(--as) var(--al) / 0.12);

/* Iconic SAP Gold / Amber Row Selection */
--sap-selection-bg: linear-gradient(180deg, #f5cb74 0%, #ebd08f 100%);
--sap-selection-border: #d4a342;
--sap-selection-text: #151515;

/* Status Colors */
--sap-success: #107e3e;          /* SAP Green */
--sap-success-bg: rgba(16, 126, 62, 0.12);
--sap-warning: #c27800;          /* SAP Amber */
--sap-warning-bg: rgba(194, 120, 0, 0.12);
--sap-danger: #bb0000;           /* SAP Alert Red */
--sap-danger-bg: rgba(187, 0, 0, 0.12);

/* Table & ALV Grid */
--sap-th-bg: linear-gradient(180deg, #e4eff8 0%, #cce0f2 100%);
--sap-th-text: #0f2c4a;
--sap-th-border: #94b2cd;
--sap-key-col-bg: rgba(204, 226, 246, 0.92);
--sap-row-alt: rgba(244, 249, 254, 0.85);
--sap-row-hover: color-mix(in srgb, rgba(208, 230, 252, 0.88) 82%, var(--primary-bg));

/* Inputs & Form Controls */
--sap-input-bg: rgba(255, 255, 255, 0.94);
--sap-input-border: #8ca8c4;
--sap-input-focus-bg: #fffde4;    /* Iconic SAP Active Input Yellow */
--sap-input-focus-border: var(--primary);

/* Corner Geometry (Boxy) */
--component-radius: 0px !important;
--radius-pill: 0px !important;
```

---

## Component Guidelines

### 1. Title Bar & Navigation (`.app-header`, `.top-bar`)
- Sharp, boxy 0px rectangular bar across the top.
- Translucent signature slate-blue gradient retinted subtly with the user's accent color.
- Dual-bevel specular highlight: `inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 rgba(115, 148, 182, 0.45)`.
- Boxy rectangular SAP toolbar buttons (`border-radius: 0 !important`) with 1px border and hover glow.

### 2. Cards & KPI Tiles (`.card`, `.kpi`, `.stat`, `.kcard`, `.kpi-card`)
- 0px squared corners with distinct bevelled perimeter: `1px solid rgba(135, 168, 198, 0.65)`.
- Top 3px accent indicator bar (`border-top: 3px solid var(--primary)!important;`).
- Bold, tabular numerals in deep SAP navy (`#0c233c`) using monospace formatting.
- Tracked uppercase slate labels (`#3e5d7c`).

### 3. ALV Grids & Tables (`table`, `.data-table-wrap`)
- Completely square (0px border-radius everywhere, no rounded table wrapper corners).
- Headers: Soft steel gradient `#e4eff8` to `#cce0f2` with crisp 1px vertical borders and top shine.
- Alternating zebra rows in subtle ice-white and cool mist.
- Key column (first column) styled with ice-blue `#cce2f3` indicator background and bold dark text.
- Row hover: Soft frosted blue highlight dynamically blended with the user's accent.
- Selected row: Iconic SAP Amber Gold `#f5cb74` with dark `#151515` text and crisp 1px borders.

### 4. Inputs & Controls (`input`, `select`, `textarea`)
- Boxy 0px rectangular inputs with crisp `#8ca8c4` hairline.
- On focus: warm SAP pastel yellow `#fffde4` with a crisp dynamic accent focus ring (`0 0 0 2px rgba(var(--primary-rgb), 0.35)`).

### 5. Seamless Cursor Glow (`glow.js`)
- Harmonized edge glow responding to `--primary-rgb` with boxy 0px contours (`--glow-radius: 0px !important;`).
- Table rows display the iconic SAP gold row highlight on cursor interaction.

### 6. Status Badges & Chips (`.sap-badge`, `.status-chip`, `.kpi-status`)
- Boxy 0px rectangular pills with 1px crisp border.
- **Success** (`good`/`ok`): Green background (`--success-bg`) with SAP green text.
- **Warning** (`warn`): Amber background (`--warning-bg`) with SAP amber text.
- **Danger** (`bad`/`err`): Red background (`--danger-bg`) with SAP red text.
- All variants respond to light/dark theme modes with appropriate contrast.

### 7. Alert Boxes (`.alert-box`, `.alert`)
- Boxy 0px rectangular alert containers with crisp 1px border.
- **Success**: Green-tinted background with dark green text.
- **Warning**: Amber-tinted background with dark amber text.
- **Error/Danger**: Red-tinted background with dark red text.
- Flex layout with icon/gap support for status messaging.

### 8. Progress Bar (`.sap-progress`, `.progress-bar`)
- Boxy 0px rectangular progress track with 10px height.
- Animated fill bar using dynamic accent gradient with outer glow.
- Responsive width transitions (0.3s ease).

### 9. Tabs & Segmented Controls (`.tab-bar button`, `.tabs button`, `.segmented-control button`)
- Boxy 0px rectangular tabs with transparent background and 2px bottom indicator.
- Inactive state: muted text color, no bottom border.
- Active state: accent-colored bottom border, accent-tinted background, inset accent shine.
- Hover state: subtle surface lift with text brightening.

### 10. Focus Visible (Accessibility)
- All interactive elements (`button`, `input`, `select`, `textarea`, `a`) show a crisp 2px accent focus ring with soft outer halo when keyboard-focused via `:focus-visible`.
- Never relies on colour alone for focus indication.

### 11. Disabled States
- All disabled controls (`button:disabled`, `input:disabled`, `select:disabled`, `textarea:disabled`) show reduced opacity (0.55), grayscale filter (0.4), `not-allowed` cursor, and `pointer-events: none`.

### 12. Reduced Transparency Fallback (`data-reduce-transparency="1"`)
- When reduced transparency is preferred (OS signal or user toggle), all glass surfaces in Classic mode fall back to solid opaque backgrounds with no `backdrop-filter`, preserving readability on low-end devices while maintaining the SAP aesthetic.

### 13. KPI Card Color Unification (`.kpi`, `.kcard`, `.kpi-card`, `.stat-card`)
- Colours are deliberately minimal per the design system:
  - **Red** (`--danger`) only for warnings (`.intent-warning`, `[data-intent="warning"]`, `.warning`).
  - **Green** (`--success`) only for profit (`.intent-profit`, `[data-intent="profit"]`, `.profit`).
  - Single neutral colour (`--tx` values / `--mute` labels) for everything else — no per-card accent variation.
- In Classic mode, warning KPI cards get a red border-top and red value text; profit KPI cards get a green border-top and green value text.
- All KPI cards share optimized hover transitions (border-color, box-shadow, background, transform).
