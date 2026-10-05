// Plate Tracker — page controller.
//
// The domain logic (parsing, normalisation, linking, tree layout) lives in
// plate-tracker-core.mjs and is unit-tested; this file is only the DOM shell
// around it, the IndexedDB cache, and the worker handshake.

import {
  STAGES, STAGE_IDS, STAGE_LABEL, SOURCES,
  buildTimeline, buildLineage, layoutTree, elbowPath, defaultExpandedIds,
  searchPlates, summarise, SLICERS, slicerValues,
  plateStem,
} from './plate-tracker-core.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const state = {
  plates: [],
  stocks: { slab: [], plate: [] },
  loaded: {},        // stageId -> { name, sheet, records, ... }
  view: 'orders',
  selectedKey: null,
  expanded: new Set(),
  stageFilter: [],
  // KPI cards are cross-filters, not passive totals. Each view keeps its own
  // selection so moving between the order book and inventory does not carry an
  // unrelated predicate across the boundary.
  crossFilter: { orders: 'all', stock: 'all' },
  // Order-book slicers: field -> Set of chosen values. An empty or absent Set
  // means "no filter on this field".
  slicers: {},
  // The values each slicer offers, rebuilt whenever the plate list changes.
  slicerOptions: {},
  tree: null,
  // The chart is one lineage: Heat › Slab › Plate › Dispatch, each hung under
  // the parent that produced it. The old four-stage side-by-side layout is gone —
  // it asked "which stages does this order have?" but the question this chart
  // exists to answer is "what happened to this metal, in order?".
  spine: 'lineage',
  chartMode: 'lineage',
  lineageRoots: [],
  // One stage can hold thousands of rows, so a node renders at most this many
  // children and says so; the rest stay behind "show all".
  nodeLimit: 200,
  limitOverrides: new Map(),
};

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: d }) : '—');
const dt = (v) => (v ? String(v) : '—');

/* ═══════════════════ IndexedDB cache ═══════════════════
   The normalised plate index runs to tens of megabytes, well past
   localStorage's ~5-10MB quota — the same constraint Order-Status-Report.html
   already works around for the EBTP CSV. */

const DB_NAME = 'jspl-plate-tracker-db';
const DB_STORE = 'cache';
const DB_KEY = 'latest';

function openDb() {
  return new Promise((resolve) => {
    try {
      if (!self.indexedDB) { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function idbGet() {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_KEY);
        req.onsuccess = () => { try { db.close(); } catch {} resolve(req.result || null); };
        req.onerror = () => { try { db.close(); } catch {} resolve(null); };
      } catch { try { db.close(); } catch {} resolve(null); }
    });
  }).catch(() => null);
}

function idbPut(value) {
  return openDb().then((db) => {
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, DB_KEY);
        tx.oncomplete = () => { try { db.close(); } catch {} resolve(true); };
        tx.onerror = () => { try { db.close(); } catch {} resolve(false); };
      } catch { try { db.close(); } catch {} resolve(false); }
    });
  }).catch(() => false);
}

function idbClear() {
  return openDb().then((db) => {
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(DB_KEY);
        tx.oncomplete = () => { try { db.close(); } catch {} resolve(true); };
        tx.onerror = () => { try { db.close(); } catch {} resolve(false); };
      } catch { try { db.close(); } catch {} resolve(false); }
    });
  }).catch(() => false);
}


/* ═══════════════════ Upload slots ═══════════════════ */

const SLOT_ORDER = ['casting', 'slabStock', 'rolling', 'plateStock', 'finishing', 'dispatch', 'ebtp'];

function renderSlots() {
  $('slots').innerHTML = SLOT_ORDER.map((id) => {
    const src = SOURCES[id];
    const info = state.loaded[id];
    const cls = info ? 'ok' : '';
    return `<div class="slot ${cls}" id="slot-${id}">
      <label class="slotTrigger" for="file-${id}">
        <h3><span class="dot"></span>${esc(src.label)}</h3>
        <div class="code">${esc(src.hint)}</div>
        <div class="fname">${info ? esc(info.name) : 'Drop or click to choose .xlsx'}</div>
        <div class="status">${info ? esc(slotStatus(info, id)) : 'Not loaded'}</div>
      </label>
      <input type="file" id="file-${id}" accept=".xlsx,.xls"/>
    </div>`;
  }).join('');

  for (const id of SLOT_ORDER) {
    const input = $('file-' + id);
    const slot = $('slot-' + id);
    input.addEventListener('change', (e) => {
      if (e.target.files[0]) ingest([e.target.files[0]]);
      e.target.value = '';
    });
    slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drag'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drag');
      if (e.dataTransfer.files.length) ingest([...e.dataTransfer.files]);
    });
  }
}

function slotStatus(info, sourceId) {
  const bits = [`Sheet "${info.sheet}" · ${info.records.toLocaleString()} records`];
  if (info.dropped) bits.push(sourceId === 'slabStock' || sourceId === 'plateStock'
    ? `${info.dropped.toLocaleString()} rows without a physical id`
    : `${info.dropped.toLocaleString()} rows without an SO + Line Item`);
  if (!info.confident) bits.push('routed by filename — check the columns');
  return bits.join(' · ');
}

function setSlotError(id, message) {
  const slot = $('slot-' + id);
  if (!slot) {
    $('linkReport').hidden = false;
    $('linkReport').textContent = message;
    return;
  }
  slot.classList.remove('ok');
  slot.classList.add('err');
  slot.querySelector('.status').textContent = message;
}

function setProgress(done, total, label) {
  const pct = total ? (done / total) : 0;
  $('progress').classList.toggle('show', total > 0);
  $('progressBar').style.transform = 'scaleX(' + pct + ')';
  $('progressLabel').classList.toggle('show', total > 0);
  $('progressLabel').textContent = label || '';
}

/* ═══════════════════ Ingest ═══════════════════ */

let worker = null;
let jobId = 0;

function getWorker() {
  if (worker) return worker;
  // A CLASSIC worker: the vendored SheetJS is a classic script loaded via
  // importScripts, which a module worker cannot call. The shared core is pulled
  // in by the worker itself with a dynamic import.
  worker = new Worker('./plate-tracker-worker.js');
  worker.onmessage = onWorkerMessage;
  worker.onerror = (e) => {
    $('dataStatus').classList.remove('live');
    $('dataStatusText').textContent = 'Parser failed to start';
    console.error('plate tracker worker', e);
  };
  return worker;
}

function ingest(files) {
  if (!files.length) return;
  const id = ++jobId;
  setProgress(0, files.length, 'Reading ' + files[0].name + '…');
  getWorker().postMessage({ id, files });
}

function onWorkerMessage(event) {
  const msg = event.data || {};
  if (msg.id !== jobId) return; // a newer job superseded this one

  if (msg.type === 'progress') {
    setProgress(msg.index, msg.total, `Reading ${msg.name} (${msg.index + 1}/${msg.total})…`);
    return;
  }
  if (msg.type === 'file') {
    state.loaded[msg.sourceId] = msg.loaded;
    renderSlots();
    return;
  }
  if (msg.type === 'file-error') {
    if (msg.sourceId) setSlotError(msg.sourceId, msg.error);
    else {
      $('linkReport').hidden = false;
      $('linkReport').textContent = `${msg.name}: ${msg.error}`;
    }
    return;
  }
  if (msg.type === 'fatal') {
    setProgress(0, 0, '');
    $('dataStatus').classList.remove('live');
    $('dataStatusText').textContent = 'Parser failed to start';
    $('linkReport').hidden = false;
    $('linkReport').textContent = msg.error;
    return;
  }
  if (msg.type === 'done') {
    state.plates = msg.plates;
    state.stocks = msg.stocks || { slab: [], plate: [] };
    state.loaded = msg.loaded;
    state.selectedKey = null;
    $('detail').hidden = true;
    renderSlots();
    renderLinkReport();
    setDataStatus(state.plates.length, state.loaded);
    $('clearBtn').disabled = false;
    // Facet values are counted off the loaded plates, so they are rebuilt
    // whenever the index is. Any selection made against the old data is dropped
    // rather than silently kept: a value that no longer exists would filter the
    // new data to nothing with no visible reason.
    state.slicers = {};
    state.crossFilter = { orders: 'all', stock: 'all' };
    buildSlicerOptions();
    refresh();
    setProgress(0, 0, '');
    // Only cache once the index is built; a half-parsed set would be worse
    // than none, because it would look authoritative on the next visit.
    idbPut({ plates: state.plates, stocks: state.stocks, loaded: state.loaded, savedAt: Date.now() });
  }
}

/* ═══════════════════ Search + table ═══════════════════ */

function orderMatchesCrossFilter(plate, filter = state.crossFilter.orders) {
  if (filter === 'complete') return plate.complete;
  if (filter === 'in-progress') return plate.presentStages > 0 && !plate.complete;
  if (filter === 'not-started') return plate.presentStages === 0;
  if (filter === 'in-stock') return (plate.stockSummary?.slabCount || 0) + (plate.stockSummary?.plateCount || 0) > 0;
  if (filter === 'balance-due') return typeof plate.balanceToDeliver === 'number' && plate.balanceToDeliver > 0;
  return true;
}

function stockMatchesCrossFilter(record, filter = state.crossFilter.stock) {
  if (filter === 'slab') return record.stockKind === 'slab';
  if (filter === 'plate') return record.stockKind === 'plate';
  if (filter === 'linked') return !record.ambiguous && (record.linkedKeys || []).length === 1;
  if (filter === 'unlinked') return !(record.linkedKeys || []).length;
  if (filter === 'ambiguous') return !!record.ambiguous;
  return true;
}

function currentResults(limit = 500, applyCrossFilter = true, applyStageFilter = true) {
  const rows = searchPlates(state.plates, $('q').value, {
    stages: applyStageFilter ? state.stageFilter : [],
    from: $('from').value || null,
    to: $('to').value || null,
    slicers: state.slicers,
    limit: Infinity,
  });
  const filtered = applyCrossFilter
    ? rows.filter((plate) => orderMatchesCrossFilter(plate))
    : rows;
  return filtered.slice(0, limit);
}

function currentStockResults(limit = Infinity, applyCrossFilter = true) {
  const needle = $('q').value.trim().toLocaleLowerCase();
  const from = $('from').value || null;
  const to = $('to').value || null;
  const all = [...(state.stocks.slab || []), ...(state.stocks.plate || [])];
  const rows = all.filter((record) => {
    if (from && record.date && record.date < from) return false;
    if (to && record.date && record.date > to) return false;
    if (!needle) return true;
    return [
      record.stockId, record.so, record.lineItem, record.slabId, record.batch,
      record.grade, record.extGrade, record.customer, record.sloc,
      record.stockLocation, record.storageBin, record.craneArea, record.area,
      record.stockStatus, record.aging,
    ].some((value) => String(value || '').toLocaleLowerCase().includes(needle));
  });
  return (applyCrossFilter ? rows.filter((record) => stockMatchesCrossFilter(record)) : rows).slice(0, limit);
}

/* ═══════════════════ Slicers ═══════════════════
   Facets over the EBTP order book, above the table they filter. Each is a
   <details> holding a search box and a checkbox list, because SO No. and Line
   Item run to thousands of distinct values and a plain <select> would be
   unusable for exactly the fields most worth slicing on.

   Values are counted from the plates actually loaded, so a count never promises
   rows that a further filter would take away, and a value with no rows is not
   offered at all. */

