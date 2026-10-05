# Context — Plate Tracker (Casting → Dispatch Trace)

Full design and development context for `Plate-Tracker.html` and everything it
depends on. Read this before changing the page.

**Status:** working and verified. **Not yet committed** — `Plate-Tracker.html`,
`Plate-Tracker.js`, `plate-tracker-core.mjs`, `plate-tracker-worker.js` and the
Plate-Tracker scripts are all still untracked (`??`) on branch `dev` (HEAD
`d5c1a22`). See *Next* at the end.

---

## 1. What the page is for

A browser-only tool for tracing a steel plate through the plant. The user drops
in seven operational workbooks; the page links every row to an order and answers
one question:

> **What happened to this metal, in order?**

The chart is therefore a single mother-to-child lineage — **Heat › Slab › Plate ›
Dispatch** — with each stage hanging the unit it produced under the parent that
produced it. An earlier four-stage side-by-side layout was removed: it answered
"which stages does this order have?", which is not the question the chart exists
to answer.

Everything is parsed client-side. **No file is uploaded anywhere.**

## 2. File map

| File | Role |
|---|---|
| `Plate-Tracker.html` | Markup + all page CSS (inline `<style>`). |
| `Plate-Tracker.js` | Page controller: DOM, IndexedDB cache, worker handshake. |
| `plate-tracker-core.mjs` | **Pure domain logic.** DOM-free, side-effect-free. |
| `plate-tracker-worker.js` | Classic Worker; parses the workbooks off-thread. |
| `plate-tracker-xlsx.js` | Vendored SheetJS bundle. Not ours to edit. |
| `theme.css` | Shared design system for all 12 pages. |

The split is load-bearing: `plate-tracker-core.mjs` has no DOM references, so it
is unit-tested directly under `node --test` and imported unchanged by both the
page and the worker. Do not put rendering into it.

## 3. The data

Seven extracts, with genuinely different shapes — verified against the real
workbooks:

```
CASTING   57,632 rows · SO + Line item + Slab id      · dims in METRES
SLAB STOCK   854 rows · Batch (slab) + stock/location · current inventory
ROLLING    7,208 rows · SO + Line Item + SLAB_ID      · dims in MM
PLATE STOCK 9,584 rows · Batch + SLAB ID + bin/crane  · current inventory
FG       133,021 rows · Sales Order + Item + BATCH    · dims as STRINGS
DISPATCH 132,880 rows · SO No. + SO Item + Batch      · dims in MM
EBTP       5,462 rows · SO No. + SOItm                · order book
```

The `sheets/` directory also contains two alternate-format exports:
`FG-FORMAT.xlsx` (finishing) and `DISP-FORMAT.xlsx` (dispatch). They are
schema-validated by `npm run verify:all-sheets`, but are not merged into the
live index because they overlap the operational FG and Dispatch extracts and
would otherwise double-count orders. The same check covers all nine workbooks,
both stock snapshots, sheet selection, required headers, row accounting,
record creation and stock trace coverage.

Only casting and rolling share a column layout, so **every source declares its
columns by header NAME**, never by position. Header matching is case- and
whitespace-insensitive, with `alt` names tried in order (SAP's movement report
calls the source location `S_SLOC`; an earlier guess of `F_SLOC` silently
produced an empty column rather than an error).

### Parsing pipeline

`plate-tracker-worker.js`:

1. **Identify** the source by probing header columns, not filename — a re-export
   named `final_v2.xlsx` still has to land in the right slot. Requires ≥3 probe
   hits; the filename is only a tiebreaker.
2. **Pick the source and sheet together** by probing the first 25 rows of every
   tab. This avoids selecting SLAB STOCK's large analysis tabs instead of `WS`,
   or PLATE STOCK's summary pivots instead of `Stock`.
3. **Find the header row** by scanning the first 25 rows — real exports carry a
   title or blank line above the header, so row 1 is not assumed.
4. **Map columns** by name, then normalise.

> The worker is **classic, not a module worker**: SheetJS is a classic script
> publishing a global, and a module worker cannot call `importScripts()`. The
> shared core is pulled in with a dynamic `import()` instead. Do **not** add a
> second `const XLSX` in the worker — the vendored bundle already declares `var
> XLSX` in that scope, and the redeclaration is a SyntaxError that kills the
> worker outright.

