# Dashboard design context

Read this before changing dashboard presentation. Use DESIGN_SAP_CLASSIC.md for Classic and DESIGN_NEOMORPH.md for Neomorph; this document governs all three themes.

## Direction

Build an operational interface for planners, not a product landing page. Put data, filters and actions first. Preserve calculations, permissions, exports, refresh dependencies and navigation.

## Shared rules

- Use concise sentence-case labels: Plan, Map, Export, Order details. Keep AI labels only on actual AI functionality.
- Use text or consistent monochrome SVG icons. Remove decorative emojis. Preserve directional symbols, map attributions, trademarks and vendor code.
- Reuse `ui-icons.svg` and the `.ui-icon` class for page actions, navigation and status cues. Keep icons at 16px (18px on compact toolbars), with a 1.75px stroke and inherited `currentColor`. Mark label-adjacent icons `aria-hidden="true"` and `focusable="false"`. Preserve text labels except on compact mobile toolbars, where the button must retain an accessible name and tooltip. Keep icons out of exported text and report data.
- Icon-only controls require an accessible name, a tooltip and a usable touch target. Never remove a symbol and leave an empty button.
- Use the shared font tokens. Body text is sans-serif; table figures use tabular numerals or the data font. Do not introduce display fonts for individual cards.
- Color communicates selection, availability, shortage or warning. Use neutral text for ordinary quantities and labels.
- Use quiet theme surfaces. All three themes use the shared translucent overlay material for menus, popups, dialogs and headers. Keep Classic geometry and Neo shadows distinct. Use a solid fallback for reduced transparency or unsupported browsers; keep ordinary data cards quiet.
- Use CSS hover/focus/pressed states. Pointer tilt is supported on dashboard tiles and KPI cards through `card-tilt.js`, capped at 6 degrees; exclude headers, dragging, touch and reduced motion. Do not add cursor-follow glow, decorative ripples, animated backgrounds or startup overlays.
- Preserve loading indicators and the shared edge-overscroll behavior. Respect reduced motion.
- Small interaction feedback lives in `theme.css`: 140ms control-state transitions, 180ms switch/disclosure movement, and a restrained 0.96 press scale. Keep tabs and repeated data interactions stationary; use `data-motion="static"` to opt a control out of press scaling. Preserve state colors and visible focus without motion. Do not add animation dependencies or animate layout properties.
- Keep all three themes and the continuous light/dark and accent controls functional.
- Keep keyboard focus visible. Target 4.5:1 text contrast and 3:1 control/state contrast; verify in the rendered page.
- Let layout respond to available space. Avoid fixed card widths and tiny text as overflow fixes.

## Rake Predictor

Each region owns a full-width heading and its own adaptive siding-card columns. Names remain prominent. Separate order-count markers from dispatch/payment warnings. Markers have consistent height, quiet backgrounds, count dividers and explicit text; color alone never carries status.

Plan, AI, Map and Excel form one segmented pill. Order details is an integrated footer: one top separator, no independent pill border or shadow.

## Verification

Check Classic, Modern and Neomorph in light/dark at mobile and desktop widths. Include dense data, long labels, empty/loading/error states, keyboard navigation and theme switching. Check visible labels after removing icons. Confirm refresh, details, exports and planning actions still work.

Local tests and screenshots are evidence for the tested cases only. Do not claim all workflows or live integrations passed from a fixture-only test.

## Floating surfaces and responsive chrome

The shared overlay tokens in theme.css own header, menu, tooltip and dialog materials in every preset. Use --overlay-fill, --overlay-blur and --overlay-shadow rather than local hard-coded colors. Classic retains crisp corners; Neomorph retains opposed shadows. Body and data-card typography stays unchanged.

Menus must sample the page backdrop. React filters use their existing body portals; vanilla PM Yard, Admin and Grade Clubbing menus use dashboard-overlays.js to enter the browser top layer without moving DOM nodes or changing selection handlers. Menu positioning must remain within the visible viewport and respond to scrolling/resizing. Escape closes a menu and returns focus to its trigger.

Native single selects progressively use base-select and ::picker(select) where supported; other browsers retain the operating system picker. Keep native keyboard and form behavior. Never replace native controls solely to emulate glass on unsupported browsers.

On screens up to 768px, header action groups wrap into centered rows with 44px controls. Long host names truncate inside their own field; Auto BTP fields stack on small phones. Use an opaque material for reduced-transparency preferences and unsupported backdrop-filter; preserve forced-color behavior and reduced motion.

Direction: [TypeUI Glassmorphism](https://github.com/bergside/awesome-design-skills/blob/main/skills/glassmorphism/SKILL.md), [TypeUI Neumorphism](https://github.com/bergside/awesome-design-skills/blob/main/skills/neumorphism/SKILL.md), and [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md). The dashboard's operational hierarchy and existing brand take precedence over marketing-site defaults.

Verification: inspect all 14 pages at 320, 390, 768 and 1440px, both contrast modes and all three presets. Open actual menus and dialogs, test tab/Escape/focus return, check header groups in the hub iframe, then inspect reduced-transparency and native-picker fallbacks. Mock integrations for visual tests; these checks do not execute SAP or validate production business data.