const SLICER_VALUE_CAP = 3000;

// One-shot latch for the document/window slicer listeners, so re-rendering the
// bar (which refresh() does on every filter change) does not re-register them.
let slicerGlobalWired = false;

function activeSlicerCount() {
  let n = 0;
  for (const field of Object.keys(state.slicers)) {
    if (state.slicers[field] && state.slicers[field].size) n += 1;
  }
  return n;
}

function buildSlicerOptions() {
  const options = {};
  for (const { field } of SLICERS) {
    const values = slicerValues(state.plates, field);
    // Past the cap the tail is long, low-count noise; the search box still finds
    // any value, so nothing becomes unreachable.
    options[field] = values.length > SLICER_VALUE_CAP
      ? values.slice(0, SLICER_VALUE_CAP)
      : values;
    // Alphabetical, case-insensitive, ignoring the accents and punctuation that
    // make "PES ENGINEERS PVT LTD" sort after "PATU" for no reason a reader can
    // see. Slicers are reference lists: a user hunting for a customer is looking
    // for it ALPHABETICALLY, and the raw facet order is by first-seen, which is
    // effectively arbitrary. Numbers sort numerically so "SO 2" precedes "SO 10".
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    options[field].sort((a, b) => collator.compare(a.value, b.value));
  }
  state.slicerOptions = options;
}

/* Position a portalled slicer panel against its trigger's real screen rect.

   The panel lives on document.body as position:fixed, so it has to be placed by
   hand — there is no offset parent left to do it. Three things have to be true
   at once, and each one is a case that used to be visibly broken:

   - It must not run off the BOTTOM. Near the fold there is no room below the
     trigger, so the panel flips above it instead of being cut off.
   - It must not run off the RIGHT. Clamped to the viewport, minus a gutter.
   - It must follow the trigger. The page scrolls and the bar reflows, so this
     re-runs on scroll (capture: true, to catch the table's own scrolling) and
     on resize rather than freezing the panel where it was first opened. */
const SLICER_GAP = 8;
function positionSlicerPanel(details, panel) {
  // The panel is passed IN rather than looked up from `details`: an open panel is
  // portalled to document.body, so once it has moved it is no longer a descendant
  // of its <details> and `details.querySelector` would come back empty — which
  // silently skipped every placement, leaving the panel at the CSS default of
  // left:0/top:0.
  panel = panel || details.querySelector('.slicer-panel');
  const trigger = details.querySelector('summary');
  if (!panel || !trigger) return;
  const r = trigger.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;

  // Measure with the height cap cleared, so a panel that is currently clamped
  // does not report a height that already includes the old clamp.
  panel.style.maxHeight = '';
  const h = panel.offsetHeight, w = panel.offsetWidth;
  const below = vh - r.bottom - SLICER_GAP;
  const above = r.top - SLICER_GAP;
  const flip = below < Math.min(h, 220) && above > below;

  panel.style.left = `${Math.round(Math.max(SLICER_GAP, Math.min(r.left, vw - w - SLICER_GAP)))}px`;
  panel.style.top = `${Math.round(flip ? Math.max(SLICER_GAP, r.top - SLICER_GAP - h) : r.bottom + SLICER_GAP)}px`;
  panel.style.maxHeight = `${Math.round(Math.max(140, flip ? above : below))}px`;
  if (flip) panel.setAttribute('data-flip', '');
  else panel.removeAttribute('data-flip');
}

function renderSlicers() {
  const bar = $('slicerBar');
  if (state.view === 'stock') { bar.hidden = true; return; }
  if (!state.plates.length) { bar.hidden = true; return; }
  bar.hidden = false;

  // Every slicer reads an EBTP column. Without the order book there is nothing
  // for them to read, so they say so rather than quietly matching nothing.
  // `state.loaded[id].records` is a COUNT, not the array of rows.
  $('slicerNote').hidden = !!(state.loaded.ebtp && state.loaded.ebtp.records);

  $('slicerRow').innerHTML = SLICERS.map(({ field, label }) =>
    `<details class="slicer" id="slicer-${esc(field)}">
      <summary><span class="slicer-name">${esc(label)}</span><span class="slicer-pick"></span></summary>
      <div class="slicer-panel">
        <input class="slicer-search" type="search" placeholder="Find in ${esc(label)}" aria-label="Search ${esc(label)}" data-search="${esc(field)}" autocomplete="off"/>
        <div class="slicer-list" role="group" aria-label="${esc(label)}" data-list="${esc(field)}"></div>
        <div class="slicer-foot">
          <button class="btn" type="button" data-clear="${esc(field)}">Clear</button>
          <span class="slicer-summary" data-note="${esc(field)}"></span>
        </div>
      </div>
    </details>`).join('');

  $('slicerRow').querySelectorAll('details').forEach((d) => {
    const field = d.id.replace('slicer-', '');
    const panel = d.querySelector('.slicer-panel');
    d.addEventListener('toggle', () => {
      if (!d.open) {
        // Put the panel back inside its <details> on close, so the markup that
        // renderSlicers owns stays the single source of truth for the DOM.
        if (panel.parentNode !== d) d.appendChild(panel);
        return;
      }
      // Only one slicer open at a time. Eight portalled panels stacked on top of
      // each other is not a menu, and each would cover the next one's trigger.
      for (const other of $('slicerRow').querySelectorAll('details.slicer')) {
        if (other !== d && other.open) other.open = false;
      }
      // Portal to the body root. Nested inside .glass-card the panel was both
      // painted under the table and denied a backdrop to blur; at the body root
      // it floats above the content and the blur has the whole page to sample.
      document.body.appendChild(panel);
      // Fill the list BEFORE measuring. positionSlicerPanel reads offsetHeight to
      // decide whether to flip, so measuring an empty panel (just the search box
      // and footer) made it believe it was short enough to fit below the trigger —
      // and then the populated list overflowed off the bottom of the screen.
      paintSlicerList(field, '');
      positionSlicerPanel(d, panel);
    });
    d.querySelector('[data-clear]').addEventListener('click', () => {
      delete state.slicers[field];
      d.open = false;
      refresh();
    });
    const search = d.querySelector('[data-search]');
    search.addEventListener('input', () => paintSlicerList(field, search.value));
    // Searching inside a slicer only narrows that one list. It must not dismiss
    // the panel or re-run the table on every keystroke.
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape') d.open = false; });
    // Escape from anywhere else in the panel closes it and returns focus to the
    // trigger, so a keyboard user is never stranded inside a panel that has just
    // left the accessibility tree along with its <details>.
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      d.open = false;
      d.querySelector('summary').focus();
    });
  });

  // A click outside the open panel dismisses it. Capture phase, and skipping any
  // summary, so clicking a trigger closes that panel instead of the pointerdown
  // dismissing it and the click reopening it again on the same tap.
  //
  // These two are document/window-level and registered ONCE, not per render.
  // renderSlicers is re-run by every refresh() — including on every keystroke in
  // the search box — so registering them inside it would stack up a new listener
  // pair each time and re-position the panel many times over per scroll tick.
  if (!slicerGlobalWired) {
    slicerGlobalWired = true;
    document.addEventListener('pointerdown', (e) => {
      const open = $('slicerRow').querySelector('details.slicer[open]');
      if (!open) return;
      if (e.target.closest('.slicer-panel') || e.target.closest('#slicerRow summary')) return;
      open.open = false;
    }, true);
    // Keep the panel glued to its trigger as the page moves under it.
    // Capture:true is what makes this fire for the table's own scrolling, not
    // just the window's.
    const rePlace = () => {
      const open = $('slicerRow').querySelector('details.slicer[open]');
      if (!open) return;
      // At most one panel is ever portalled (opening one closes the others), so
      // the single body-level panel IS this facet's panel.
      positionSlicerPanel(open, document.querySelector('body > .slicer-panel'));
    };
    window.addEventListener('scroll', rePlace, true);
    window.addEventListener('resize', rePlace);
  }
  syncSlicerChrome();
}

// The parts of the slicer bar that reflect the current selection: each facet's
// chip text, the match count, and the Clear all button.
//
// This is deliberately separate from renderSlicers. Ticking a box used to
// rebuild the whole bar, which tore the checkbox out from under the click that
// made it and lost the search text and scroll position — the one interaction a
// slicer exists to support.
function syncSlicerChrome() {
  const total = state.plates.length;
  $('slicerSummary').textContent = activeSlicerCount()
    ? `${currentResults().length.toLocaleString()} of ${total.toLocaleString()} orders match`
    : `${total.toLocaleString()} orders`;
  $('clearSlicersBtn').hidden = !activeSlicerCount();
  for (const { field, label } of SLICERS) {
    const d = $(`slicer-${field}`);
    if (!d) continue;
    const chosen = state.slicers[field] || new Set();
    const pick = chosen.size === 0
      ? 'All'
      : chosen.size === 1 ? String([...chosen][0]) : `${chosen.size} selected`;
    const el = d.querySelector('.slicer-pick');
    el.textContent = pick;
    d.querySelector('summary').setAttribute('aria-label', `${label}: ${pick}`);
  }
}

function paintSlicerList(field, filter) {
  // Queried at the DOCUMENT, not inside #slicerRow: an open panel is portalled to
  // document.body, so scoping this to the slicer bar found nothing at all and the
  // list silently stayed empty.
  const list = document.querySelector(`[data-list="${CSS.escape(field)}"]`);
  if (!list) return;
  const needle = filter.trim().toLowerCase();
  const chosen = state.slicers[field] || new Set();
  const options = (state.slicerOptions[field] || []).filter(
    (o) => !needle || o.value.toLowerCase().includes(needle));
  if (!options.length) {
    list.innerHTML = `<div class="slicer-empty">${needle ? 'No value matches that' : 'No values in the order book'}</div>`;
  } else {
    list.innerHTML = options.map((o) => {
      const id = `slt-${field}-${o.value}`;
      return `<label class="slicer-opt" for="${esc(id)}">
        <input type="checkbox" id="${esc(id)}" value="${esc(o.value)}" ${chosen.has(o.value) ? 'checked' : ''}/>
        <span class="slicer-opt-text" title="${esc(o.value)}">${esc(o.value)}</span>
        <span class="slicer-opt-count">${o.count.toLocaleString()}</span>
      </label>`;
    }).join('');
    list.querySelectorAll('input[type=checkbox]').forEach((box) => {
      box.addEventListener('change', () => {
        const set = new Set(state.slicers[field] || []);
        if (box.checked) set.add(box.value);
        else set.delete(box.value);
        if (set.size) state.slicers[field] = set;
        else delete state.slicers[field];
        // In place, not a rebuild: the list the user is ticking through, its
        // scroll position and its search text all have to survive the click.
        syncSlicerChrome();
        renderCrossFilteredViews();
      });
    });
  }
  // Also document-scoped, for the same reason as the list above: the footer count
  // lives inside the portalled panel.
  const note = document.querySelector(`[data-note="${CSS.escape(field)}"]`);
  if (note) note.textContent = `${options.length.toLocaleString()} of ${(state.slicerOptions[field] || []).length.toLocaleString()}`;
}