### Normalisation worth knowing

- **Casting reports dimensions in metres; everything downstream uses mm.**
  Converted at parse time so one unit is in force everywhere else.
- **Stock can be unallocated.** Stock rows keep their physical slab/plate id
  even when SO/item is blank. They link by SO/item first, then by exact slab or
  plate id. Ambiguous identifier matches are labelled instead of guessed.
- **Clubbed rows.** One row whose SO + line item are clubbed stands for several
  orders, so `rowToRecords` yields one record per pair, each tagged
  `clubbedFrom`. Every other characteristic on the row is shared, because the
  extract gives no per-order breakdown.
- Unmapped columns are preserved on `raw` so "every characteristic" stays
  available without re-parsing.

## 4. The trace

```
Casting › Slab › Plate › Finishing › Dispatch
```

Each link is a verified relation, not a guess:

| Link | Rule | Verified |
|---|---|---|
| heat ← slab | slab id **begins with** the heat id (longest match wins) | 100% of casting rows |
| slab ← plate | plate id is the slab id + a cut suffix | 98.8% of finishing rows |
| plate ← dispatch | dispatch reports the same plate id | — |

Across 300 complete orders: 100% reached Heat, Slab and Plate levels, with zero
dateless lineage nodes.

### Design rules this encodes

- **Unlinkable stock is never dropped.** It remains visible in Stock view as
  unallocated or ambiguous inventory.
- **The flow is hierarchical.** It expands Heat → Slab → Plate → Dispatch.
  Missing records are explicit placeholders instead of collapsing the route.
- **Stock context sits on the physical stage.** Slab stock appears on Slab and
  plate stock appears on Plate, with quantity, location, aging and status in the
  tooltip.
- **Physical identities are expanded cards.** Heat, slab, plate and dispatch
  identities render as separate nested cards. Each card has its own hover/focus
  tooltip, with finishing details attached to the plate card.

## 5. Interaction model

- **Process flow** — an expanded responsive DOM tree from Heat to Slab to Plate
  to Dispatch, with no pan, zoom or fullscreen state. Hover or keyboard focus
  opens the card tooltip; arrow keys move through the visible lineage.
- **Stock view** — one table for slab and plate inventory. Exact single-order
  matches open the same process trace; unallocated and ambiguous rows stay in
  the stock table.
- **KPI cross-filters** — every summary KPI is a button, not a passive total.
  Order view can isolate complete, in-progress, not-started, in-stock and
  balance-due orders; Stock view can isolate slab, plate, exact-linked,
  unlinked and ambiguous inventory. The selected card uses `aria-pressed`, and
  clicking it again returns to All. Stage chips and stock-kind badges use the
  same cross-filter state and update the table, KPI counts and selected trace.
- **Order-book slicers** — eight `<details>` facets above the table. `<details>`
  rather than `<select>` because SO No. and Line Item run to thousands of
  distinct values and a plain select would be unusable for exactly the fields
  most worth slicing on. Values are counted from the plates actually loaded, so a
  count never promises rows a further filter would remove, and a value with no
  rows is not offered.
- **Sorting** — alphabetical, case-insensitive, accent- and punctuation-
  insensitive, numeric-aware. Slicers are reference lists people *scan*; the raw
  facet order is by first-seen, which is effectively arbitrary. Only one slicer
  is open at a time.
- Ticking a checkbox updates in place so the list keeps its scroll position and
  search text — the one interaction a slicer exists to support.

### Slicer dropdown placement — the current gotcha

The panel is **portalled to `document.body` as `position:fixed`**, positioned from
the trigger's real rect. It is not nested in its `<details>`. That is deliberate,
because `.glass-card` carries a `backdrop-filter`, which makes it both a
**stacking context and a containing block**:

- Nested inside it, the panel's `z-index` could not escape to beat
  `.data-table-wrap`'s `overflow:auto` context → **the table painted over it**.
- A `backdrop-filter` nested inside another `backdrop-filter` has its backdrop
  root clipped to that ancestor → **almost nothing left to blur**.

