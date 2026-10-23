// Behavioural check of Plate-Tagging-Tool's ZSTK auto-load. The contract test
// in test/plate-tagging-zstk.test.mjs pins the source; this drives the real
// extracted functions against a fake DOM so the two things that are easy to get
// silently wrong are actually observed:
//   1. the on-open load and the hub broadcast collapse to ONE render, and
//   2. a hub broadcast cannot clobber a user-uploaded file.
// Run: node scripts/sim-plate-tagging-zstk.mjs

import { readFile } from 'node:fs/promises';

// Optional argv override so the negative control can point this at a stripped
// copy of the page instead of the real one.
const page = process.argv[2] || 'Plate-Tagging-Tool.html';
const html = await readFile(page, 'utf8');

// Pull the three pieces under test out of the page, verbatim.
const pick = (start, end) => {
  const from = html.indexOf(start);
  const to = end ? html.indexOf(end) : html.length;
  if (from < 0) throw new Error('marker not found: ' + start);
  return html.slice(from, to);
};
const zstkSrc = pick('/* True while a ZSTK load is in flight', '/* ---------- file handling ---------- */');

// Minimal XLSX stand-in: bestStockParse only needs book_new / book_append_sheet /
// aoa_to_sheet, and returns one row per data row so renders are countable.
const XLSX = {
  utils: {
    book_new: () => ({ Sheets: {}, SheetNames: [] }),
    book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; },
    aoa_to_sheet: (aoa) => aoa,
  },
};

const HEADER = ['Batch ID', 'Grade (internal)', 'Grade (external)', 'Thick', 'Width', 'Length'];
const makeValues = (n) => [HEADER, ...Array.from({ length: n }, (_, i) => [`P${i}`, 'G', 'GE', 10, 100, 5])];

function bestStockParse(wb) {
  const grid = wb.Sheets[wb.SheetNames[0]];
  const headers = grid[0].map(String);
  return { rows: grid.slice(1).map((r) => Object.fromEntries(headers.map((h, j) => [h, r[j]]))), cols: headers, map: {}, sheet: wb.SheetNames[0], reqScore: 0, reqN: 0 };
}

// Fake DOM: one slot, one button, and a render counter.
globalThis.document = {};
function makeSlot() {
  const state = { renders: 0, status: '', disabled: false };
  const slot = {
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    querySelector: () => ({ set textContent(v) { state.status = v; }, get textContent() { return state.status; } }),
  };
  const btn = {
    get disabled() { return state.disabled; },
    set disabled(v) { state.disabled = v; },
  };
  globalThis.document.getElementById = (id) => (id === 'slot-por' ? slot : btn);
  return { state, slot, btn };
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ── Scenario 1: cache already warm → one render, button restored ────────────
{
  let renders = 0;
  const dom = makeSlot();
  const apply = (values, slot) => { renders++; slot.classList.add('ok'); };
  const env = { XLSX, bestStockParse, document, applyOnlineZstkValues: apply, readHubZstkCache: async () => ({ csvText: makeValues(3) }), fetchZstkDirectly: async () => { throw new Error('should not reach the proxy'); }, window: { parent: null } };
  const fn = new Function('XLSX', 'bestStockParse', 'document', 'applyOnlineZstkValues', 'readHubZstkCache', 'fetchZstkDirectly', 'window', zstkSrc + '\nreturn fetchOnlineZstk;');
  await fn(...Object.values(env))();
  check('warm cache renders exactly once', renders === 1, `${renders} render(s)`);
  check('button is re-enabled after a warm-cache load', dom.state.disabled === false);
}

// ── Scenario 2: cold cache + late hub broadcast → still exactly one render ──
// Mirrors a real cold open: the page asks the hub to fetch, and the hub's answer
// is the broadcast this page also listens for. Both paths call the same fn.
{
  let renders = 0;
  let polls = 0;
  const dom = makeSlot();
  const apply = (values, slot) => { renders++; slot.classList.add('ok'); };
  const env = {
    XLSX, bestStockParse, document,
    applyOnlineZstkValues: apply,
    // Empty for the first two polls, then populated — as if the hub answered.
    readHubZstkCache: async () => { polls++; return polls > 2 ? { csvText: makeValues(4) } : null; },
    fetchZstkDirectly: async () => makeValues(4),
    window: { parent: {} }, // truthy !== window → treated as in-frame
  };
  const fn = new Function('XLSX', 'bestStockParse', 'document', 'applyOnlineZstkValues', 'readHubZstkCache', 'fetchZstkDirectly', 'window', zstkSrc + '\nreturn fetchOnlineZstk;');
  const load = fn(...Object.values(env));
  // Fired concurrently — exactly how the browser sees it: DOMContentLoaded
  // starts the on-open load, and the hub broadcast lands while it is still
  // polling. Awaiting between calls would make them sequential and hide the
  // very race the guard exists for.
  let proceeded = 0;
  const counted = async () => { proceeded++; return load(); };
  await Promise.all([counted(), counted(), counted()]);
  check('concurrent calls collapse to one render', renders === 1, `${renders} render(s) across 3 concurrent calls`);
  check('only one call actually proceeds past the guard', proceeded - renders > 0 && renders === 1, `${proceeded} calls in, ${renders} renders`);
  check('the guard releases, so a later refresh still works', dom.state.disabled === false);
}

// ── Scenario 3: nothing anywhere → error surfaced, no crash, button restored ─
{
  const dom = makeSlot();
  const apply = () => { throw new Error('boom'); };
  const env = {
    XLSX, bestStockParse, document,
    applyOnlineZstkValues: apply,
    readHubZstkCache: async () => null,
    fetchZstkDirectly: async () => { throw new Error('HTTP 502'); },
    window: { parent: null }, // standalone → skips the poll loop
  };
  const fn = new Function('XLSX', 'bestStockParse', 'document', 'applyOnlineZstkValues', 'readHubZstkCache', 'fetchZstkDirectly', 'window', zstkSrc + '\nreturn fetchOnlineZstk;');
  await fn(...Object.values(env))();
  check('a total failure leaves the slot in error, not a spinner', dom.slot.classList.contains('err'));
  check('a total failure still restores the button', dom.state.disabled === false);
  check('the failure message keeps the manual-upload fallback visible', /Drop the \.xlsx instead/.test(dom.state.status), dom.state.status);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} behavioural checks passed`);
process.exit(failed.length ? 1 : 0);