function refresh() {
  syncViewChrome();
  renderSlicers();
  renderStageChips();
  renderSummaryChips();
  renderTable();
  syncSelectedTrace();
}

function syncSelectedTrace() {
  if (!state.selectedKey) return;
  const visible = state.view === 'orders'
    ? currentResults(Infinity).some((plate) => plate.key === state.selectedKey)
    : currentStockResults(Infinity).some((record) => (record.linkedKeys || []).includes(state.selectedKey));
  const plate = visible ? state.plates.find((p) => p.key === state.selectedKey) : null;
  if (plate) renderDetail(plate);
  else {
    state.selectedKey = null;
    $('detail').hidden = true;
    hideTip();
  }
}

function renderCrossFilteredViews() {
  renderStageChips();
  renderSummaryChips();
  renderTable();
  syncSelectedTrace();
}

function renderStageChips() {
  const host = $('stageChips');
  if (state.view === 'stock') { host.innerHTML = ''; return; }
  if (!state.plates.length) { host.innerHTML = ''; return; }
  // Count stages inside the population produced by every other active filter.
  // Excluding the stage facet itself keeps unselected options useful.
  const summary = summarise(currentResults(Infinity, true, false));
  host.innerHTML = STAGE_IDS.map((id) => {
    const on = state.stageFilter.includes(id);
    const n = summary.byStage[id];
    return `<button class="chip click ${on ? 'on' : ''}" type="button" data-stage="${id}" aria-pressed="${on}">${STAGE_LABEL[id]} · ${n.toLocaleString()}</button>`;
  }).join('');
  host.querySelectorAll('[data-stage]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.stage;
      const at = state.stageFilter.indexOf(id);
      if (at === -1) state.stageFilter.push(id);
      else state.stageFilter.splice(at, 1);
      refresh();
    });
  });
}

function renderSummaryChips() {
  const host = $('summaryChips');
  if (state.view === 'stock') {
    const rows = currentStockResults(Infinity, false);
    const slab = rows.filter((r) => r.stockKind === 'slab');
    const plate = rows.filter((r) => r.stockKind === 'plate');
    const qty = (list) => list.reduce((sum, r) => sum + (typeof r.stockQty === 'number' ? r.stockQty : 0), 0);
    renderKpiCrossFilters(host, [
      { id: 'all', label: 'All stock', value: rows.length, hint: `${num(qty(rows), 2)} t` },
      { id: 'slab', label: 'Slab stock', value: slab.length, hint: `${num(qty(slab), 2)} t` },
      { id: 'plate', label: 'Plate stock', value: plate.length, hint: `${num(qty(plate), 2)} t` },
      { id: 'linked', label: 'Linked', value: rows.filter((r) => !r.ambiguous && (r.linkedKeys || []).length === 1).length, hint: 'one trace' },
      { id: 'unlinked', label: 'Unlinked', value: rows.filter((r) => !(r.linkedKeys || []).length).length, hint: 'no order' },
      { id: 'ambiguous', label: 'Ambiguous', value: rows.filter((r) => r.ambiguous).length, hint: 'review match' },
    ], 'stock');
    return;
  }
  if (!state.plates.length) { host.innerHTML = ''; return; }
  const rows = currentResults(Infinity, false, true);
  const stockQty = (plate) => (plate.stockSummary?.slabQty || 0) + (plate.stockSummary?.plateQty || 0);
  const hasStock = (plate) => (plate.stockSummary?.slabCount || 0) + (plate.stockSummary?.plateCount || 0) > 0;
  renderKpiCrossFilters(host, [
    { id: 'all', label: 'All orders', value: rows.length, hint: 'current scope' },
    { id: 'complete', label: 'Complete', value: rows.filter((p) => p.complete).length, hint: 'all 4 stages' },
    { id: 'in-progress', label: 'In progress', value: rows.filter((p) => p.presentStages > 0 && !p.complete).length, hint: 'production started' },
    { id: 'not-started', label: 'Not started', value: rows.filter((p) => p.presentStages === 0).length, hint: 'order only' },
    { id: 'in-stock', label: 'In stock', value: rows.filter(hasStock).length, hint: `${num(rows.reduce((sum, p) => sum + stockQty(p), 0), 2)} t` },
    { id: 'balance-due', label: 'Balance due', value: rows.filter((p) => typeof p.balanceToDeliver === 'number' && p.balanceToDeliver > 0).length, hint: `${num(rows.reduce((sum, p) => sum + (p.balanceToDeliver > 0 ? p.balanceToDeliver : 0), 0), 2)} t` },
  ], 'orders');
}

function renderKpiCrossFilters(host, definitions, view) {
  const selected = state.crossFilter[view] || 'all';
  host.innerHTML = definitions.map(({ id, label, value, hint }) => {
    const active = selected === id;
    const action = id === 'all'
      ? `Show all ${view === 'stock' ? 'stock' : 'orders'}`
      : `Filter to ${label.toLocaleLowerCase()}`;
    return `<button class="kpi-filter" type="button" data-kpi-filter="${esc(id)}" aria-pressed="${active}" title="${esc(action)}">
      <span class="kpi-filter-label">${esc(label)}</span>
      <strong class="kpi-filter-value">${Number(value || 0).toLocaleString()}</strong>
      <span class="kpi-filter-hint">${esc(hint || '')}</span>
    </button>`;
  }).join('');
  host.querySelectorAll('[data-kpi-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.kpiFilter;
      state.crossFilter[view] = state.crossFilter[view] === id && id !== 'all' ? 'all' : id;
      renderCrossFilteredViews();
    });
  });
}

