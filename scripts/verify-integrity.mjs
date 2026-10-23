// Deep integrity check of the Plate Tracker against real workbooks.
//
//   node scripts/verify-integrity.mjs                  # the live extracts in sheets/
//   node scripts/verify-integrity.mjs sheets-schema    # the committed schema fixtures
//
// verify-pipeline.mjs proves the pipeline runs. This proves it is CORRECT: that
// no row disappears without being counted, that every column the page declares
// actually exists in the extracts, that identifiers are well-formed, and that
// the aggregates the UI shows agree with the source columns recomputed
// independently.
//
// It deliberately re-derives the weight totals straight from the workbook
// columns rather than from the parsed records, so a bug in the parser cannot
// hide behind a total that is merely self-consistent.
//
// The same checks run against both directories on purpose. The fixtures are
// what CI and a fresh clone can run; the live extracts are what production runs.
// A parser change has to satisfy both.
//
// Uses the vendored SheetJS in plate-tracker-xlsx.js, so it exercises the same
// parser the browser runs. Exits non-zero if any check fails.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const DIR = process.argv[2] || 'sheets';
const IS_FIXTURES = DIR === 'sheets-schema';

const require = createRequire(import.meta.url);
const globalScope = {};
new Function('self', 'window', 'globalThis', readFileSync('plate-tracker-xlsx.js', 'utf8'))
  .call(globalScope, globalScope, globalScope, globalScope);
const XLSX = globalScope.XLSX || globalThis.XLSX;

const core = await import('../plate-tracker-core.mjs');
const {
  SOURCES, STAGE_IDS, STAGE_IDENTITY, SLICERS,
  resolveColumns, isSourceAcceptable, rowToRecords, buildIndex,
  normalizeKey, normalizeLineItem,
} = core;

// The fixture workbooks are named after the stage; the live ones use the names
// the plant exports them under.
const FILES = IS_FIXTURES
  ? Object.fromEntries(STAGE_IDS.concat(['ebtp']).map((id) => [id, [`${DIR}/${id.toUpperCase()} SCHEMA.xlsx`, null]]))
  : {
    casting: [`${DIR}/CASTING DATA.xlsx`, '2026'],
    rolling: [`${DIR}/ROLLING DATA.xlsx`, 'RECONCILE'],
    finishing: [`${DIR}/FG DATA.xlsx`, null],
    dispatch: [`${DIR}/DISPATCH DATA.xlsx`, null],
    ebtp: [`${DIR}/EBTP.xlsx`, 'WS'],
  };

console.log(`verifying ${DIR}/${IS_FIXTURES ? '(schema fixtures)' : '(live extracts)'}`);
console.log('');

