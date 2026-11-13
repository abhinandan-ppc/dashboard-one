# Neomorph theme

Read DESIGN-CONTEXT.md first. Neomorph uses restrained depth to distinguish surfaces and controls while keeping operational data easy to scan.

## Foundations

Use the shared --neo-bg canvas and opposed --neo-shadow-light / --neo-shadow-dark shadows. Keep lighting consistent: highlight top-left, shadow bottom-right. Retain continuous light/dark and accent controls.

Use IBM Plex Sans for body and headings, and JetBrains Mono for technical figures through shared font tokens. Reserve monospace for data, not every label. Keep normal numeral tracking.

## Components

- Cards: one shallow raised surface; avoid nested elevation on every child.
- Inputs: inset wells with visible keyboard focus.
- Buttons: subtle raised state and pressed feedback; no cursor glow or decorative bloom.
- Tables: one outer data well, flat rows, clear separators and a readable header band.
- Status markers: quiet canvas fill, explicit text and small semantic indicators. Information-only markers are not raised buttons.
- Menus: opaque light/dark surfaces, with readable control boundaries over the yard.
- Rake action group: one outer pill shadow; flat segments and dividers.
- Order details: no independent elevation, outline or rounded pill. The parent owns the outer corners.

## Motion and accessibility

Use short state transitions rather than card lift or tilt. Keep data flow diagrams still by default. Loading indicators may communicate active work. Preserve reduced-motion handling and edge overscroll.

Keep text contrast independent of shadow contrast. Verify light/dark, keyboard focus, mobile wrapping, long labels, theme switching and dense data before claiming completion.