function renderTable() {
  if (state.view === 'stock') { renderStockTable(); return; }
  const host = $('tableHost');
  if (!state.plates.length) {
    host.innerHTML = '<div class="empty-msg">Load the extracts above to begin.</div>';
    return;
  }
  const results = currentResults();
  if (!results.length) {
    host.innerHTML = '<div class="empty-msg">No orders match the active cross-filters. Widen the date range or reset a selected KPI, stage or slicer.</div>';
    return;
  }
  // EBTP-first column set. The order book is the base view, so the columns lead
  // with what was ordered and what is still outstanding; the stage pills then
  // report what has actually happened to it. An order with no stage record
  // still has a row, which is the whole point of leading with EBTP.
  const head = ['SO No.', 'Item', 'Grade', 'Customer', 'Order (t)', 'Bal. (t)', 'Status', 'Stages', 'Weight (t)', 'First', 'Last', 'Lead (d)'];
  // Footnote for the asterisk on orders that have no production record yet, so
  // the marker is explained where it is used rather than only on hover.
  const foot = '<div class="note" style="margin:8px 0 0">* Order booked in EBTP with no production record yet — the date shown is the SO date, not a production date.</div>';
  const rows = results.map((p) => {
    const stages = STAGE_IDS.map((id) => {
      const on = p.stages[id].present;
      if (!on) return `<span class="stage-marker none" title="No ${esc(STAGE_LABEL[id])} record in this extract">—</span>`;
      return `<button class="stage-marker ${id}" type="button" data-row-stage="${id}" title="Filter to orders that reached ${esc(STAGE_LABEL[id])}">${esc(STAGE_LABEL[id].slice(0, 4))}</button>`;
    }).join(' ');
    // For an order with no production record, `firstDate` falls back to the SO
    // date so the row can be filtered and sorted. That date is not a production
    // date, so the cell says so on hover rather than passing for one.
    const firstHint = p.presentStages === 0 && p.soDate ? ' title="SO date — no production record yet"' : '';
    const firstText = p.presentStages === 0 && p.soDate ? p.soDate + '*' : dt(p.firstDate);
    return `<tr data-key="${esc(p.key)}" class="${p.key === state.selectedKey ? 'sel' : ''}" tabindex="0">
      <td class="mono">${esc(p.so)}</td>
      <td class="mono">${esc(p.lineItem)}</td>
      <td>${esc(p.grade || '—')}</td>
      <td>${esc(p.customer || '—')}</td>
      <td class="mono">${num(p.orderQty, 2)}</td>
      <td class="mono">${num(p.balanceToDeliver, 2)}</td>
      <td>${esc(p.orderStatus || '—')}</td>
      <td>${stages}</td>
      <td class="mono">${p.weight === null ? '—' : num(p.weight, 2)}</td>
      <td class="mono"${firstHint}>${esc(firstText)}</td>
      <td class="mono">${dt(p.lastDate)}</td>
      <td class="mono">${p.leadTimeDays === null ? '—' : p.leadTimeDays}</td>
    </tr>`;
  }).join('');

  // The footnote only earns its space when an unstarted order is actually on
  // screen, so it is gated on the same condition that puts the asterisk there.
  const hasUnstarted = results.some((p) => p.presentStages === 0 && p.soDate);

  const headerHtml = head.map((h) => '<th scope="col">' + esc(h) + '</th>').join('');
  host.innerHTML = `<div class="data-table-wrap"><table class="data">
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${rows}</tbody></table></div>
    ${hasUnstarted ? foot : ''}
    ${results.length >= 500 ? '<p class="note">Showing the first 500 matches — narrow the search to see the rest.</p>' : ''}`;

  host.querySelectorAll('tr[data-key]').forEach((tr) => {
    const pick = () => selectPlate(tr.dataset.key);
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });
  host.querySelectorAll('[data-row-stage]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      state.stageFilter = [button.dataset.rowStage];
      refresh();
      $('trace').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function syncViewChrome() {
  document.querySelectorAll('#viewSwitch [data-view]').forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const stock = state.view === 'stock';
  const label = document.querySelector('label[for="q"]');
  if (label) label.textContent = stock
    ? 'Slab · plate · SO No. · grade · location · stock status'
    : 'SO No. · Line Item · batch · slab · customer';
  $('q').placeholder = stock
    ? 'e.g. F6341608E0, PM STOCK, NO PLAN'
    : 'e.g. 607831786, F6204202A0, PES ENGINEERS';
  $('tableIntroTitle').textContent = stock ? 'Current slab and plate stock' : 'Order-book coverage';
  $('tableIntroText').textContent = stock
    ? 'Rows with one exact order match open the same Heat → Slab → Plate → Dispatch lineage. Unallocated and ambiguous stock stays visible.'
    : 'Click any row to open its production trace. Stage markers show presence, not completion.';
}

function renderStockTable() {
  const host = $('tableHost');
  const allCount = (state.stocks.slab || []).length + (state.stocks.plate || []).length;
  if (!allCount) {
    host.innerHTML = '<div class="empty-msg">Load SLAB STOCK and PLATE STOCK to view current inventory.</div>';
    return;
  }
  const rows = currentStockResults(1000);
  if (!rows.length) {
    host.innerHTML = '<div class="empty-msg">No stock records match the active search and cross-filter.</div>';
    return;
  }
  const head = ['Stock', 'Physical ID', 'SO / Item', 'Grade', 'Size (mm)', 'Qty (t)', 'Location', 'Age', 'Status', 'Trace'];
  const body = rows.map((record) => {
    const location = [record.stockLocation, record.sloc, record.area, record.storageBin, record.craneArea]
      .filter(Boolean).join(' · ') || '—';
    const size = [record.thicknessMm, record.widthMm, record.lengthMm]
      .map((v) => typeof v === 'number' ? num(v, 1) : '—').join(' × ');
    const order = record.key ? `${record.so} / ${record.lineItem}` : 'Unallocated';
    const links = record.linkedKeys || [];
    const trace = record.ambiguous ? `${links.length} possible orders`
      : links.length === 1 ? 'Open trace' : 'No linked order';
    const keyAttr = links.length === 1 ? ` data-key="${esc(links[0])}" tabindex="0"` : '';
    const age = record.agingDays === undefined ? (record.aging || '—') : num(record.agingDays) + ' d';
    return `<tr${keyAttr} class="${links.length === 1 ? 'stock-linked' : ''}">
      <td><button class="stock-kind ${record.stockKind}" type="button" data-stock-kind="${record.stockKind}" title="Filter to ${record.stockKind} stock">${record.stockKind === 'slab' ? 'Slab' : 'Plate'}</button></td>
      <td class="mono">${esc(record.stockId)}</td>
      <td class="mono">${esc(order)}</td>
      <td>${esc(record.grade || record.extGrade || '—')}</td>
      <td class="mono">${esc(size)}</td>
      <td class="mono">${record.stockQty === undefined ? '—' : num(record.stockQty, 3)}</td>
      <td>${esc(location)}</td>
      <td class="mono">${esc(age)}</td>
      <td>${esc(record.stockStatus || record.rollability || record.qualityRemark || '—')}</td>
      <td>${esc(trace)}</td>
    </tr>`;
  }).join('');
  const headerHtml = head.map((h) => '<th scope="col">' + esc(h) + '</th>').join('');
  host.innerHTML = `<div class="data-table-wrap"><table class="data stock-data">
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${body}</tbody></table></div>
    ${rows.length >= 1000 ? '<p class="note">Showing the first 1,000 matches. Narrow the search to see a specific stock item.</p>' : ''}`;
  host.querySelectorAll('tr[data-key]').forEach((tr) => {
    const pick = () => selectPlate(tr.dataset.key);
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
  });
  host.querySelectorAll('[data-stock-kind]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      state.crossFilter.stock = button.dataset.stockKind;
      renderCrossFilteredViews();
      $('trace').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* ═══════════════════ Trace detail ═══════════════════ */

function renderDetail(plate) {
  const conf = plate.linkConfidence;
  const cells = [
    ['Sales Order', plate.so, true],
    ['Line Item', plate.lineItem, true],
    ['Internal grade', plate.grade || '—', false],
    ['External grade', plate.extGrade || '—', false],
    ['Customer', plate.customer || '—', false],
    ['Batch', plate.batch || '—', true],
    ['Slab id', plate.slabId || '—', true],
    ['Total weight', plate.weight === null ? '—' : num(plate.weight, 2) + ' t', false],
    ['Current stage', plate.currentStage ? STAGE_LABEL[plate.currentStage] : '—', false],
    ['Stages present', `${plate.presentStages} of ${plate.stageCount}`, false],
    ['Lead time', plate.leadTimeDays === null ? '—' : plate.leadTimeDays + ' days', false],
    ['Link confidence', conf, false],
  ];
  // Order-book context from EBTP. Shown only when the book was loaded, so a
  // production-only run keeps exactly the cells it had before.
  if (plate.order) {
    cells.push(
      ['Order qty', plate.orderQty === null || plate.orderQty === undefined ? '—' : num(plate.orderQty, 3) + ' t', false],
      ['Delivered', plate.delivered === null || plate.delivered === undefined ? '—' : num(plate.delivered, 3) + ' t', false],
      ['Balance to deliver', plate.balanceToDeliver ? num(plate.balanceToDeliver, 3) + ' t' : '—', false],
      ['Order status', plate.orderStatus || '—', false],
      ['Payment status', plate.paymentStatus || '—', false],
      ['SO date', plate.soDate || '—', true],
      ['First promise', plate.firstPromiseDate || '—', true],
      ['Last promise', plate.lastPromiseDate || '—', true],
      ['Remarks', plate.orderRemarks || '—', false],
    );
  }
  if (plate.stock && (plate.stock.slabCount || plate.stock.plateCount)) {
    cells.push(
      ['Slab stock', plate.stock.slabCount ? `${plate.stock.slabCount} record(s) · ${num(plate.stock.slabQty, 3)} t` : 'Not in slab stock', false],
      ['Plate stock', plate.stock.plateCount ? `${plate.stock.plateCount} record(s) · ${num(plate.stock.plateQty, 3)} t` : 'Not in plate stock', false],
    );
  }
  $('traceHead').innerHTML = cells.map(([k, v, mono]) =>
    `<div class="cell"><div class="k">${esc(k)}</div><div class="v${mono ? ' mono' : ''}">${esc(v)}</div></div>`).join('')
    + (plate.links.length
      ? `<div class="cell" style="grid-column:1/-1"><div class="k">Data note</div><div class="v" style="font-weight:600">${plate.links.length} identifier(s) appear on more than one order — the orders were kept separate rather than merged.</div></div>`
      : '');

  renderTimeline(plate);
  state.tree = buildLineage(plate, { includeAttributes: false });
  state.expanded = defaultExpandedIds(state.tree, { spine: state.spine });
  renderChartMode(plate);
}

function renderTimeline(plate) {
  const tl = buildTimeline(plate);
  const track = $('tlTrack');
  if (!tl.segments.length) {
    track.innerHTML = '';
    $('tlAxis').innerHTML = '<span>No dated records in the loaded extracts</span>';
    $('tlGaps').innerHTML = '';
    return;
  }
  track.innerHTML = tl.segments.filter((s) => s.kind === 'stage').map((s) => {
    const title = `${s.label}: ${s.start} → ${s.end}${s.durationDays !== null ? ' (' + s.durationDays + 'd)' : ''}${s.status ? ' · ' + s.status : ''}`;
    return `<div class="tl-seg ${s.stageId}" style="left:${s.offsetPct}%;width:${s.widthPct}%" title="${esc(title)}" data-tip="${esc(title)}">${s.widthPct > 9 ? esc(s.label) : ''}</div>`;
  }).join('');

  $('tlAxis').innerHTML = `<span>${esc(tl.start)}</span><span>${tl.spanDays} day span</span><span>${esc(tl.end)}</span>`;

  const gaps = tl.segments.filter((s) => s.kind === 'gap');
  $('tlGaps').innerHTML = gaps.length
    ? gaps.map((g) => `<div class="tl-gap"><span class="swatch"></span>${esc(g.label)}: no record in this extract</div>`).join('')
    : '<div class="tl-gap">Every stage in the pipeline has a record.</div>';
}

/* Expanded physical lineage. The previous expandable SVG mixed pan, zoom,
   expansion, click and hover in one surface. This view keeps one readable
   hierarchy: Heat → Slab → Plate → Dispatch, with details on every card. */
let flowCardData = new Map();

function uniqueValues(records, field, limit = 3) {
  const values = [...new Set(records.map((record) => record[field]).filter(Boolean).map(String))];
  if (!values.length) return [];
  return values.length > limit ? [...values.slice(0, limit), `+${values.length - limit} more`] : values;
}

function numericRange(records, field, unit = '') {
  const values = records.map((record) => record[field]).filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return '';
  const min = Math.min(...values), max = Math.max(...values);
  return `${num(min, 2)}${min === max ? '' : `–${num(max, 2)}`}${unit}`;
}

function stageDates(records) {
  const dates = records.map((record) => record.date).filter(Boolean).sort();
  if (!dates.length) return '';
  return dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} → ${dates[dates.length - 1]}`;
}

function stockLines(records) {
  if (!records.length) return [];
  const qty = records.reduce((sum, record) => sum + (typeof record.stockQty === 'number' ? record.stockQty : 0), 0);
  const lines = [['Stock records', String(records.length)], ['Stock quantity', `${num(qty, 3)} t`]];
  const locations = uniqueValues(records.flatMap((record) => [{ value: record.stockLocation || record.sloc || record.area }, { value: record.storageBin }, { value: record.craneArea }]), 'value');
  if (locations.length) lines.push(['Location', locations.join(', ')]);
  const aging = numericRange(records, 'agingDays', ' days');
  if (aging) lines.push(['Aging', aging]);
  const status = uniqueValues(records, 'stockStatus');
  if (status.length) lines.push(['Stock status', status.join(', ')]);
  return lines;
}

function entityCards(stageId, label, field, records, stocks = []) {
  const groups = new Map();
  const add = (record, kind) => {
    const value = record[field];
    if (!value) return;
    const identity = String(value);
    if (!groups.has(identity)) groups.set(identity, { records: [], stocks: [] });
    groups.get(identity)[kind].push(record);
  };
  records.forEach((record) => add(record, 'records'));
  stocks.forEach((record) => add(record, 'stocks'));

  return [...groups.entries()].map(([identity, group], index) => {
    const all = [...group.records, ...group.stocks];
    const tooltip = [[label + ' ID', identity], ['Production records', String(group.records.length)]];
    const dates = stageDates(group.records);
    if (dates) tooltip.push(['Date', dates]);
    const linked = field === 'heatId'
      ? uniqueValues(group.records, 'slabId')
      : field === 'slabId' ? uniqueValues(group.records, 'heatId') : uniqueValues(group.records, 'slabId');
    if (linked.length) tooltip.push([field === 'heatId' ? 'Slab IDs' : field === 'slabId' ? 'Heat IDs' : 'Slab IDs', linked.join(', ')]);
    const grade = uniqueValues(all, 'grade');
    if (grade.length) tooltip.push(['Internal grade', grade.join(', ')]);
    const thickness = numericRange(all, 'thicknessMm', ' mm');
    const width = numericRange(all, 'widthMm', ' mm');
    const length = numericRange(all, 'lengthMm', ' mm');
    if (thickness) tooltip.push(['Thickness', thickness]);
    if (width) tooltip.push(['Width', width]);
    if (length) tooltip.push(['Length', length]);
    tooltip.push(...stockLines(group.stocks));
    const stockQty = group.stocks.reduce((sum, record) => sum + (record.stockQty || 0), 0);
    return {
      id: `${stageId}:entity:${index}`,
      title: label,
      identity,
      meta: `${group.records.length.toLocaleString()} production record${group.records.length === 1 ? '' : 's'}${dates ? ` · ${dates}` : ''}`,
      stockText: group.stocks.length ? `${group.stocks.length.toLocaleString()} in stock · ${num(stockQty, 3)} t` : '',
      tooltip,
    };
  });
}

function processStageModel(plate) {
  const casting = plate.records.casting || [];
  const rolling = plate.records.rolling || [];
  const finishing = plate.records.finishing || [];
  const dispatch = plate.records.dispatch || [];
  const slabStock = plate.stocks?.slab || [];
  const plateStock = plate.stocks?.plate || [];
  const make = (id, title, records, identities, stocks = [], entitySpec = null) => {
    const dates = stageDates(records);
    const ids = identities.filter(Boolean);
    const present = records.length > 0 || stocks.length > 0;
    const tooltip = [['Stage', title]];
    if (ids.length) tooltip.push(['Physical id', ids.join(', ')]);
    tooltip.push(['Production records', String(records.length)]);
    if (dates) tooltip.push(['Date', dates]);
    const grade = uniqueValues([...records, ...stocks], 'grade');
    if (grade.length) tooltip.push(['Internal grade', grade.join(', ')]);
    const thickness = numericRange([...records, ...stocks], 'thicknessMm', ' mm');
    const width = numericRange([...records, ...stocks], 'widthMm', ' mm');
    const length = numericRange([...records, ...stocks], 'lengthMm', ' mm');
    if (thickness) tooltip.push(['Thickness', thickness]);
    if (width) tooltip.push(['Width', width]);
    if (length) tooltip.push(['Length', length]);
    tooltip.push(...stockLines(stocks));
    const entities = entitySpec ? entityCards(id, entitySpec.label, entitySpec.field, records, stocks) : [];
    return {
      id, title, present, hasStock: stocks.length > 0,
      identity: ids.join(', ') || 'No physical identifier',
      meta: dates || `${records.length.toLocaleString()} production record${records.length === 1 ? '' : 's'}`,
      stockText: stocks.length ? `${stocks.length.toLocaleString()} in stock · ${num(stocks.reduce((s, r) => s + (r.stockQty || 0), 0), 3)} t` : '',
      tooltip, entities,
    };
  };
  return [
    make('casting', 'Casting', casting, uniqueValues(casting, 'heatId'), [], { label: 'Heat', field: 'heatId' }),
    make('slab', 'Slab', [...casting, ...rolling], uniqueValues([...casting, ...rolling, ...slabStock], 'slabId'), slabStock, { label: 'Slab', field: 'slabId' }),
    make('plate', 'Plate', [...finishing, ...dispatch], uniqueValues([...finishing, ...dispatch, ...plateStock], 'batch'), plateStock, { label: 'Plate', field: 'batch' }),
    make('finishing', 'Finishing', finishing, uniqueValues(finishing, 'batch')),
    make('dispatch', 'Dispatch', dispatch, uniqueValues(dispatch, 'batch')),
  ];
}

function groupByIdentity(records, identityOf) {
  const groups = new Map();
  for (const record of records) {
    const identity = identityOf(record);
    if (!identity) continue;
    const key = String(identity);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return groups;
}

function plateIdentity(record) {
  return record.batch || (record.materialDoc ? `DOC ${record.materialDoc}` : '');
}

function makeLineageNode({ id, title, level, identity, records = [], stocks = [], detailLines = [], missing = false }) {
  const all = [...records, ...stocks];
  const dates = stageDates(all);
  const tooltip = [[`${title} ID`, identity || 'No physical identifier'], ...detailLines];
  if (dates) tooltip.push(['Date', dates]);
  const grade = uniqueValues(all, 'grade');
  if (grade.length) tooltip.push(['Internal grade', grade.join(', ')]);
  const thickness = numericRange(all, 'thicknessMm', ' mm');
  const width = numericRange(all, 'widthMm', ' mm');
  const length = numericRange(all, 'lengthMm', ' mm');
  if (thickness) tooltip.push(['Thickness', thickness]);
  if (width) tooltip.push(['Width', width]);
  if (length) tooltip.push(['Length', length]);
  tooltip.push(...stockLines(stocks));
  const stockQty = stocks.reduce((sum, record) => sum + (record.stockQty || 0), 0);
  const recordLabel = `${records.length.toLocaleString()} production record${records.length === 1 ? '' : 's'}`;
  return {
    id, title, level, identity: identity || 'No physical identifier', missing,
    records, stocks, tooltip,
    meta: dates || recordLabel,
    dateText: dates || 'Date not reported',
    stockText: stocks.length ? `${stocks.length.toLocaleString()} in stock · ${num(stockQty, 3)} t` : '',
    children: [],
  };
}

function placeholderNode(id, title, level) {
  return makeLineageNode({
    id, title, level, identity: 'No matching record', missing: true,
    detailLines: [['Production records', '0']],
  });
}

function missingPlateNode(id) {
  const node = placeholderNode(id, 'Plate', 'plate');
  node.children = [placeholderNode(`${id}:dispatch:missing`, 'Dispatch', 'dispatch')];
  return node;
}

function missingSlabNode(id) {
  const node = placeholderNode(id, 'Slab', 'slab');
  node.children = [missingPlateNode(`${id}:plate:missing`)];
  return node;
}

function processLineageModel(plate) {
  const casting = plate.records.casting || [];
  const rolling = plate.records.rolling || [];
  const finishing = plate.records.finishing || [];
  const dispatch = plate.records.dispatch || [];
  const slabStock = plate.stocks?.slab || [];
  const plateStock = plate.stocks?.plate || [];

  const slabRecords = [...casting, ...rolling];
  const slabGroups = groupByIdentity(slabRecords, (record) => record.slabId);
  const slabStockGroups = groupByIdentity(slabStock, (record) => record.slabId);
  const plateRecords = [...finishing, ...dispatch];
  const plateGroups = groupByIdentity(plateRecords, plateIdentity);
  const plateStockGroups = groupByIdentity(plateStock, plateIdentity);
  const plateIdentities = new Set([...plateGroups.keys(), ...plateStockGroups.keys()]);
  const dispatchByPlate = groupByIdentity(dispatch, (record) => record.batch);
  const assignedPlates = new Set();

  const makeDispatchNodes = (parentId, identity, records) => {
    const rows = records || dispatchByPlate.get(identity) || [];
    if (!rows.length) return [placeholderNode(`${parentId}:dispatch:missing`, 'Dispatch', 'dispatch')];
    return rows.map((record, index) => makeLineageNode({
      id: `${parentId}:dispatch:${index}`,
      title: 'Dispatch', level: 'dispatch',
      identity: record.billNo || record.vehicleNo || `Dispatch ${index + 1}`,
      records: [record],
      detailLines: [
        ['Bill no.', record.billNo || '—'],
        ['Batch', record.batch || identity || '—'],
        ['Vehicle', record.vehicleNo || '—'],
        ['Weight', typeof record.weight === 'number' ? `${num(record.weight, 3)} t` : '—'],
      ],
    }));
  };

  const makePlateNode = (identity, records, stocks, parentId) => {
    const finishingRows = records.filter((record) => record.stage === 'finishing');
    const dispatchRows = records.filter((record) => record.stage === 'dispatch');
    const node = makeLineageNode({
      id: `${parentId}:plate:${identity || 'missing'}`,
      title: 'Plate', level: 'plate', identity,
      records,
      stocks,
      detailLines: [
        ['Finishing records', String(finishingRows.length)],
        ['Dispatch records', String(dispatchRows.length)],
      ],
    });
    node.children = makeDispatchNodes(node.id, identity, dispatchRows);
    return node;
  };

  const plateForSlab = (slabId) => [...plateIdentities].filter((identity) => {
    const records = plateGroups.get(identity) || [];
    const stocks = plateStockGroups.get(identity) || [];
    const linkedSlabs = new Set([...records, ...stocks].map((record) => record.slabId).filter(Boolean).map(String));
    return linkedSlabs.has(slabId) || plateStem(identity) === slabId;
  });

  const makeSlabNode = (slabId, records, stocks, parentId) => {
    const castingRows = records.filter((record) => record.stage === 'casting');
    const rollingRows = records.filter((record) => record.stage === 'rolling');
    const node = makeLineageNode({
      id: `${parentId}:slab:${slabId}`,
      title: 'Slab', level: 'slab', identity: slabId,
      records,
      stocks,
      detailLines: [
        ['Casting records', String(castingRows.length)],
        ['Rolling records', String(rollingRows.length)],
      ],
    });
    const children = plateForSlab(slabId).map((identity) => {
      assignedPlates.add(identity);
      return makePlateNode(identity, plateGroups.get(identity) || [], plateStockGroups.get(identity) || [], node.id);
    });
    node.children = children.length ? children : [missingPlateNode(`slab:${slabId}:plate:missing`)];
    return node;
  };

  const heatGroups = groupByIdentity(casting, (record) => record.heatId);
  const assignedSlabs = new Set();
  const roots = [];
  for (const [heatId, heatRows] of heatGroups) {
    const slabIds = [...new Set(heatRows.map((record) => record.slabId).filter(Boolean).map(String))];
    const heat = makeLineageNode({
      id: `heat:${heatId}`, title: 'Heat', level: 'heat', identity: heatId,
      records: heatRows,
      detailLines: [['Slab count', String(slabIds.length)]],
    });
    heat.children = slabIds.map((slabId) => {
      assignedSlabs.add(slabId);
      return makeSlabNode(slabId, slabGroups.get(slabId) || [], slabStock.filter((record) => record.slabId === slabId), `heat:${heatId}`);
    });
    if (!heat.children.length) heat.children = [missingSlabNode(`heat:${heatId}:slab:missing` )];
    roots.push(heat);
  }

  const slabIdentities = new Set([...slabGroups.keys(), ...slabStockGroups.keys()]);
  const orphanSlabs = [...slabIdentities].filter((slabId) => !assignedSlabs.has(slabId));
  if (orphanSlabs.length || !roots.length) {
    const heat = placeholderNode('heat:unassigned', 'Heat', 'heat');
    heat.children = orphanSlabs.map((slabId) => {
      return makeSlabNode(slabId, slabGroups.get(slabId) || [], slabStockGroups.get(slabId) || [], 'heat:unassigned');
    });
    if (!heat.children.length) heat.children = [missingSlabNode('heat:unassigned:slab:missing')];
    roots.push(heat);
  }

  const orphanPlates = [...plateIdentities].filter((identity) => !assignedPlates.has(identity));
  if (orphanPlates.length) {
    let heat = roots.find((root) => root.id === 'heat:unassigned');
    if (!heat) {
      heat = placeholderNode('heat:unassigned', 'Heat', 'heat');
      heat.children = [];
      roots.push(heat);
    }
    const slab = missingSlabNode('heat:unassigned:plate-parent');
    slab.children = orphanPlates.map((identity) => makePlateNode(
      identity,
      plateGroups.get(identity) || [],
      plateStockGroups.get(identity) || [],
      slab.id,
    ));
    heat.children.push(slab);
  }

  return roots;
}

function renderLineageChart(roots = state.lineageRoots) {
  const host = $('processFlow');
  if (!host) return;
  if (!roots.length) roots = processLineageModel(state.plates.find((entry) => entry.key === state.selectedKey));
  const flat = [];
  const flatten = (node) => { flat.push(node); (node.children || []).forEach(flatten); };
  roots.forEach(flatten);
  state.lineageRoots = roots;
  flowCardData = new Map(flat.map((node) => [node.id, node]));
  const renderNode = (node, index) => `<article class="lineage-card${node.missing ? ' missing' : ''}${node.stockText ? ' has-stock' : ''}" data-flow-card="${esc(node.id)}" data-lineage-level="${node.level}" tabindex="0" role="treeitem" aria-label="${esc(node.title)}: ${esc(node.identity)}">
    <div class="lineage-card-top"><span class="lineage-level">${esc(node.title)}</span><span class="lineage-index">${String(index + 1).padStart(2, '0')}</span><span class="lineage-state" aria-hidden="true"></span></div>
    <h3>${esc(node.identity)}</h3>
    <div class="lineage-meta">${esc(node.meta)}</div>
    <div class="lineage-date">${esc(node.dateText)}</div>
    ${node.stockText ? `<div class="flow-stock-note">${esc(node.stockText)}</div>` : ''}
    ${(node.children || []).length ? `<div class="lineage-children" role="group" aria-label="${esc(node.title)} children">${node.children.map(renderNode).join('')}</div>` : ''}
  </article>`;
  host.innerHTML = `<div class="lineage-route" aria-hidden="true"><span>Heat</span><i>→</i><span>Slab</span><i>→</i><span>Plate</span><i>→</i><span>Dispatch</span></div>
    <div class="lineage-tree" role="tree" aria-label="Heat to slab to plate to dispatch lineage">${roots.map(renderNode).join('')}</div>`;
}

/* ═══════════════════ Flow chart (SVG) ═══════════════════ */

const CHART_LEVELS = [
  ['heat', 'Heat'], ['slab', 'Slab'], ['plate', 'Plate'], ['dispatch', 'Dispatch'],
];

function flattenLineage(roots) {
  const nodes = [];
  const walk = (node, parent = null) => {
    nodes.push({ node, parent });
    (node.children || []).forEach((child) => walk(child, node));
  };
  roots.forEach((root) => walk(root));
  return nodes;
}

function prepareChartData(roots) {
  state.lineageRoots = roots;
  flowCardData = new Map(flattenLineage(roots).map(({ node }) => [node.id, node]));
}

function chartNodeCard(node, className = 'flowchart-node') {
  return `<article class="${className}${node.missing ? ' missing' : ''}${node.stockText ? ' has-stock' : ''}" data-flow-card="${esc(node.id)}" tabindex="0" role="treeitem" aria-label="${esc(node.title)}: ${esc(node.identity)}"><strong>${esc(node.identity)}</strong><span>${esc(node.dateText)}</span></article>`;
}

function renderFlowchartChart(roots) {
  const host = $('processFlow');
  const byLevel = Object.fromEntries(CHART_LEVELS.map(([level]) => [level, []]));
  flattenLineage(roots).forEach(({ node }) => { if (byLevel[node.level]) byLevel[node.level].push(node); });
  let lanes = '';
  for (const [level, label] of CHART_LEVELS) {
    const nodes = byLevel[level];
    const shown = nodes.slice(0, 8);
    const more = nodes.length > shown.length ? `<div class="flowchart-more">+${nodes.length - shown.length} more units</div>` : '';
    lanes += `<section class="flowchart-lane" aria-label="${label} stage"><h3>${label} <span>(${nodes.length})</span></h3>${shown.map((node) => chartNodeCard(node)).join('')}${more}</section>`;
  }
  host.innerHTML = `<div class="flowchart-view" role="list" aria-label="Heat to dispatch flowchart">${lanes}</div>`;
}

function renderExpandableTreeChart(roots) {
  const host = $('processFlow');
  const renderNode = (node, depth = 0) => {
    const children = node.children || [];
    const classes = `${node.missing ? ' missing' : ''}${node.stockText ? ' has-stock' : ''}`;
    const content = `<strong>${esc(node.title)} · ${esc(node.identity)}</strong><span class="tree-level">${esc(node.level)}</span><small>${esc(node.dateText)}</small>`;
    if (!children.length) return `<article class="flowchart-node${classes}" data-flow-card="${esc(node.id)}" tabindex="0" role="treeitem">${content}</article>`;
    return `<details${depth < 1 ? ' open' : ''}><summary class="${classes.trim()}" data-flow-card="${esc(node.id)}" tabindex="0" role="treeitem" aria-label="${esc(node.title)}: ${esc(node.identity)}">${content}</summary><div>${children.map((child) => renderNode(child, depth + 1)).join('')}</div></details>`;
  };
  host.innerHTML = `<div class="expandable-tree" role="tree" aria-label="Expandable Heat to dispatch tree">${roots.map((root) => renderNode(root)).join('')}</div>`;
}

function renderSankeyChart(roots) {
  const host = $('processFlow');
  const all = flattenLineage(roots);
  const displayed = Object.fromEntries(CHART_LEVELS.map(([level]) => [level, all.filter(({ node }) => node.level === level).slice(0, 8)]));
  const visible = new Set(Object.values(displayed).flat().map(({ node }) => node.id));
  const width = 900;
  const columnX = [20, 240, 460, 680];
  const nodeWidth = 180;
  const nodeHeight = 42;
  const yFor = new Map();
  CHART_LEVELS.forEach(([level], column) => {
    const rows = displayed[level];
    const gap = Math.max(52, Math.min(72, 320 / Math.max(rows.length, 1)));
    rows.forEach(({ node }, index) => yFor.set(node.id, 50 + index * gap));
  });
  const links = all.filter(({ node, parent }) => parent && visible.has(node.id) && visible.has(parent.id)).map(({ node, parent }) => {
    const fromLevel = CHART_LEVELS.findIndex(([level]) => level === parent.level);
    const toLevel = CHART_LEVELS.findIndex(([level]) => level === node.level);
    if (fromLevel < 0 || toLevel < 0 || toLevel <= fromLevel) return '';
    const x1 = columnX[fromLevel] + nodeWidth;
    const x2 = columnX[toLevel];
    const y1 = yFor.get(parent.id) + nodeHeight / 2;
    const y2 = yFor.get(node.id) + nodeHeight / 2;
    const weight = Math.max(2, Math.min(12, 2 + (node.records?.length || 0)));
    return `<path class="sankey-link" stroke-width="${weight}" d="M${x1} ${y1} C${x1 + 60} ${y1},${x2 - 60} ${y2},${x2} ${y2}"/>`;
  }).join('');
  let nodes = '';
  CHART_LEVELS.forEach(([level, label], column) => {
    nodes += `<text class="sankey-label" x="${columnX[column]}" y="20">${label}</text>`;
    displayed[level].forEach(({ node }) => {
      const y = yFor.get(node.id);
      nodes += `<g class="sankey-node${node.missing ? ' missing' : ''}${node.stockText ? ' has-stock' : ''}" data-flow-card="${esc(node.id)}" tabindex="0" role="treeitem" aria-label="${esc(node.title)}: ${esc(node.identity)}"><rect x="${columnX[column]}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="10"/><text x="${columnX[column] + 10}" y="${y + 17}">${esc(truncate(node.identity, 24))}</text><text class="sankey-date" x="${columnX[column] + 10}" y="${y + 31}">${esc(node.dateText)}</text></g>`;
    });
  });
  host.innerHTML = `<div class="sankey-wrap"><svg class="sankey-svg" viewBox="0 0 ${width} 390" role="tree" aria-label="Heat to dispatch Sankey chart">${links}${nodes}</svg></div>`;
}

