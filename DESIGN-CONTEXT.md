# Dashboard design context

Read this before changing dashboard presentation. Use DESIGN_SAP_CLASSIC.md for Classic and DESIGN_NEOMORPH.md for Neomorph; this document governs all three themes.

## Direction

Build an operational interface for planners, not a product landing page. Put data, filters and actions first. Preserve calculations, permissions, exports, refresh dependencies and navigation.

## Shared rules

- Use concise sentence-case labels: Plan, Map, Export, Order details. Keep AI labels only on actual AI functionality.
- Use text or consistent monochrome SVG icons. Remove decorative emojis. Preserve directional symbols, map attributions, trademarks and vendor code.
- Icon-only controls require an accessible name, a tooltip and a usable touch target. Never remove a symbol and leave an empty button.
- Use the shared font tokens. Body text is sans-serif; table figures use tabular numerals or the data font. Do not introduce display fonts for individual cards.
- Color communicates selection, availability, shortage or warning. Use neutral text for ordinary quantities and labels.
- Use quiet theme surfaces. Classic and Neomorph menus are opaque. Modern (Glassmorphism) menus retain translucent fills and backdrop blur, with a solid fallback when reduced transparency is enabled. Never apply opaque theme overrides globally.
- Use CSS hover/focus/pressed states. Do not add cursor-follow glow, card tilt, decorative ripples, animated backgrounds or startup overlays.
- Preserve loading indicators and the shared edge-overscroll behavior. Respect reduced motion.
- Keep all three themes and the continuous light/dark and accent controls functional.
- Keep keyboard focus visible. Target 4.5:1 text contrast and 3:1 control/state contrast; verify in the rendered page.
- Let layout respond to available space. Avoid fixed card widths and tiny text as overflow fixes.

## Rake Predictor

Each region owns a full-width heading and its own adaptive siding-card columns. Names remain prominent. Separate order-count markers from dispatch/payment warnings. Markers have consistent height, quiet backgrounds, count dividers and explicit text; color alone never carries status.

Plan, AI, Map and Excel form one segmented pill. Order details is an integrated footer: one top separator, no independent pill border or shadow.

## Verification

Check Classic, Modern and Neomorph in light/dark at mobile and desktop widths. Include dense data, long labels, empty/loading/error states, keyboard navigation and theme switching. Check visible labels after removing icons. Confirm refresh, details, exports and planning actions still work.

Local tests and screenshots are evidence for the tested cases only. Do not claim all workflows or live integrations passed from a fixture-only test.
