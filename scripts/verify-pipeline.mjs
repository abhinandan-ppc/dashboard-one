// End-to-end check of the Plate Tracker pipeline against the REAL workbooks in
// sheets/. This is the test that matters: it proves the column maps, the unit
// conversion and the SO+LineItem join actually work on production data, not
// just on the hand-written fixtures in plate-tracker.test.mjs.
//
//   node scripts/verify-pipeline.mjs
//
// Uses the vendored SheetJS in plate-tracker-xlsx.js, so it exercises the same
// parser the browser runs.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// The vendored bundle is a classic script that assigns a global; load it here.
const globalScope = {};
new Function('self', 'window', 'globalThis', readFileSync('plate-tracker-xlsx.js', 'utf8'))
  .call(globalScope, globalScope, globalScope, globalScope);
const XLSX = globalScope.XLSX || globalThis.XLSX;

const { SOURCES, resolveColumns, isSourceAcceptable, rowToRecords, buildIndex, buildTimeline } =
  await import('../plate-tracker-core.mjs');

const FILES = {
  casting: ['sheets/CASTING DATA.xlsx', '2026'],
  rolling: ['sheets/ROLLING DATA.xlsx', 'RECONCILE'],
  finishing: ['sheets/FG DATA.xlsx', null],
  dispatch: ['sheets/DISPATCH DATA.xlsx', null],
  ebtp: ['sheets/EBTP.xlsx', 'WS'],
};

function rowsOf(path, preferred) {
  const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true });
  const names = preferred && wb.SheetNames.includes(preferred) ? [preferred] : wb.SheetNames;
  let best = null;
  for (const name of names) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    if (!best || rows.length > best.rows.length) best = { name, rows };
  }
  return best;
}

const norm = (h) => String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
const byStage = {};
const report = {};

for (const [id, [path, sheet]] of Object.entries(FILES)) {
  if (!existsSync(path)) { console.log(`skip  ${id} (${path} not present)`); continue; }
  const { name, rows } = rowsOf(path, sheet);
  const headers = rows[0].map((h) => String(h == null ? '' : h).trim());
  const { mapping, missing, matched } = resolveColumns(headers, id);
  if (!isSourceAcceptable({ mapping, missing, matched })) {
    console.log(`FAIL  ${id}: missing ${missing.filter((m) => m.required).map((m) => m.header).join(', ')}`);
    continue;
  }
  const index = new Map(headers.map((h, i) => [h, i]));
  const records = [];
  // Rows that expanded into more than one record, reported so a rising record
  // count is explainable rather than mysterious. `dropped` is the opposite: rows
  // that yielded no usable key, which must never be silently invisible.
  let split = 0;
  let dropped = 0;
  for (let r = 1; r < rows.length; r += 1) {
    const raw = rows[r];
    if (!Array.isArray(raw) || !raw.some((c) => c !== '' && c !== null)) continue;
    const row = {};
    for (const [field, header] of Object.entries(mapping)) {
      const i = index.get(header);
      row[header] = i === undefined ? undefined : raw[i];
    }
    // rowToRecords, not rowToRecord: a clubbed casting/rolling row stands for
    // several orders, and taking only the first would hide two thirds of them.
    const built = rowToRecords(row, id, mapping);
    for (const rec of built) records.push(rec);
    if (built.length > 1) split += 1;
    if (!built.length) dropped += 1;
  }
  byStage[id] = records;
  report[id] = { sheet: name, rows: rows.length, records: records.length, matched, missing: missing.length, split, dropped };
  const splitNote = split ? ` split=${split}` : '';
  const dropNote = dropped ? ` DROPPED=${dropped}` : '';
  console.log(`ok    ${id.padEnd(10)} sheet="${name}" rows=${rows.length} records=${records.length} fields=${matched} unmapped=${missing.length}${splitNote}${dropNote}`);
}

const { list } = buildIndex(byStage);
console.log(`\nplates indexed: ${list.length}`);

const all4 = list.filter((p) => p.complete);
console.log(`plates present in all four stages: ${all4.length}`);
const withAny = list.filter((p) => p.presentStages >= 2);
console.log(`plates present in two or more stages: ${withAny.length}`);

// EBTP seeds the index, so orders with no production record at all are present.
// These are the ones the old stage-only build dropped entirely.
const bookedOnly = list.filter((p) => p.presentStages === 0);
const fromEbtp = list.filter((p) => (p.orders || []).length > 0);
console.log(`orders from the EBTP book: ${fromEbtp.length} of ${list.length}`);
console.log(`booked but not yet in any stage: ${bookedOnly.length}`);
const bal = bookedOnly.reduce((a, p) => a + (p.balanceToDeliver || 0), 0);
console.log(`  balance to deliver on those: ${bal.toFixed(2)} t`);

// Any surviving "//" in an identifier would mean the split did not run.
const clubbed = list.filter((p) => p.so.includes('//') || String(p.lineItem).includes('//'));
console.log(`plates whose identifiers still contain "//": ${clubbed.length}`);

for (const id of ['casting', 'rolling', 'finishing', 'dispatch']) {
  const n = list.filter((p) => p.stages[id].present).length;
  console.log(`  ${id.padEnd(10)} ${n}`);
}

// Spot-check a fully linked plate end to end.
const sample = all4[0];
if (sample) {
  console.log(`\nsample plate ${sample.so}/${sample.lineItem}`);
  console.log(`  grade=${sample.grade} customer=${sample.customer} weight=${sample.weight}t lead=${sample.leadTimeDays}d conf=${sample.linkConfidence}`);
  const tl = buildTimeline(sample);
  console.log(`  timeline ${tl.start} .. ${tl.end} (${tl.spanDays}d)`);
  for (const s of tl.segments) {
    console.log(`    ${s.stageId.padEnd(10)} ${s.kind === 'gap' ? 'NO RECORD' : `${s.start} .. ${s.end} (${s.count} rec)`}`);
  }
}