function renderChartMode(plate) {
  const roots = processLineageModel(plate);
  prepareChartData(roots);
  const host = $('processFlow');
  $('treeSvg').hidden = true;
  $('flowPill').hidden = true;
  host.hidden = false;
  const labels = {
    lineage: ['Lineage', 'Expanded physical lineage. Dates are displayed on every node; hover or focus a card for the full trace detail.'],
    flowchart: ['Flowchart', 'Stage lanes show the physical hand-off from Heat through Dispatch. Every unit carries its available date range.'],
    tree: ['Expandable tree', 'Open a unit only when you need its children. Dates remain visible while the hierarchy stays compact.'],
    sankey: ['Sankey', 'Connection width represents available production-record volume; dates remain attached to every displayed unit.'],
  };
  const [label, description] = labels[state.chartMode] || labels.lineage;
  $('flowLabel').textContent = `${label} · Heat → Slab → Plate → Dispatch`;
  $('chartDescription').textContent = description;
  document.querySelectorAll('[data-chart-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.chartMode === state.chartMode)));
  if (state.chartMode === 'flowchart') renderFlowchartChart(roots);
  else if (state.chartMode === 'tree') renderExpandableTreeChart(roots);
  else if (state.chartMode === 'sankey') renderSankeyChart(roots);
  else renderLineageChart(roots);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs) => {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  return el;
};

function limitFor(id) {
  return state.limitOverrides.get(id) || state.nodeLimit;
}

function renderTree() {
  const svg = $('treeSvg');
  const tree = state.tree;
  if (!svg) return;
  if (!tree) { svg.innerHTML = ''; return; }

  const layout = layoutTree(tree, state.expanded, { limit: state.nodeLimit });
  lastLayout = layout;
  svg.innerHTML = '';
  svg.setAttribute('width', layout.width);
  svg.setAttribute('height', layout.height);
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);

  // Connectors first so nodes always paint over them. The animated dash reads as
  // material flowing along the route, which is the point of the picture.
  const edgeLayer = svgEl('g', { 'aria-hidden': 'true' });
  for (const edge of layout.edges) {
    const d = elbowPath(edge);
    edgeLayer.appendChild(svgEl('path', { class: 'tree-edge-bg', d }));
    edgeLayer.appendChild(svgEl('path', { class: 'tree-edge', d }));
  }
  svg.appendChild(edgeLayer);

  for (const p of layout.positions) svg.appendChild(buildNode(p));

  // The zoom layer scales the whole drawing, so the chart can be read at a
  // comfortable size whether it is two nodes wide or two hundred.
  applyFlowTransform();
  const zoomable = layout.width > flowViewportWidth() || layout.height > flowViewportHeight();
  $('flowFullscreen').hidden = !zoomable;
  $('flowFit').hidden = !zoomable;
}

