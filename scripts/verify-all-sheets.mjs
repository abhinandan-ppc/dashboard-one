// Verify every workbook currently available to Plate Tracker.
//
// The two *-FORMAT exports are alternate layouts of FG and Dispatch. They are
// validated as supplemental inputs, but are intentionally not merged into the
// production index: doing that would duplicate the same orders already present
// in FG DATA.xlsx and DISPATCH DATA.xlsx.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const globalScope = {};
new Function('self', 'window', 'globalThis', readFileSync('plate-tracker-xlsx.js', 'utf8'))
  .call(globalScope, globalScope, globalScope, globalScope);
const XLSX = globalScope.XLSX || globalThis.XLSX;
const core = await import('../plate-tracker-core.mjs');
const {
  SOURCES, SOURCE_IDS, STAGE_IDS, resolveColumns, isSourceAcceptable,
  rowToRecords, rowToStockRecord, buildIndex, normalizeKey, parseNumber,
} = core;

const FILES = [
  { file: 'CASTING DATA.xlsx', source: 'casting', preferred: '2026', kind: 'operational' },
  { file: 'ROLLING DATA.xlsx', source: 'rolling', preferred: 'RECONCILE', kind: 'operational' },
  { file: 'FG DATA.xlsx', source: 'finishing', kind: 'operational' },
  { file: 'DISPATCH DATA.xlsx', source: 'dispatch', kind: 'operational' },
  { file: 'EBTP.xlsx', source: 'ebtp', preferred: 'WS', kind: 'operational' },
  { file: 'SLAB STOCK.xlsx', source: 'slabStock', preferred: 'WS', kind: 'stock' },
  { file: 'PLATE STOCK.xlsx', source: 'plateStock', preferred: 'Stock', kind: 'stock' },
  { file: 'FG-FORMAT.xlsx', source: 'finishing', kind: 'supplemental' },
  { file: 'DISP-FORMAT.xlsx', source: 'dispatch', kind: 'supplemental' },
].map((entry) => ({ ...entry, path: `sheets/${entry.file}` }));

const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const nonBlank = (row) => Array.isArray(row) && row.some((cell) => cell !== '' && cell !== null && cell !== undefined);

let checks = 0;
let failures = 0;
function check(label, ok, detail = '') {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}
function note(message) { console.log(`      ${message}`); }

function readRows(path, preferred) {
  const workbook = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true });
  const names = preferred && workbook.SheetNames.includes(preferred)
    ? [preferred]
    : workbook.SheetNames;
  let best = null;
  for (const name of names) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
    if (!best || rows.length > best.rows.length) best = { name, rows, sheetCount: workbook.SheetNames.length };
  }
  return best;
}

function findHeader(rows, sourceId) {
  const required = Object.values(SOURCES[sourceId].fields)
    .filter((field) => field.required)
    .map((field) => norm(field.header));
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 25); rowIndex += 1) {
    const present = new Set((rows[rowIndex] || []).map(norm));
    if (required.every((header) => present.has(header))) return rowIndex;
  }
  return -1;
}

function mappedRow(raw, headers, mapping) {
  const row = {};
  const positions = new Map(headers.map((header, index) => [header, index]));
  for (const header of Object.values(mapping)) {
    const index = positions.get(header);
    row[header] = index === undefined ? undefined : raw[index];
  }
  return row;
}