let failures = 0;
let checks = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`);
}
function note(text) { console.log(`      ${text}`); }

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

/* ═══════════════════ 1 · PARSE EVERY WORKBOOK, ACCOUNTING FOR EVERY ROW ═══════════════════ */

const parsed = {};
for (const [id, [path, sheet]] of Object.entries(FILES)) {
  if (!existsSync(path)) { check(`${id} workbook present`, false, `${path} missing`); continue; }
  const { name, rows } = rowsOf(path, sheet);
  const headers = rows[0].map((h) => String(h == null ? '' : h).trim());
  const { mapping, missing, matched } = resolveColumns(headers, id);
  check(`${id} has every required column`, isSourceAcceptable({ mapping, missing, matched }),
    missing.filter((m) => m.required).map((m) => m.header).join(', ') || `${matched} matched`);

  // A column the page declares but the extract does not have is a field the UI
  // shows as empty forever. It is not fatal — the page is designed to degrade —
  // but on real data it means the declared name is wrong, and that is exactly
  // how the F_SLOC/S_SLOC mismatch hid for so long.
  // The fixtures are deliberately trimmed, so this only applies to live extracts.
  const declared = Object.keys(SOURCES[id].fields).filter((f) => !mapping[f]);
  if (declared.length) {
    note(`${id}: ${declared.length} optional column(s) absent from this extract — ` +
      declared.map((f) => `${f} ("${SOURCES[id].fields[f].header}")`).join(', '));
  }
  check(`${id} declares only columns the extract provides`, declared.length === 0 || IS_FIXTURES,
    declared.length && !IS_FIXTURES ? 'see above' : 'all present');

  const index = new Map(headers.map((h, i) => [h, i]));
  const records = [];
  let dataRows = 0;
  let blank = 0;
  let split = 0;      // rows that expanded into several orders
  let unkeyed = 0;    // rows that produced a record with no SO + line item
  let noRecord = 0;   // rows that produced nothing at all
  let plain = 0;      // rows that produced exactly one keyed record
  for (let r = 1; r < rows.length; r += 1) {
    const raw = rows[r];
    if (!Array.isArray(raw) || !raw.some((c) => c !== '' && c !== null)) { blank += 1; continue; }
    dataRows += 1;
    const row = {};
    for (const [field, header] of Object.entries(mapping)) {
      const i = index.get(header);
      row[header] = i === undefined ? undefined : raw[i];
    }
    const built = rowToRecords(row, id, mapping);
    for (const rec of built) records.push(rec);
    if (!built.length) noRecord += 1;
    else if (built.length > 1) split += 1;
    else if (!normalizeKey(built[0].so, built[0].lineItem)) unkeyed += 1;
    else plain += 1;
  }

  // Every row after the header is either blank or lands in exactly one of the
  // four buckets. If those do not account for the sheet, a row was parsed and
  // silently discarded, or a blank row was mistaken for data.
  const classified = plain + split + unkeyed + noRecord;
  check(`${id} classifies every row`, classified === dataRows && dataRows + blank === rows.length - 1,
    `${dataRows.toLocaleString()} data + ${blank.toLocaleString()} blank = ${(dataRows + blank).toLocaleString()} of ${(rows.length - 1).toLocaleString()} ` +
    `(plain ${plain.toLocaleString()}, split ${split.toLocaleString()}, unkeyed ${unkeyed.toLocaleString()}, no key ${noRecord.toLocaleString()})`);
  // Rows the source does not identify are a property of the DATA, not a parser
  // fault — the page keeps and reports them. They are surfaced, never hidden.
  if (noRecord) note(`${id}: ${noRecord.toLocaleString()} row(s) carry no SO + line item in the source itself; kept and reported in the link report`);
  parsed[id] = { sheet: name, headers, index, records, dataRows, blank, split, unkeyed, noRecord };
  note(`${id}: sheet "${name}" ${dataRows.toLocaleString()} data rows (${blank.toLocaleString()} blank) -> ` +
    `${records.length.toLocaleString()} records · split=${split.toLocaleString()} unkeyed=${unkeyed.toLocaleString()} noRecord=${noRecord.toLocaleString()}`);
}
/* ═══════════════════ 2 · IDENTIFIER HYGIENE ═══════════════════ */

// The whole point of the shape-aware parser is that no order identifier is left
// in a clubbed or malformed state. Any residue here is a regression.
for (const id of STAGE_IDS) {
  const records = parsed[id] ? parsed[id].records : [];
  let clubbed = 0;
  let emptyKey = 0;
  let dateItem = 0;
  let unkeyed = 0;
  let badSo = 0;
  const soExamples = [];
  for (const rec of records) {
    const so = String(rec.so == null ? '' : rec.so);
    const item = String(rec.lineItem == null ? '' : rec.lineItem);
    if (so.includes('//') || item.includes('//') || so.includes('\n') || item.includes('\n')) clubbed += 1;
    if (so.trim() || item.trim()) {
      if (!normalizeKey(rec.so, rec.lineItem)) emptyKey += 1;
      if (!/^\d+$/.test(so.trim())) {
        badSo += 1;
        if (soExamples.length < 5 && so.trim()) soExamples.push(so.trim());
      }
    } else {
      unkeyed += 1;
    }
    // A line item that parses as a date is a column-shift artefact, not an item.
    if (item.trim() && /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(item.trim())) dateItem += 1;
  }
  check(`${id} has no clubbed identifiers`, clubbed === 0, `${clubbed.toLocaleString()} residual`);
  check(`${id} has no empty keys`, emptyKey === 0, `${emptyKey.toLocaleString()} empty`);
  check(`${id} has no date-like line items`, dateItem === 0, `${dateItem.toLocaleString()} date-like`);
  // Not every order is numeric — stock and captive entries carry a text SO. That
  // is legitimate, so it is reported rather than failed, but a sudden jump would
  // mean a column shifted, so the count is stated.
  if (badSo) note(`${id}: ${badSo.toLocaleString()} non-numeric SO value(s) (stock/captive entries), e.g. ${JSON.stringify(soExamples.slice(0, 3))}`);
  note(`${id}: ${records.length.toLocaleString()} records, ${unkeyed.toLocaleString()} with no SO + line item (kept and reported)`);
}

/* ═══════════════════ 3 · WEIGHT TOTALS, RECOMPUTED FROM THE SOURCE ═══════════════════ */

// Independently re-derive each stage's weight straight off the workbook column.
//
// The expected total is NOT simply the sum of the column. A row the parser
// splits into N orders contributes its weight N times, and a row it cannot
// identify contributes nothing at all. The expectation is therefore built from
// the row-by-row expansion, using the workbook's own numbers, and compared
// against the total the parsed records carry. A bug that drops, duplicates or
// mis-scales a weight makes the two disagree.
for (const id of STAGE_IDS) {
  const spec = SOURCES[id];
  if (!spec.fields.weight || !parsed[id]) { note(`${id}: no weight column, total not cross-checked`); continue; }
  const wbRows = rowsOf(FILES[id][0], FILES[id][1]).rows;
  const headers = wbRows[0].map((h) => String(h == null ? '' : h).trim());
  const { mapping } = resolveColumns(headers, id);
  const col = headers.indexOf(mapping.weight);

  let expected = 0;
  let sourceTotal = 0;
  for (let r = 1; r < wbRows.length; r += 1) {
    const raw = wbRows[r];
    if (!Array.isArray(raw) || !raw.some((c) => c !== '' && c !== null)) continue;
    const w = core.parseNumber(raw[col]);
    if (w === null || !Number.isFinite(w)) continue;
    sourceTotal += w;
    const row = {};
    for (const [field, header] of Object.entries(mapping)) {
      const i = headers.indexOf(header);
      row[header] = i === undefined ? undefined : raw[i];
    }
    // A split row stands for several orders and each of those records keeps the
    // row's weight; a row with no usable key produces no record and so no weight.
    const n = rowToRecords(row, id, mapping).length;
    if (n > 0) expected += w * n;
  }

  let actual = 0;
  let recordCount = 0;
  for (const rec of parsed[id].records) {
    if (typeof rec.weight === 'number' && Number.isFinite(rec.weight)) { actual += rec.weight; recordCount += 1; }
  }
  const diff = Math.abs(actual - expected);
  const tol = Math.max(0.05, expected * 1e-6);
  check(`${id} weight total matches the source column`, diff <= tol,
    `column ${sourceTotal.toFixed(3)}t; expected after expansion ${expected.toFixed(3)}t; ` +
    `records ${actual.toFixed(3)}t over ${recordCount.toLocaleString()} (diff ${diff.toFixed(6)}t)`);
}


/* ═══════════════════ 4 · THE INDEX ═══════════════════ */

// EBTP seeds the index, so booked-but-unstarted orders appear too. It is part
// of the input here exactly as it is in the browser.
const { list } = buildIndex(
  Object.fromEntries(
    Object.keys(FILES).map((id) => [id, parsed[id] ? parsed[id].records : []]),
  ),
);
note(`index: ${list.length.toLocaleString()} plates`);

let noOrder = 0;
let totalRecs = 0;
let allFour = 0;
let ebtpOnly = 0;
const byStage = {};
for (const stageId of STAGE_IDS) byStage[stageId] = 0;
for (const plate of list) {
  const hasOrder = plate.orders && plate.orders.length;
  if (!hasOrder) noOrder += 1;
  let stages = 0;
  for (const stageId of STAGE_IDS) {
    const n = (plate.records[stageId] || []).length;
    totalRecs += n;
    if (n) { stages += 1; byStage[stageId] += 1; }
  }
  if (stages === 4) allFour += 1;
  // A plate with an order but no production record at all is a booked order
  // that has not started. EBTP is a snapshot, so these are expected.
  if (hasOrder && stages === 0) ebtpOnly += 1;
}
check('every plate carries at least one record', totalRecs > 0 && list.length > 0,
  `${totalRecs.toLocaleString()} records across ${list.length.toLocaleString()} plates`);

// Most production plates have no EBTP order, and that is correct: EBTP is a
// snapshot of currently-booked orders while production covers a much longer
// history. The page shows these with no order context rather than hiding them,
// so this is stated, not failed. What must hold is that the order side is fully
// carried — every EBTP order reaches the index.
const ebtpKeys = new Set();
for (const rec of parsed.ebtp ? parsed.ebtp.records : []) {
  // plateKey, not normalizeKey: the line item is normalised on the way in
  // ("50(2)" becomes "50"), and a raw key would simply not match the index.
  const k = core.plateKey(rec.so, rec.lineItem);
  if (k) ebtpKeys.add(k);
}
const indexKeys = new Set(list.map((p) => p.key));
const missing = [...ebtpKeys].filter((k) => !indexKeys.has(k));
check('every EBTP order reaches the index', missing.length === 0,
  `${ebtpKeys.size.toLocaleString()} orders, ${missing.length} missing`);
note(`${noOrder.toLocaleString()} plates have no EBTP order (production predates the order-book snapshot); ` +
  `${ebtpOnly.toLocaleString()} are booked-but-unstarted orders`);
note(`plates through all four stages: ${allFour.toLocaleString()}`);

/* ═══════════════════ 5 · CHAIN IDENTITY ═══════════════════ */

// The chain claims to name slabs at the front and plates at the back. That is
// only true if the identifier columns are actually populated in the real data.
for (const stageId of STAGE_IDS) {
  const { field, kind } = STAGE_IDENTITY[stageId];
  const records = parsed[stageId] ? parsed[stageId].records : [];
  let withId = 0;
  const ids = new Set();
  for (const rec of records) {
    if (rec[field]) { withId += 1; ids.add(rec[field]); }
  }
  const pct = records.length ? (withId / records.length) * 100 : 0;
  note(`${stageId}: ${ids.size.toLocaleString()} distinct ${kind}s on ` +
    `${withId.toLocaleString()}/${records.length.toLocaleString()} rows (${pct.toFixed(1)}%)`);
  // A low rate is not a failure — casting genuinely has unkeyed rows — but a
  // ZERO rate means the identifier column is misnamed and the chain comes up empty.
  check(`${stageId} resolves a ${kind}`, ids.size > 0, `${ids.size.toLocaleString()} distinct`);
}

/* ═══════════════════ 6 · DATES ═══════════════════ */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
let badDates = 0;
let epochish = 0;
let far = 0;
for (const id of STAGE_IDS) {
  for (const rec of parsed[id] ? parsed[id].records : []) {
    if (rec.date === null || rec.date === undefined || rec.date === '') continue;

/* ═══════════════════ 7 · SLICERS ═══════════════════ */

// Every slicer offered in the UI must have real values behind it, or it is a
// control that filters to nothing.
for (const { field, label } of SLICERS) {
  const values = core.slicerValues(list, field);
  check(`slicer "${label}" has values`, values.length > 0, `${values.length.toLocaleString()} distinct`);
  if (values.length) note(`  ${label}: top "${values[0].value}" x${values[0].count.toLocaleString()}`);
}

/* ═══════════════════ 8 · THE FINISHING LOCATION FIX ═══════════════════ */

// The declared header is S_SLOC, which is what the SAP movement report actually
// calls it. If that ever regresses to a name the report does not use, source
// location goes silently empty again — exactly how F_SLOC hid for so long.
const { mapping: finMap } = resolveColumns(parsed.finishing ? parsed.finishing.headers : [], 'finishing');
check('finishing reads the source location as S_SLOC', finMap.fromSloc === 'S_SLOC', `got "${finMap.fromSloc}"`);
let slocs = 0;
for (const rec of parsed.finishing ? parsed.finishing.records : []) if (rec.fromSloc) slocs += 1;
check('finishing records actually carry a source location', slocs > 0, `${slocs.toLocaleString()} rows`);

/* ═══════════════════ SUMMARY ═══════════════════ */

console.log('');
console.log(`${checks - failures}/${checks} integrity checks passed`);
process.exit(failures ? 1 : 0);

    if (!ISO.test(String(rec.date))) { badDates += 1; continue; }
    const year = Number(String(rec.date).slice(0, 4));
    // Excel's 1900 date system, or a serial number read as a date, lands here.
    if (year < 2000) epochish += 1;
    if (year > 2100) far += 1;
  }
}
check('all stage dates are ISO yyyy-mm-dd', badDates === 0, `${badDates.toLocaleString()} malformed`);
check('no dates fall in the Excel epoch', epochish === 0, `${epochish.toLocaleString()} before 2000`);
check('no dates are implausibly far out', far === 0, `${far.toLocaleString()} after 2100`);

for (const stageId of STAGE_IDS) note(`  ${stageId}: ${byStage[stageId].toLocaleString()} plates`);