// A node is a <g> holding a focusable <rect>. Using a real focusable shape
// rather than a div means the shared theme's 3px focus ring and 44px touch
// targets apply without reimplementing them.
function buildNode(p) {
  const g = svgEl('g', {
    class: `node ${p.kind}${p.stageId ? ' ' + p.stageId : ''}${p.missing ? ' missing' : ''}`,
    tabindex: '0',
    role: 'treeitem',
    'aria-expanded': p.hasChildren ? String(p.expanded) : null,
    'aria-label': `${p.label}${p.sublabel ? ', ' + p.sublabel : ''}`,
  });
  g.dataset.id = p.id;

  g.appendChild(svgEl('rect', {
    class: 'box', x: p.x, y: p.y, width: p.w, height: p.h, rx: 7,
  }));

  if (p.kind === 'attr') {
    g.appendChild(text(p.x + 9, p.y + 17, p.label, 'key'));
    g.appendChild(text(p.x + 118, p.y + 17, truncate(p.value, 24), 'val'));
    return g;
  }

  // Chevron only where there is something to open.
  if (p.hasChildren) {
    g.appendChild(text(p.x + 9, p.y + 18, p.expanded ? '▾' : '▸', 'chev'));
  }
  // A unit id gets its kind spelled out beside it, so the lineage reads
  // "Heat ID F63910" then "Slab ID F6391001" then "Plate ID F6391001A0" without
  // the reader having to know which column each stage happens to use.
  const kindTag = p.identityKind ? p.identityKind + ' ' : '';
  const indent = p.hasChildren ? 24 : 10;
  g.appendChild(text(p.x + indent, p.y + 18, truncate(kindTag + p.label, 26), 'label'));
  // The date sits on every node, not just on hover. A lineage is a sequence in
  // time, and a chart you have to hover to learn when something happened is a
  // chart you cannot read at a glance.
  if (p.date) {
    g.appendChild(text(p.x + indent, p.y + 34, p.date, 'date'));
  }
  if (p.sublabel) {
    g.appendChild(text(p.x + p.w - 9, p.y + 18, truncate(p.sublabel, 16), 'sub', 'end'));
  }
  if (p.truncated) {
    // Be explicit that the list is cut short rather than implying this is all.
    g.appendChild(text(p.x + p.w, p.y + p.h + 13, 'list truncated — expand for all', 'sub', 'end'));
  }
  return g;
}

