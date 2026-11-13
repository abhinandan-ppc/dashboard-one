# Classic theme

Read DESIGN-CONTEXT.md first. Classic is a restrained enterprise data interface, not a decorative simulation of legacy software.

## Foundations

Use IBM Plex Sans for body and headings and IBM Plex Mono for technical figures through shared tokens. Use normal tracking for numbers, clear label hierarchy and neutral text for ordinary values.

Keep square geometry, crisp one-pixel separators and the shared light/dark palette. Use a valid solid component surface from theme.css. Accent color identifies active controls and keyboard focus; semantic status colors identify operational conditions.

## Components

- Headers and tables: compact alignment, clear column labels, stable spacing.
- Cards: square edges with quiet borders; static cards do not lift or glow on hover.
- Buttons: concise text or monochrome SVG; explicit hover, pressed, focus and disabled states.
- Inputs: clear boundaries and a two-pixel focus outline.
- Menus: opaque theme-aware surfaces, readable over the yard and maps.
- KPI readouts: neutral figures; information-only header groups remain flat.
- Status markers: consistent size, square corners and explicit text. Use restrained tint only for meaningful status.
- Rake action group: the intentionally shared single-pill container is an exception to square geometry; its segments have no independent rounded border.
- Order details: flat integrated footer with one separator.

## Verification

Check both light and dark, mobile wrapping, keyboard focus, dense tables and long labels. Verify the continuous theme/accent controls. Preserve data logic and layout behavior across theme changes.