function parseEntry(entry) {
  if (!existsSync(entry.path)) {
    check(`${entry.file} is present`, false, `${entry.path} is missing`);
    return null;
  }
  const selected = readRows(entry.path, entry.preferred);
  check(`${entry.file} has a readable sheet`, !!selected && selected.rows.length > 1,
    selected ? `${selected.sheetCount} sheet(s), selected "${selected.name}"` : 'no rows');
  if (!selected) return null;

  const headerIndex = findHeader(selected.rows, entry.source);
  check(`${entry.file} resolves its ${entry.source} schema`, headerIndex >= 0,
    headerIndex >= 0 ? `header row ${headerIndex + 1}` : 'required columns not found in first 25 rows');
  if (headerIndex < 0) return null;

  const headers = (selected.rows[headerIndex] || []).map((header) => String(header ?? '').trim());
  const resolved = resolveColumns(headers, entry.source);
  check(`${entry.file} has every required field`, isSourceAcceptable(resolved),
    resolved.missing.filter((field) => field.required).map((field) => field.header).join(', ') || `${resolved.matched} mapped`);

  const records = [];
  let dataRows = 0;
  let blankRows = 0;
  let noRecord = 0;
  let splitRows = 0;
  let stockQty = 0;
  let stockQtyRows = 0;
  for (let rowIndex = headerIndex + 1; rowIndex < selected.rows.length; rowIndex += 1) {
    const raw = selected.rows[rowIndex];
    if (!nonBlank(raw)) { blankRows += 1; continue; }
    dataRows += 1;
    const row = mappedRow(raw, headers, resolved.mapping);
    if (entry.kind === 'stock') {
      const record = rowToStockRecord(row, entry.source, resolved.mapping);
      if (!record) { noRecord += 1; continue; }
      records.push(record);
      if (typeof record.stockQty === 'number' && Number.isFinite(record.stockQty)) {
        stockQty += record.stockQty;
        stockQtyRows += 1;
      }
    } else {
      const built = rowToRecords(row, entry.source, resolved.mapping);
      if (!built.length) noRecord += 1;
      if (built.length > 1) splitRows += 1;
      records.push(...built);
    }
  }

  check(`${entry.file} accounts for every nonblank data row`, dataRows + blankRows === selected.rows.length - headerIndex - 1,
    `${dataRows.toLocaleString()} data + ${blankRows.toLocaleString()} blank`);
  check(`${entry.file} produces usable records`, records.length > 0,
    `${records.length.toLocaleString()} records; ${noRecord.toLocaleString()} without an identifier`);
  if (entry.kind === 'stock') {
    check(`${entry.file} carries stock quantities`, stockQtyRows > 0,
      `${stockQtyRows.toLocaleString()} rows; ${stockQty.toLocaleString()} source units`);
  }
  note(`${entry.file}: ${dataRows.toLocaleString()} data rows → ${records.length.toLocaleString()} records` +
    `${splitRows ? `; ${splitRows.toLocaleString()} clubbed rows expanded` : ''}`);
  return { ...entry, records, headers, mapping: resolved.mapping, sheet: selected.name, dataRows, noRecord, stockQty };
}

console.log('Verifying every workbook in sheets/');
console.log('');
check('application schema exposes all seven operational sources',
  SOURCE_IDS.length === 7 && ['casting', 'rolling', 'finishing', 'dispatch', 'ebtp', 'slabStock', 'plateStock']
    .every((id) => SOURCE_IDS.includes(id)), SOURCE_IDS.join(', '));

const parsed = FILES.map(parseEntry).filter(Boolean);
const bySource = new Map();
for (const entry of parsed) {
  if (!bySource.has(entry.source)) bySource.set(entry.source, []);
  bySource.get(entry.source).push(entry);
}

// The seven operational workbooks are the records that build the live index.
// Supplemental format exports are checked above, but kept outside this map to
// prevent duplicate FG/Dispatch orders.
const operational = Object.fromEntries(SOURCE_IDS.map((id) => [id, []]));
for (const entry of parsed.filter((item) => item.kind === 'operational')) operational[entry.source] = entry.records;
const { list } = buildIndex(operational);
check('operational workbooks build a non-empty order index', list.length > 0,
  `${list.length.toLocaleString()} order plates`);
check('both stock snapshots are available to the index layer',
  bySource.has('slabStock') && bySource.has('plateStock'),
  `${bySource.has('slabStock') ? 'slab' : 'no slab'}, ${bySource.has('plateStock') ? 'plate' : 'no plate'}`);

const stockEntries = parsed.filter((entry) => entry.kind === 'stock');
const stockRecords = stockEntries.flatMap((entry) => entry.records);
const indexedKeys = new Set(list.map((plate) => plate.key));
const physicalIds = new Set();
for (const records of Object.values(operational)) {
  for (const record of records) {
    if (record.slabId) physicalIds.add(normalizeKey(record.slabId));
    if (record.batch) physicalIds.add(normalizeKey(record.batch));
  }
}
const keyedStock = stockRecords.filter((record) => record.key && indexedKeys.has(record.key)).length;
const physicalStock = stockRecords.filter((record) => physicalIds.has(normalizeKey(record.stockId))).length;
check('stock rows retain traceable physical identifiers', stockRecords.length > 0 && stockRecords.every((record) => record.stockId),
  `${stockRecords.length.toLocaleString()} stock records`);
note(`stock trace coverage: ${keyedStock.toLocaleString()} by SO + item; ${physicalStock.toLocaleString()} by slab/batch identity; unallocated stock remains visible`);

console.log('');
console.log(`${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failures`);
if (failures) process.exitCode = 1;