This trap is already documented in `Order-Status-Report.html:599-602`; the same
`usePortalPos` pattern is used by Order-Status-Report and Rake-Planner. If you add
another overlay to this page, portal it too.

Three bugs were introduced *by* the portal and fixed — all three were silent:

1. Queries scoped to `#slicerRow` found nothing once the panel moved, so the
   list rendered **empty**. Such lookups must query `document`.
2. `positionSlicerPanel` re-queried the panel from its `<details>` *after* the
   move, found nothing, returned early, and left every panel at `left:0/top:0`.
   The panel is now **passed in**.
3. The panel was measured *before* its list was painted, so the flip decision used
   an empty panel's height and the populated list **overflowed off-screen**. Order
   is now paint → then position.

Document/window listeners are wired **once** behind `slicerGlobalWired`, because
`refresh()` re-runs `renderSlicers()` on every keystroke.

## 6. Design system

Inherited from `theme.css`; the page only adds layout. Both the content wrapper
and `.app-header-shell` read **`--page-measure: 1720px`**, so the header bar can
never be wider than the cards it sits above — or narrower. This replaced a real
mismatch that was invisible below 1600px and left 420px of header overhang on
each side at 2560px.

- **Type** — Poppins (UI) + JetBrains Mono (figures). Monospace for numeric table
  columns so digits align.
- **Glass** — `--glass`, `--glass-card`, `--glass-hi`, `--glass-blur`. Cards are
  `.glass-card`; `--glass-hi` is the one that stays solidly opaque because it
  backs solid chrome such as sticky table headers. *Use real token names.*
  `--glass-border-heavy` and `--shadow-2` **do not exist**; naming them silently
  drops the declaration with no error.
- **Rhythm** — `--trace-stack` (`--space-stack`, 14px under 768px) is the single
  vertical step for every top-level block. `.trace-stack > *` sets `min-width:0`,
  because these are flex columns and a flex item defaults to `min-width:auto` —
  without it the wide chart and table stretch the whole page instead of scrolling
  inside their own containers.
- **Status is never colour alone.** Border style and explicit "No record" text
  carry it too. Stage colours: casting amber, rolling indigo, finishing teal,
  dispatch yellow.

## 7. Verification

Everything below is green as of the last change.

| Command | Result |
|---|---|
| `npm test` | 188/188 pass |
| `npm run smoke:plate-tracker` | all browser checks pass |
| `npm run check:html` / `check:js` | structure OK |
| `npm run verify:all-sheets` | 51/51 checks pass across all 9 workbooks |
| `npm run audit:responsive` | 12 HTML pages pass |
| `npm run verify:vercel` | deployment-ready |

Supporting scripts: `verify-integrity` (live + fixtures), `verify-pipeline`,
`verify-lineage`, `measure-header`, `make-schema-fixtures`.

### Gotchas when writing tests here

- `<details>` fires `toggle` as a **queued task**. Await a frame before reading
  the DOM or you will measure the *previously* open panel.
- **Never** use `position:fixed` to move a control inside `.glass-card` in a
  test — the card's `backdrop-filter` makes it the containing block, so the
  element is measured against the card, not the viewport. Use
  `transform: translateY()`.
- Playwright is deliberately **not** an npm dependency; scripts resolve it from
  the npx cache so the repo ships with zero runtime deps.
- Screenshot artefacts (`plate-tracker-*.png`) are written by the smoke run and
  are the only way to confirm a *visual* fix.

## 8. Constraints to preserve

- **Nothing leaves the browser.** No upload, no server-side parse.
- `sheets/` (~72MB of real production workbooks) is git-ignored and
  Vercel-ignored. `sheets-schema/` holds small generated fixtures and **is**
  committed, so tests run anywhere. Regenerate with `npm run fixtures:make`.
- Core stays DOM-free; rendering stays in the controller.
- Do not hand-edit `plate-tracker-xlsx.js`.

## Next

1. Review the diff and commit the untracked Plate-Tracker files.
2. Decide whether to redact identifying values from `sheets-schema/` before
   publishing publicly — the fixtures still carry real customer/order/date values.
3. Decide whether unlinked units (~27% of sampled orders) should use a
   nearest-prefix fallback parent, or stay explicitly unlinked in holding nodes.