function text(x, y, content, cls, anchor) {
  const t = svgEl('text', { x, y, class: cls });
  if (anchor) t.setAttribute('text-anchor', anchor);
  t.textContent = content;
  return t;
}

function truncate(s, n) {
  const str = String(s == null ? '' : s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

/* ═══════════════════ Flow view: pan, zoom, fullscreen ═══════════════════
   A lineage can be two nodes wide or two hundred, so the chart pans and zooms
   rather than forcing the page to scroll sideways. The controls live in a
   floating glass pill, matching the chart's own surface, and the fullscreen
   button is the same one the SMS Heat Planner uses. */

const flow = { scale: 1, x: 0, y: 0, panning: false, startX: 0, startY: 0, originX: 0, originY: 0 };

const flowViewportWidth = () => {
  const w = $('treeWrap');
  return w ? w.clientWidth : 0;
};
const flowViewportHeight = () => {
  const w = $('treeWrap');
  return w ? w.clientHeight : 0;
};

function applyFlowTransform() {
  const svg = $('treeSvg');
  if (!svg) return;
  svg.style.transformOrigin = '0 0';
  svg.style.transform = `translate(${flow.x}px, ${flow.y}px) scale(${flow.scale})`;
  const pct = $('flowZoom');
  if (pct) pct.textContent = `${Math.round(flow.scale * 100)}%`;
}

// Fit the whole lineage into the viewport, with a margin so the first node is not
// flush against the edge. Never zooms IN past 1:1 — blowing a two-node lineage up
// to fill a wide screen makes it unreadable, not more readable.
function flowFit() {
  if (!lastLayout) return;
  const vw = flowViewportWidth();
  const vh = flowViewportHeight();
  if (!vw || !vh) return;
  const pad = 24;
  const scale = Math.min(
    (vw - pad * 2) / lastLayout.width,
    (vh - pad * 2) / lastLayout.height,
    1,
  );
  flow.scale = Math.max(0.2, scale);
  flow.x = (vw - lastLayout.width * flow.scale) / 2;
  flow.y = pad;
  applyFlowTransform();
}

function flowZoomBy(factor) {
  // Zoom about the viewport centre, so the thing you were looking at stays put
  // instead of sliding out from under the cursor.
  const vw = flowViewportWidth();
  const vh = flowViewportHeight();
  const cx = vw / 2;
  const cy = vh / 2;
  const next = Math.min(2.5, Math.max(0.2, flow.scale * factor));
  flow.x = cx - ((cx - flow.x) * next) / flow.scale;
  flow.y = cy - ((cy - flow.y) * next) / flow.scale;
  flow.scale = next;
  applyFlowTransform();
}

function flowReset() {
  flow.scale = 1;
  flow.x = 16;
  flow.y = 16;
  applyFlowTransform();
}

function toggleFullscreen() {
  const wrap = $('treeWrap');
  if (!wrap) return;
  const active = document.fullscreenElement || document.webkitFullscreenElement;
  if (!active) {
    const req = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
    if (req) req.call(wrap);
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
  }
}

// The pill is repositioned and the chart refitted when fullscreen changes,
// because the viewport is a different size on the other side of the transition.
function onFullscreenChange() {
  const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
  const btn = $('flowFullscreen');
  if (btn) {
    btn.textContent = active ? '✕ Exit' : '⛶ Fullscreen';
    btn.setAttribute('aria-pressed', String(active));
  }
  document.body.classList.toggle('flow-fullscreen', active);
  if (active) setTimeout(flowFit, 60);
  else setTimeout(() => { flowReset(); }, 60);
}

/* ═══════════════════ Tooltip ═══════════════════
   Opens on hovering a STAGE node, and only then. The chart is a lot of nodes —
   an order, four stages, and under each of those a slab or plate identifier and
   its records — and a tooltip that fired on all of them sat permanently on top
   of the thing you were trying to read. Restricting it to the stage nodes also
   makes it mean something specific: the stage summary is the only level where a
   single tooltip can describe a whole group.

   The same numbers are in the trace header above, which is plain text and
   reachable by keyboard, so nothing is lost by dropping the pin and the
   focus-triggered popup. */

let hoveredNodeId = null;
let lastLayout = null;
// A timestamp until which hover tooltips stay closed, set for a moment after a
// click so the re-render's synthetic pointerover cannot reopen one.
let suppressTipUntil = 0;

function nodeById(id) {
  const positions = lastLayout ? lastLayout.positions : [];
  return positions.find((p) => p.id === id) || null;
}

// Any node, not just the old stage ones. The lineage replaced the stage panels,
// so restricting hover to `.node.stage` would silently disable tooltips
// everywhere — that class no longer appears in this chart.
function nodeFrom(target) {
  const g = target && target.closest ? target.closest('.node') : null;
  return g || null;
}

function showTip(node, anchorRect) {
  const tip = $('tip');
  const lines = node.tooltip || [];
  const title = node.heading || (lines.length ? lines[0][1] : node.label);
  const rest = lines.slice(1);
  tip.innerHTML = `<b>${esc(title)}</b>` + (rest.length
    ? `<dl>${rest.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
    : '');
  tip.classList.add('show');
  tip.setAttribute('aria-hidden', 'false');

  // Position against the viewport, then flip if it would run off an edge.
  //
  // The clamp is against the VIEWPORT, not the document. Clamping to the
  // document width sounds safer but is the opposite: it lets the tooltip be
  // placed out in the region the page has scrolled away from, where it then
  // widens the document and creates the horizontal overflow it was meant to
  // avoid — most visibly after a resize, when the hovered node is off to one
  // side and Chromium re-fires pointerover for it.
  tip.style.left = '0px';
  tip.style.top = '0px';
  const box = tip.getBoundingClientRect();
  const minLeft = window.scrollX + 8;
  const maxLeft = Math.max(minLeft, window.scrollX + document.documentElement.clientWidth - box.width - 8);
  const left = Math.min(Math.max(anchorRect.left + window.scrollX, minLeft), maxLeft);
  let top = anchorRect.top + window.scrollY - box.height - 10;
  if (top < window.scrollY + 4) top = anchorRect.bottom + window.scrollY + 10;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

function hideTip() {
  hoveredNodeId = null;
  const tip = $('tip');
  tip.classList.remove('show');
  tip.setAttribute('aria-hidden', 'true');
}

/* ═══════════════════ Tree interaction ═══════════════════ */

function toggleNode(id) {
  if (state.expanded.has(id)) state.expanded.delete(id);
  else state.expanded.add(id);
  renderTree();
}

function nodeRectFor(g) {
  const rect = g.querySelector('.box');
  return rect ? rect.getBoundingClientRect() : g.getBoundingClientRect();
}

function wireProcessFlow() {
  const host = $('processFlow');
  if (!host) return;
  // A tooltip is positioned against the viewport that opened it. Dismiss it on
  // resize so a desktop position cannot widen a newly narrow mobile viewport.
  window.addEventListener('resize', hideTip, { passive: true });
  const open = (card) => {
    if (!card) return;
    const data = flowCardData.get(card.dataset.flowCard);
    if (!data) return;
    hoveredNodeId = data.id;
    showTip({
      label: data.title,
      heading: card.dataset.flowCard ? `${data.title} ID · ${data.identity}` : undefined,
      tooltip: data.tooltip,
    }, card.getBoundingClientRect());
  };
  host.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const card = event.target.closest('[data-flow-card]');
    const from = event.relatedTarget?.closest?.('[data-flow-card]');
    if (card && card !== from) open(card);
  });
  host.addEventListener('pointerout', (event) => {
    if (event.pointerType === 'touch') return;
    const from = event.target.closest('[data-flow-card]');
    const to = event.relatedTarget?.closest?.('[data-flow-card]');
    if (from && to && from.contains(to)) return;
    if (from && from !== to) hideTip();
  });
  host.addEventListener('focusin', (event) => open(event.target.closest('[data-flow-card]')));
  host.addEventListener('focusout', (event) => {
    if (!event.relatedTarget?.closest?.('[data-flow-card]')) hideTip();
  });
  host.addEventListener('keydown', (event) => {
    const card = event.target.closest('[data-flow-card]');
    if (!card || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const cards = [...host.querySelectorAll('[data-flow-card]')];
    const at = cards.indexOf(card);
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    cards[Math.min(cards.length - 1, Math.max(0, at + delta))].focus();
  });
}

function wireTree() {
  const svg = $('treeSvg');
  const wrap = $('treeWrap');

  // Click only expands or collapses. It deliberately does NOT open a tooltip —
  // that is what left popups stranded over the chart after every click.
  svg.addEventListener('click', (e) => {
    const g = e.target.closest('.node');
    if (!g) return;
    // A click is a deliberate act on the node, so any tooltip the pointer
    // happened to open on the way there is dismissed. Otherwise the popup sits on
    // top of the very thing the reader just asked to open.
    //
    // Toggling re-renders the SVG, and Chromium re-fires pointerover for the
    // element now under the cursor — which would reopen the tooltip instantly.
    // The hold is what actually keeps it closed for that gesture.
    suppressTipUntil = Date.now() + 400;
    hideTip();
    if (g.getAttribute('aria-expanded') !== null) toggleNode(g.dataset.id);
  });

  // Hover opens a tooltip on EVERY node, not only the old stage nodes. The
  // lineage is small — an order, its heats, their slabs, their plates, their
  // dispatches — so a tooltip per node is affordable, and it is the only way to
  // read a record's characteristics without expanding it. Every tooltip carries
  // a date, so hovering is never a dead end.
  svg.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    if (Date.now() < suppressTipUntil) return;
    const g = nodeFrom(e.target);
    if (!g || hoveredNodeId === g.dataset.id) return;
    const node = nodeById(g.dataset.id);
    if (!node || !node.tooltip) return;
    hoveredNodeId = g.dataset.id;
    showTip(node, nodeRectFor(g));
  });

  svg.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    const to = nodeFrom(e.relatedTarget);
    if (to && to.dataset.id === hoveredNodeId) return;
    hideTip();
  });

  // Keyboard: focus and arrows still walk the chart so it is navigable without
  // a mouse, but focusing a node does not throw a popup over it.
  svg.addEventListener('keydown', (e) => {
    const g = e.target.closest('.node');
    if (!g) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (g.getAttribute('aria-expanded') !== null) toggleNode(g.dataset.id);
      focusNode(g.dataset.id);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const open = g.getAttribute('aria-expanded') === 'true';
      if (e.key === 'ArrowRight' && !open && g.getAttribute('aria-expanded') !== null) {
        toggleNode(g.dataset.id);
        focusNode(g.dataset.id);
      } else {
        stepFocus(e.key === 'ArrowRight' ? 1 : -1);
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      stepFocus(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Escape') {
      hideTip();
    }
  });

  // Scrolling or resizing moves the box out from under a hover tooltip, so it
  // is dismissed rather than left pointing at empty space.
  wrap.addEventListener('scroll', hideTip);
  window.addEventListener('resize', hideTip);

  /* ── Pan and zoom ──
     Dragging empty canvas pans. The chart is a fixed-size drawing inside a
     viewport, so without this a wide lineage is only reachable by scrolling the
     whole page sideways, which drags the trace header and timeline along with it.
     Pointer events cover mouse, pen and touch in one path. */
  wrap.addEventListener('pointerdown', (e) => {
    // A press that starts on a node belongs to the node: it is a click, not a pan.
    // The same goes for the control pill — without this, pointer capture below
    // swallows every click on the zoom and fullscreen buttons.
    if (e.target.closest('.node, .flow-pill, button')) return;
    flow.panning = true;
    flow.startX = e.clientX;
    flow.startY = e.clientY;
    flow.originX = flow.x;
    flow.originY = flow.y;
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add('panning');
    hideTip();
  });

  wrap.addEventListener('pointermove', (e) => {
    if (!flow.panning) return;
    flow.x = flow.originX + (e.clientX - flow.startX);
    flow.y = flow.originY + (e.clientY - flow.startY);
    applyFlowTransform();
  });

  const endPan = (e) => {
    if (!flow.panning) return;
    flow.panning = false;
    wrap.classList.remove('panning');
    try { wrap.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  wrap.addEventListener('pointerup', endPan);
  wrap.addEventListener('pointercancel', endPan);

  // Ctrl+wheel zooms, the convention every diagram tool uses. A plain wheel keeps
  // scrolling the page, so the page never feels stuck under the cursor.
  wrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    flowZoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });

  $('flowZoomIn').addEventListener('click', () => flowZoomBy(1.15));
  $('flowZoomOut').addEventListener('click', () => flowZoomBy(1 / 1.15));
  $('flowFit').addEventListener('click', flowFit);
  $('flowReset').addEventListener('click', flowReset);
  $('flowFullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  // Escape leaves fullscreen, which fires the change event; nothing extra needed.
}

/* ═══════════════════ Controls + boot ═══════════════════ */

function wireControls() {
  const dropAll = $('dropAll');
  dropAll.addEventListener('dragover', (e) => { e.preventDefault(); dropAll.classList.add('drag'); });
  dropAll.addEventListener('dragleave', () => dropAll.classList.remove('drag'));
  dropAll.addEventListener('drop', (e) => {
    e.preventDefault();
    dropAll.classList.remove('drag');
    const files = [...e.dataTransfer.files].filter((f) => /\.(xlsx|xls)$/i.test(f.name));
    if (!files.length) {
      $('linkReport').hidden = false;
      $('linkReport').textContent = 'Only .xlsx and .xls files can be read.';
      return;
    }
    ingest(files);
  });
  // A drop anywhere on the page catches a file released outside the zones.
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (e.target.closest('.slot, .drop-all')) return;
    e.preventDefault();
    const files = [...(e.dataTransfer.files || [])].filter((f) => /\.(xlsx|xls)$/i.test(f.name));
    if (files.length) ingest(files);
  });

  $('searchBtn').addEventListener('click', refresh);
  $('q').addEventListener('input', renderCrossFilteredViews);
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') refresh(); });
  $('from').addEventListener('change', refresh);
  $('to').addEventListener('change', refresh);
  $('clearSlicersBtn').addEventListener('click', () => {
    state.slicers = {};
    refresh();
  });

  document.querySelectorAll('#viewSwitch [data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view === 'stock' ? 'stock' : 'orders';
      state.stageFilter = [];
      state.slicers = {};
      hideTip();
      refresh();
    });
  });

  document.querySelectorAll('[data-chart-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.chartMode;
      if (!['lineage', 'flowchart', 'tree', 'sankey'].includes(mode)) return;
      state.chartMode = mode;
      const plate = state.plates.find((entry) => entry.key === state.selectedKey);
      if (plate) renderChartMode(plate);
    });
  });

  $('resetBtn').addEventListener('click', () => {
    $('q').value = '';
    $('from').value = '';
    $('to').value = '';
    state.stageFilter = [];
    state.slicers = {};
    state.crossFilter = { orders: 'all', stock: 'all' };
    state.selectedKey = null;
    $('detail').hidden = true;
    hideTip();
    refresh();
  });

  $('expandAllBtn').addEventListener('click', () => {
    if (!state.tree) return;
    // Open the lineage down to the units, but NOT the records under them. A plate
    // can carry thousands of dispatch rows and the browser should not be asked to
    // draw them all unprompted; the unit nodes are what the chart is for.
    state.limitOverrides.clear();
    state.expanded = new Set();
    const open = (node) => {
      if (node.kind === 'record' || node.kind === 'attribute') return;
      state.expanded.add(node.id);
      for (const child of node.children || []) open(child);
    };
    open(state.tree);
    renderTree();
    flowFit();
  });

  $('collapseAllBtn').addEventListener('click', () => {
    if (!state.tree) return;
    // Back to the default lineage view, so collapsing still leaves the whole route
    // visible rather than a lone order node.
    state.expanded = defaultExpandedIds(state.tree, { spine: state.spine });
    state.limitOverrides.clear();
    renderTree();
    flowFit();
  });

  // The four-stage side-by-side layout is gone. The chart is always the lineage
  // now, so there is no toggle to keep in sync — which removes a whole class of
  // bug where the button, the label and the tree disagreed about the shape.

  $('clearBtn').addEventListener('click', async () => {
    await idbClear();
    // The worker holds the parsed records, so it has to be emptied too or the
    // next upload would re-index data the user just discarded.
    if (worker) worker.postMessage({ type: 'reset', id: ++jobId });
    state.plates = [];
    state.stocks = { slab: [], plate: [] };
    state.loaded = {};
    state.crossFilter = { orders: 'all', stock: 'all' };
    state.selectedKey = null;
    $('detail').hidden = true;
    $('cacheChip').style.display = 'none';
    $('clearBtn').disabled = true;
    setDataStatus(0, {});
    $('linkReport').hidden = true;
    hideTip();
    renderSlots();
    refresh();
  });
}

function focusNode(id) {
  const el = $('treeSvg').querySelector(`.node[data-id="${CSS.escape(id)}"]`);
  if (el) el.focus();
}

function stepFocus(delta) {
  const nodes = [...$('treeSvg').querySelectorAll('.node')];
  if (!nodes.length) return;
  const at = nodes.indexOf(document.activeElement);
  const next = Math.min(nodes.length - 1, Math.max(0, (at === -1 ? 0 : at) + delta));
  nodes[next].focus();
}

function selectPlate(key) {
  state.selectedKey = key;
  const plate = state.plates.find((p) => p.key === key);
  if (!plate) return;
  $('detail').hidden = false;
  renderDetail(plate);
  renderTable();
  $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Surfaces what the join actually achieved. A partial extract is useful, but
// only if the user can see which stages came back thin.
function renderLinkReport() {
  const host = $('linkReport');
  const stages = STAGE_IDS.filter((id) => state.loaded[id]);
  if (!Object.keys(state.loaded).length) { host.hidden = true; return; }
  const summary = summarise(state.plates);
  const bits = [`Indexed ${summary.total.toLocaleString()} plates from ${stages.length} of 4 stage files.`];
  for (const id of STAGE_IDS) {
    if (!state.loaded[id]) { bits.push(`${STAGE_LABEL[id]}: not loaded`); continue; }
    const n = summary.byStage[id];
    const share = summary.total ? Math.round((n / summary.total) * 100) : 0;
    // Rows that carried real production data but no SO + line item. They cannot
    // be placed in an order-keyed trace at all, so saying nothing would quietly
    // imply the extract holds no more than is shown.
    const dropped = state.loaded[id].dropped || 0;
    const split = state.loaded[id].splitFrom || 0;
    let line = `${STAGE_LABEL[id]}: ${n.toLocaleString()} plates (${share}%)`;
    if (split) line += `, ${split.toLocaleString()} rows expanded`;
    if (dropped) line += `, ${dropped.toLocaleString()} rows with no SO + line item`;
    bits.push(line);
  }
  const missing = STAGE_IDS.filter((id) => !state.loaded[id]);
  if (missing.length) {
    bits.push(`No ${missing.map((m) => STAGE_LABEL[m]).join(' or ')} file loaded — those stages will show as gaps.`);
  }
  // EBTP is the order book rather than a fifth stage, so it gets its own line:
  // it decides which orders are listed, and an order with no production record
  // yet is normal rather than a gap.
  if (state.loaded.ebtp) {
    const booked = state.plates.filter((p) => (p.orders || []).length > 0).length;
    const unstarted = state.plates.filter((p) => p.presentStages === 0).length;
    bits.push(`EBTP order book: ${booked.toLocaleString()} orders, ${unstarted.toLocaleString()} not yet in any stage.`);
  } else {
    bits.push('EBTP order book not loaded — the list shows production records only, so booked-but-unstarted orders are missing.');
  }
  for (const [sourceId, kind] of [['slabStock', 'slab'], ['plateStock', 'plate']]) {
    if (!state.loaded[sourceId]) continue;
    const rows = state.stocks[kind] || [];
    const linked = rows.filter((record) => record.linkedKeys?.length).length;
    const qty = rows.reduce((sum, record) => sum + (typeof record.stockQty === 'number' ? record.stockQty : 0), 0);
    bits.push(`${SOURCES[sourceId].label}: ${rows.length.toLocaleString()} records, ${num(qty, 2)} t, ${linked.toLocaleString()} linked to a trace.`);
  }
  host.hidden = false;
  host.textContent = bits.join(' · ');
}

function setDataStatus(plates, loaded) {
  const count = Object.keys(loaded || {}).length;
  const el = $('dataStatus');
  el.classList.toggle('live', plates > 0 || count > 0);
  $('dataStatusText').textContent = plates || count
    ? `${plates.toLocaleString()} orders · ${count} file${count === 1 ? '' : 's'}`
    : 'No data loaded';
}

async function restoreCache() {
  const cached = await idbGet();
  if (!cached || !Array.isArray(cached.plates) || !cached.plates.length) return false;
  state.plates = cached.plates;
  state.stocks = cached.stocks || { slab: [], plate: [] };
  state.loaded = cached.loaded || {};
  renderSlots();
  renderLinkReport();
  setDataStatus(state.plates.length, state.loaded);
  // The facet values are derived, never cached — counting them again is cheap
  // next to re-parsing the workbooks.
  buildSlicerOptions();
  refresh();
  const when = cached.savedAt ? new Date(cached.savedAt).toLocaleString() : 'earlier';
  const chip = $('cacheChip');
  chip.style.display = '';
  chip.textContent = `Using cached data from ${when}`;
  $('clearBtn').disabled = false;
  return true;
}

function init() {
  window.__plateTrackerReady = true;
  renderSlots();
  wireControls();
  wireProcessFlow();
  refresh();
  restoreCache().then((restored) => {
    if (!restored) setDataStatus(0, {});
  });
  // The hub (index.html) mounts its controls and pushes theme into this page.
  try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'ready' }, '*'); } catch {}
}

/* ═══════════════════ Start ═══════════════════ */

// Boot last, once the whole module has evaluated. Every handler above
// references functions declared alongside it, and starting earlier would run
// against a half-initialised page.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
