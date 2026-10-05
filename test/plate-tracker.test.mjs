import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STAGE_IDS, SOURCES,
  parseDimension, parseNumber, excelSerialToISO, toISODate, daysBetween,
  splitCustomerRef, normalizeKey, plateKey, normalizeHeader,
  resolveColumns, isSourceAcceptable, rowToRecord, rowToRecords, rowToStockRecord, buildIndex,
  buildTimeline, buildLineage, buildTree, layoutTree, elbowPath, defaultExpandedIds,
  searchPlates, summarise, SLICERS, slicerValues, STAGE_IDENTITY, plateStem,
} from '../plate-tracker-core.mjs';

/* ═══════════════════ LARGE-EXTRACT SCALING ═══════════════════ */

// The FG and DISPATCH extracts are the two largest (133k rows each), and both
// used to fail in the browser with "Maximum call stack size exceeded" while
// parsing fine under Node. The cause was `store[id].push(...records)`, which
// passes one ARGUMENT per record; engines cap the argument count, so the spread
// blew the limit only for the two stages big enough to cross it. This test pins
// the rule so the pattern cannot be reintroduced.
test('worker never spreads a record list into a call', () => {
  const src = readFileSync(new URL('../plate-tracker-worker.js', import.meta.url), 'utf8');
  // Strip comments first: the fix's own comment documents the bad pattern.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const spreads = code.match(/\.\s*push\s*\(\s*\.\.\./g) || [];
  assert.equal(spreads.length, 0, 'push(...records) overflows the engine argument limit on large extracts');
});

// Guard the threshold the bug sat on, so the record counts that broke it are
// still larger than any plausible argument cap.
test('large extracts exceed the spread-argument limit, so the fix is load-bearing', () => {
  const realCounts = { finishing: 129389, dispatch: 132880 };
  // Engines cap arguments in the low hundreds of thousands; 100k is a safe
  // stand-in for "well past the cap". Anything at or below it was never broken.
  const ARG_LIMIT_STANDIN = 100000;
  for (const [stage, count] of Object.entries(realCounts)) {
    assert.ok(count > ARG_LIMIT_STANDIN, `${stage} (${count}) must exceed the argument limit`);
  }
});

/* ═══════════════════ VALUE NORMALISATION ═══════════════════ */

// Dimensions arrive in three shapes across the five extracts: casting is
// metres, rolling/dispatch are bare millimetres, FG ships formatted strings.
// These are real values lifted from the workbooks.
test('parseDimension reads each unit the extracts actually use', () => {
  assert.equal(parseDimension('33.00 mm'), 33);      // FG
  assert.equal(parseDimension('11.970 m'), 11970);   // FG, metres → mm
  assert.equal(parseDimension('2,500 mm'), 2500);   // FG, thousands separator
  assert.equal(parseDimension('300'), 300);         // rolling, bare mm
  assert.equal(parseDimension(0.3), 0.3);           // casting, raw metres
  assert.equal(parseDimension('19.116'), 19.116);
});

test('parseDimension returns null rather than a wrong number', () => {
  assert.equal(parseDimension(''), null);
  assert.equal(parseDimension(null), null);
  assert.equal(parseDimension(undefined), null);
  assert.equal(parseDimension('N/A'), null);
  assert.equal(parseDimension('not a number'), null);
});

test('parseNumber strips thousands separators and rejects junk', () => {
  assert.equal(parseNumber('1,234.5'), 1234.5);
  assert.equal(parseNumber(19.116), 19.116);
  assert.equal(parseNumber('0'), 0);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('abc'), null);
});

// Serials 46023 and 46294 were read straight out of the casting and dispatch
// extracts, so these pin the epoch against real data.
test('excelSerialToISO matches serials taken from the real extracts', () => {
  assert.equal(excelSerialToISO(46023), '2026-01-01');
  assert.equal(excelSerialToISO(46294), '2026-09-29');
  assert.equal(excelSerialToISO(46113), '2026-04-01');
});

test('excelSerialToISO rejects values outside the representable range', () => {
  assert.equal(excelSerialToISO(0), null);
  assert.equal(excelSerialToISO(-5), null);
  assert.equal(excelSerialToISO(99999999), null);
  assert.equal(excelSerialToISO('nope'), null);
});

test('toISODate accepts serials, Date objects and ISO strings', () => {
  assert.equal(toISODate(46023), '2026-01-01');
  assert.equal(toISODate(new Date(Date.UTC(2026, 0, 1))), '2026-01-01');
  assert.equal(toISODate('2026-03-19'), '2026-03-19');
  assert.equal(toISODate(''), null);
  assert.equal(toISODate(new Date('nope')), null);
});

test('daysBetween counts whole days in both directions', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-11'), 10);
  assert.equal(daysBetween('2026-01-11', '2026-01-01'), -10);
  assert.equal(daysBetween('2026-01-01', '2026-01-01'), 0);
  assert.equal(daysBetween(null, '2026-01-01'), null);
});

test('splitCustomerRef splits the // lot reference used by rolling', () => {
  // Real value from the rolling extract.
  const parsed = splitCustomerRef('EURO STEEL DANMARK(EXPORT) // PLT/26028/LOT-2-ANG');
  assert.equal(parsed.customer, 'EURO STEEL DANMARK(EXPORT)');
  assert.equal(parsed.lotRef, 'PLT/26028/LOT-2-ANG');
  assert.deepEqual(splitCustomerRef('ACME STEEL'), { customer: 'ACME STEEL', lotRef: '' });
  assert.deepEqual(splitCustomerRef(''), { customer: '', lotRef: '' });
});

// Excel renders 9-digit SO numbers in exponent notation in some exports, and
// those must still match the plain form the other extracts use.
test('normalizeKey collapses exponent and .0 forms of the same id', () => {
  assert.equal(normalizeKey('6.07832E+08'), '607832000');
  assert.equal(normalizeKey(607831786), '607831786');
  assert.equal(normalizeKey('  607831786  '), '607831786');
  assert.equal(normalizeKey('430.0'), '430');
  assert.equal(normalizeKey(null), '');
  assert.equal(normalizeKey(''), '');
});

test('plateKey joins SO No. and Line Item, and refuses half a key', () => {
  assert.equal(plateKey(607831786, 70), '607831786|70');
  assert.equal(plateKey('607831786', '70'), '607831786|70');
  assert.equal(plateKey(607831786, ''), '');
  assert.equal(plateKey('', 70), '');
  assert.equal(plateKey(null, null), '');
});

test('normalizeHeader is case- and whitespace-insensitive', () => {
  assert.equal(normalizeHeader('  AMOUNT IN LC '), 'amount in lc');
  assert.equal(normalizeHeader('BATCH'), 'batch');
  assert.equal(normalizeHeader(null), '');
});

/* ═══════════════════ COLUMN RESOLUTION ═══════════════════ */

test('every source declares a resolvable field map', () => {
  for (const id of Object.keys(SOURCES)) {
    const headers = Object.values(SOURCES[id].fields).map((f) => f.header);
    const result = resolveColumns(headers, id);
    assert.equal(result.missing.length, 0, `${id} should self-resolve`);
    assert.ok(result.matched > 0);
  }
});

test('column matching ignores case and padding in real headers', () => {
  const headers = ['  so ', 'LINE ITEM', 'Date', 'Slab id', 'Weight', 'Grade'];
  const result = resolveColumns(headers, 'casting');
  assert.equal(result.mapping.so, '  so ');
  assert.equal(result.mapping.lineItem, 'LINE ITEM');
  assert.equal(result.mapping.slabId, 'Slab id');
  assert.ok(isSourceAcceptable(result));
});

test('a file missing a required column is rejected, optional ones are not', () => {
  const noSo = resolveColumns(['Line item', 'DATE'], 'casting');
  assert.equal(isSourceAcceptable(noSo), false);
  assert.ok(noSo.missing.some((m) => m.field === 'so' && m.required));

  // No slab id / hold reason: still a usable casting file.
  const minimal = resolveColumns(['SO', 'Line item', 'DATE', 'Weight'], 'casting');
  assert.equal(isSourceAcceptable(minimal), true);
});

/* ═══════════════════ ROW → RECORD ═══════════════════ */

const map = (spec) => {
  const out = {};
  for (const [field, header] of Object.entries(spec)) out[field] = header;
  return out;
};

// Row shapes copied from the real extracts, including the metres-vs-mm split
// and FG's pre-formatted dimension strings.
test('a casting row converts metres to millimetres', () => {
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE', slabId: 'Slab id', weight: 'Weight', grade: 'Grade' });
  const record = rowToRecord(
    { SO: 909704833, 'Line item': 430, DATE: 46023, 'Slab id': 'F6000101', Weight: 19.588, Grade: 'JA35XPNR04' },
    'casting', mapping,
  );
  assert.equal(record.key, '909704833|430');
  assert.equal(record.stage, 'casting');
  assert.equal(record.date, '2026-01-01');
  assert.equal(record.slabId, 'F6000101');
  assert.equal(record.weight, 19.588);
  assert.equal(record.grade, 'JA35XPNR04');
});

test('an FG row parses its formatted dimension strings', () => {
  const mapping = map({ so: 'Sales Order', lineItem: 'Item', date: 'POSTING DATE', batch: 'BATCH', thickness: 'Thickness', width: 'Width', length: 'Length', weight: 'QUANTITY' });
  const record = rowToRecord(
    {
      'Sales Order': 607829204, 'Item': 190, 'POSTING DATE': 46113, BATCH: 'F6195809A0',
      Thickness: '88.00 mm', Width: '2,770 mm', Length: '9.990 m', QUANTITY: 19.116,
    },
    'finishing', mapping,
  );
  assert.equal(record.key, '607829204|190');
  assert.equal(record.thicknessMm, 88);
  assert.equal(record.widthMm, 2770);
  assert.equal(record.lengthMm, 9990);   // metres string → mm
  assert.equal(record.batch, 'F6195809A0');
});

test('slab stock keeps an unallocated physical slab and its inventory context', () => {
  const mapping = map({
    so: 'SO No', lineItem: 'SO Item', slabId: 'Batch', stockQty: 'Total Qty',
    stockLocation: 'LOCATION', agingDays: 'Aging Days', rollability: 'ROLLABLE STATUS',
  });
  const record = rowToStockRecord({
    'SO No': '', 'SO Item': '', Batch: 'F6490612', 'Total Qty': 24.474,
    LOCATION: 'PM STOCK', 'Aging Days': 31, 'ROLLABLE STATUS': 'NON EXECUTABLE',
  }, 'slabStock', mapping);
  assert.equal(record.key, '');
  assert.equal(record.stockId, 'F6490612');
  assert.equal(record.stockQty, 24.474);
  assert.equal(record.stockLocation, 'PM STOCK');
});

test('plate stock converts metre lengths and links to a production trace by batch', () => {
  const mapping = map({
    batch: 'Batch', slabId: 'SLAB ID', stockQty: 'Total Qty', thickness: 'Thick',
    width: 'Width', length: 'Length', storageBin: 'Storage Bin',
  });
  const stock = rowToStockRecord({
    Batch: 'F6341608E0', 'SLAB ID': 'F6341608', 'Total Qty': 3.603,
    Thick: 30, Width: 2620, Length: 5.2, 'Storage Bin': 'BC60K',
  }, 'plateStock', mapping);
  assert.equal(stock.lengthMm, 5200);

  const { list } = buildIndex({
    casting: [], rolling: [], dispatch: [], ebtp: [], slabStock: [],
    finishing: [{ key: '600700001|10', so: '600700001', lineItem: '10', stage: 'finishing', batch: 'F6341608E0', date: '2026-09-01' }],
    plateStock: [stock],
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].stocks.plate.length, 1);
  assert.equal(list[0].stock.plateQty, 3.603);
  assert.deepEqual(stock.linkedKeys, ['600700001|10']);
});

test('a rolling row keeps its yield as a percentage', () => {
  const mapping = map({ so: 'SO', lineItem: 'Line Item', date: 'DATE', yield: 'Yield', status: 'Rolling Status' });
  const record = rowToRecord(
    { SO: 909705219, 'Line Item': 50, DATE: 46266, Yield: 0.9249, 'Rolling Status': 'PRIME' },
    'rolling', mapping,
  );
  assert.ok(Math.abs(record.yieldPct - 92.49) < 0.001);
  assert.equal(record.status, 'PRIME');
});

test('unmapped columns survive on raw so no characteristic is lost', () => {
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE' });
  const record = rowToRecord(
    { SO: 1, 'Line item': 2, DATE: 46023, 'Skull': '', 'TCM Engg': 'SAROJ', 'Heat of day': 1 },
    'casting', mapping,
  );
  assert.equal(record.raw['TCM Engg'], 'SAROJ');
  assert.equal(record.raw['Heat of day'], 1);
  assert.ok(!('Skull' in record.raw), 'blank cells should not be stored');
});

test('a row with no usable key is dropped rather than half-indexed', () => {
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE' });
  assert.equal(rowToRecord({ SO: '', 'Line item': 5, DATE: 46023 }, 'casting', mapping), null);
  assert.equal(rowToRecord({ SO: 5, 'Line item': '', DATE: 46023 }, 'casting', mapping), null);
});

/* ═══════════════════ CLUBBED ROWS ═══════════════════ */

// Casting and rolling pack several orders into one row. Every value below is a
// real cell from the extracts.
test('a clubbed casting row splits into one record per order', () => {
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE', slabId: 'Slab id', weight: 'Weight' });
  const records = rowToRecords(
    { SO: '607823201//607823226', 'Line item': '50(2)//640(2)', DATE: 46023, 'Slab id': 'F6000101', Weight: 21.14 },
    'casting', mapping,
  );
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => r.key), ['607823201|50', '607823226|640']);
  // The characteristics are shared: the extract gives no per-order breakdown.
  for (const r of records) assert.equal(r.slabId, 'F6000101');
});

test('a parallel SO/Item pair of columns is zipped in place', () => {
  // Real row 30201: the SO cell uses "//" and the item cell uses "/", and the
  // two sides still pair up one-for-one. This is NOT the triplet form — the
  // item lives in its own column here, so it must be read from there.
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE' });
  const records = rowToRecords(
    { SO: '607837392//607841015', 'Line item': '340(4)/350(6)', DATE: 46023 },
    'casting', mapping,
  );
  assert.deepEqual(records.map((r) => r.key), ['607837392|340', '607841015|350']);
});

test('an MES triplet run resolves the order and the line item', () => {
  // Real row: SO="909704844/70/1" with the Line Item cell BLANK. The line item
  // is inside the SO cell. Reading it as three separate identifiers — or pairing
  // it against the empty item column — loses the order entirely, which is what
  // happened to 7,498 real casting rows.
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE', slabId: 'Slab id' });
  const records = rowToRecords(
    { SO: '909704844/70/1', 'Line item': '', DATE: 46023, 'Slab id': 'F6020410' },
    'casting', mapping,
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].key, '909704844|70');
});

test('a concatenated triplet run resolves every order in it', () => {
  // Real row 41896: three triplets run together with no separator between them.
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE' });
  const records = rowToRecords(
    { SO: '607852760/10/1/607852761/70/1/607852759/80/1', 'Line item': '', DATE: 46023 },
    'casting', mapping,
  );
  assert.deepEqual(records.map((r) => r.key), [
    '607852760|10', '607852761|70', '607852759|80',
  ]);
});

test('triplets separated by a line break resolve the same way', () => {
  // Real row 12205: the MES wraps a multi-order cell onto several lines.
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE' });
  const records = rowToRecords(
    { SO: '609700552/40/1\n609700560/60/1\n609700566/50/1', 'Line item': '', DATE: 46023 },
    'casting', mapping,
  );
  assert.deepEqual(records.map((r) => r.key), [
    '609700552|40', '609700560|60', '609700566|50',
  ]);
});

test('a plain two-part SO cell is not mistaken for a triplet', () => {
  // "107887613/107887613" is a repeated SO, not SO/Item/1. It must stay on the
  // parallel-column path, or the SO would be read as the line item.
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE' });
  const records = rowToRecords(
    { SO: '107887613/107887613', 'Line item': '80/70', DATE: 46023 },
    'casting', mapping,
  );
  assert.deepEqual(records.map((r) => r.key), ['107887613|80', '107887613|70']);
});

test('a date that bled into the line item column is not made into a key', () => {
  // Real rows 6007/6050/6056 carry a delivery timestamp where the item belongs.
  // Pairing it would produce a key containing a date — worse than no key.
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE' });
  assert.deepEqual(
    rowToRecords(
      { SO: '107888584/107887480', 'Line item': 'Thu Oct 29 2026 23:59:50 GMT+0530 (India Standard Time)', DATE: 46023 },
      'casting', mapping,
    ),
    [],
  );
});

test('STOCK is a real line item and is kept', () => {
  // 2,047 casting rows use it for unallocated material. A blanket "must be
  // numeric" rule would have thrown all of them away.
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE' });
  const records = rowToRecords({ SO: 909704833, 'Line item': 'STOCK', DATE: 46023 }, 'casting', mapping);
  assert.equal(records[0].key, '909704833|STOCK');
});

test('the line item piece count is stripped so the join can match', () => {
  // EBTP, FG and dispatch all carry a bare item number. Keeping "50(2)" would
  // mean the order never joins to its own casting record.
  assert.equal(plateKey('607823201', '50(2)'), '607823201|50');
  assert.equal(plateKey('607823201', '190 (1)'), '607823201|190');
  assert.equal(plateKey('607823201', '50'), '607823201|50');
});

test('a clubbed row whose sides disagree keeps every identifier', () => {
  // Real row: 2 SOs against 3 items. A strict zip would silently drop the third.
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE' });
  const records = rowToRecords(
    { SO: '607819620//607819614', 'Line item': '60(1)//260(4)//40(1)', DATE: 46023 },
    'casting', mapping,
  );
  assert.equal(records.length, 3);
  assert.deepEqual(records.map((r) => r.key), [
    '607819620|60', '607819614|260', '607819614|40',
  ]);
});

test('a clubbed row records where it came from', () => {
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE' });
  const records = rowToRecords({ SO: 'A//B', 'Line item': '1//2', DATE: 46023 }, 'casting', mapping);
  for (const r of records) assert.equal(r.clubbedFrom, 2);
});

test('an ordinary row is unaffected by the splitting', () => {
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE' });
  const records = rowToRecords({ SO: 909704833, 'Line item': 430, DATE: 46023 }, 'casting', mapping);
  assert.equal(records.length, 1);
  assert.equal(records[0].clubbedFrom, undefined);
});

test('a "/" inside a non-identifier value is not treated as a separator', () => {
  // Only the identifier columns are unclubbed. Splitting the whole row would
  // corrupt ordinary text like a grade or a customer reference.
  const mapping = map({ so: 'SO', lineItem: 'Line item', date: 'DATE', grade: 'Grade' });
  const records = rowToRecords(
    { SO: 'A', 'Line item': '1', DATE: 46023, Grade: 'EN 10025-3 S460 N' },
    'casting', mapping,
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].grade, 'EN 10025-3 S460 N');
});

/* ═══════════════════ EBTP AS THE ORDER BOOK ═══════════════════ */

test('an order booked in EBTP appears even with no production record', () => {
  // The point of leading with EBTP: a booked-but-unstarted order has no casting,
  // rolling, finishing or dispatch row anywhere, so a stage-only index would
  // omit it entirely.
  const { list } = buildIndex({ ebtp: [rec('ebtp', 'NEW|10', { orderQty: 92.58, balanceToDeliver: 92.58 })] });
  assert.equal(list.length, 1);
  assert.equal(list[0].key, 'NEW|10');
  assert.equal(list[0].presentStages, 0);
  assert.equal(list[0].balanceToDeliver, 92.58);
});

test('EBTP context rides on the plate, with production winning on grade', () => {
  const { list } = buildIndex({
    ebtp: [rec('ebtp', 'A|1', {
      orderQty: 100, delivered: 20, balanceToDeliver: 80,
      currentStatus: 'In production', paymentStatus: 'With Payment',
      soDate: '2026-01-01', firstDesDt: '2026-03-01', lastDesDt: '2026-04-01',
      grade: 'ORDERED-GRADE', customer: 'ORDERED CUST',
    })],
    casting: [rec('casting', 'A|1', { grade: 'MADE-GRADE', customer: 'ACTUAL CUST' })],
  });
  const plate = list[0];
  // Quantity and promise context comes from the book.
  assert.equal(plate.orderQty, 100);
  assert.equal(plate.delivered, 20);
  assert.equal(plate.orderStatus, 'In production');
  assert.equal(plate.lastPromiseDate, '2026-04-01');
  // Grade and customer describe what was MADE, so production overrides.
  assert.equal(plate.grade, 'MADE-GRADE');
  assert.equal(plate.customer, 'ACTUAL CUST');
});

test('EBTP fills in the customer when production has none', () => {
  const { list } = buildIndex({
    ebtp: [rec('ebtp', 'A|1', { customer: 'JINDAL STEEL & POWER LIMITED,' })],
    casting: [rec('casting', 'A|1', {})],
  });
  assert.equal(list[0].customer, 'JINDAL STEEL & POWER LIMITED,');
});

test('a booked-but-unstarted order still carries a date', () => {
  // Without a date the row would be filtered out by every date range, and the
  // lead-time column would read as unknown.
  const { list } = buildIndex({ ebtp: [rec('ebtp', 'A|1', { soDate: '2026-02-01' })] });
  assert.equal(list[0].firstDate, '2026-02-01');
});

test('production dates win over the SO date for an order in flight', () => {
  const { list } = buildIndex({
    ebtp: [rec('ebtp', 'A|1', { soDate: '2026-01-01' })],
    casting: [rec('casting', 'A|1', { date: '2026-03-05' })],
  });
  assert.equal(list[0].firstDate, '2026-03-05');
});

test('EBTP promise dates and quantities convert to real dates and numbers', () => {
  const mapping = map({
    so: 'SO No.', lineItem: 'SOItm', soDate: 'SO Date',
    orderQty: 'Order Qty_Live', balanceToDeliver: 'Bal To deliver',
    firstDesDt: 'First DesDt', currentStatus: 'Current Order Status',
  });
  const records = rowToRecords({
    'SO No.': 600703082, SOItm: 140, 'SO Date': 44669,
    'Order Qty_Live': 0.001, 'Bal To deliver': 0.001,
    'First DesDt': 45712, 'Current Order Status': 'Short Close Pending',
  }, 'ebtp', mapping);
  assert.equal(records.length, 1);
  // Excel serials straight from the real EBTP extract: SO Date 44669 and
  // First DesDt 45712. Both are converted, not passed through as numbers.
  assert.equal(records[0].soDate, '2022-04-18');
  assert.equal(records[0].firstDesDt, '2025-02-24');
  // Numeric, not stringified — they are summed and compared in the header.
  assert.equal(records[0].orderQty, 0.001);
  assert.equal(records[0].balanceToDeliver, 0.001);
  assert.equal(records[0].currentStatus, 'Short Close Pending');
});

/* ═══════════════════ CLUBBED ROWS (continued) ═══════════════════ */

function rec(stage, key, extra = {}) {
  return { key, so: key.split('|')[0], lineItem: key.split('|')[1], stage, date: '2026-05-01', ...extra };
}

test('records for one SO+Item across four stages become a single plate', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { slabId: 'F1', weight: 10 })],
    rolling: [rec('rolling', 'A|1', { slabId: 'F1', weight: 9 })],
    finishing: [rec('finishing', 'A|1', { batch: 'B1', weight: 9 })],
    dispatch: [rec('dispatch', 'A|1', { batch: 'B1', weight: 9 })],
  });
  assert.equal(list.length, 1);
  const plate = list[0];
  assert.equal(plate.complete, true);
  assert.equal(plate.presentStages, 4);
  assert.equal(plate.currentStage, 'dispatch');
  assert.equal(plate.weight, 37);
  assert.equal(plate.linkConfidence, 'high');
});

test('a stage with no records is absent, not faked', () => {
  const { list } = buildIndex({ casting: [rec('casting', 'A|1')], rolling: [] });
  const plate = list[0];
  assert.equal(plate.complete, false);
  assert.equal(plate.stages.rolling.present, false);
  assert.equal(plate.stages.rolling.count, 0);
  // Never rolled → the plate is waiting at casting, not finished.
  assert.equal(plate.currentStage, 'casting');
});

test('currentStage is the furthest stage present, not the last in the pipeline', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1')],
    rolling: [rec('rolling', 'A|1')],
    dispatch: [rec('dispatch', 'A|1')],
  });
  assert.equal(list[0].currentStage, 'dispatch');
  assert.equal(list[0].complete, false);
});

test('a shared slab id across two orders is a collision, not a merge', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { slabId: 'F9' }), rec('casting', 'B|2', { slabId: 'F9' })],
  });
  assert.equal(list.length, 2, 'two orders stay two plates');
  assert.equal(list[0].links.length, 1);
  assert.equal(list[0].links[0].type, 'slab');
  assert.equal(list[0].links[0].ref, 'F9');
  assert.equal(list[0].links[0].sharedWith, 1);
  // A collision is not corroboration.
  assert.equal(list[0].corroborations.length, 0);
});

test('a shared batch across two orders is a collision too', () => {
  const { list } = buildIndex({
    finishing: [rec('finishing', 'A|1', { batch: 'Z9' }), rec('finishing', 'B|2', { batch: 'Z9' })],
  });
  assert.equal(list.length, 2);
  assert.equal(list[0].links[0].type, 'batch');
});

test('one plate matching its own slab across stages is corroboration', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { slabId: 'F1' })],
    rolling: [rec('rolling', 'A|1', { slabId: 'F1' })],
  });
  assert.equal(list[0].links.length, 0, 'no collision');
  assert.equal(list[0].corroborations.length, 1);
  assert.deepEqual(list[0].corroborations[0].stages, ['casting', 'rolling']);
});

test('a batch matching across finishing and dispatch corroborates as well', () => {
  const { list } = buildIndex({
    finishing: [rec('finishing', 'A|1', { batch: 'B1' })],
    dispatch: [rec('dispatch', 'A|1', { batch: 'B1' })],
  });
  assert.equal(list[0].corroborations.length, 1);
  assert.equal(list[0].corroborations[0].type, 'batch');
});

test('coverage alone never reaches high confidence without corroboration', () => {
  // All four stages, but every stage carries no slab id or batch at all, so the
  // only thing tying them together is the SO number.
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1')],
    rolling: [rec('rolling', 'A|1')],
    finishing: [rec('finishing', 'A|1')],
    dispatch: [rec('dispatch', 'A|1')],
  });
  assert.equal(list[0].complete, true);
  assert.equal(list[0].corroborations.length, 0);
  assert.equal(list[0].linkConfidence, 'medium');
});

test('stage dates come from real records and a one-day span is zero days', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { date: '2026-01-10' }), rec('casting', 'A|1', { date: '2026-01-01' })],
  });
  const stage = list[0].stages.casting;
  assert.equal(stage.first, '2026-01-01', 'earliest first');
  assert.equal(stage.last, '2026-01-10', 'latest last');
  assert.equal(stage.durationDays, 9);
});

test('lead time spans first to last across whichever stages exist', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { date: '2026-01-01' })],
    dispatch: [rec('dispatch', 'A|1', { date: '2026-01-11' })],
  });
  assert.equal(list[0].firstDate, '2026-01-01');
  assert.equal(list[0].lastDate, '2026-01-11');
  assert.equal(list[0].leadTimeDays, 10);
});

/* ═══════════════════ TIMELINE ═══════════════════ */

test('the timeline renders a gap for a stage with no records', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { date: '2026-01-01' })],
    dispatch: [rec('dispatch', 'A|1', { date: '2026-01-11' })],
  });
  const timeline = buildTimeline(list[0]);
  assert.equal(timeline.start, '2026-01-01');
  assert.equal(timeline.end, '2026-01-11');
  assert.equal(timeline.spanDays, 10);

  const gaps = timeline.segments.filter((s) => s.kind === 'gap').map((s) => s.stageId);
  assert.deepEqual(gaps, ['rolling', 'finishing'], 'the skipped stages are explicit');
  for (const segment of timeline.segments.filter((s) => s.kind === 'gap')) {
    assert.equal(segment.widthPct, 0);
    assert.equal(segment.start, null, 'a gap has no invented date');
  }
});

test('stage segments are positioned as a share of the whole span', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { date: '2026-01-01' })],
    rolling: [rec('rolling', 'A|1', { date: '2026-01-06' })],
    dispatch: [rec('dispatch', 'A|1', { date: '2026-01-11' })],
  });
  const [casting, rolling, finishing, dispatch] = buildTimeline(list[0]).segments;
  assert.equal(casting.offsetPct, 0);
  assert.ok(Math.abs(rolling.offsetPct - 50) < 1, 'day 5 of a 10-day span');
  assert.equal(finishing.kind, 'gap');
  assert.ok(dispatch.offsetPct > 90);
});

test('a single-day stage still gets a visible width', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { date: '2026-01-01' })],
    dispatch: [rec('dispatch', 'A|1', { date: '2026-01-11' })],
  });
  assert.ok(buildTimeline(list[0]).segments[0].widthPct >= 1.5, 'zero-day stages stay clickable');
});

test('segments never overflow the track', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { date: '2026-01-01' })],
    rolling: [rec('rolling', 'A|1', { date: '2026-01-01' })],
    dispatch: [rec('dispatch', 'A|1', { date: '2026-01-11' })],
  });
  for (const segment of buildTimeline(list[0]).segments) {
    assert.ok(segment.offsetPct >= 0 && segment.offsetPct <= 100);
    assert.ok(segment.offsetPct + segment.widthPct <= 100.0001, segment.stageId + ' overflows');
  }
});

test('a plate with no dated stages yields an empty timeline, not a crash', () => {
  const { list } = buildIndex({ casting: [rec('casting', 'A|1', { date: null })] });
  const timeline = buildTimeline(list[0]);
  assert.equal(timeline.start, null);
  assert.deepEqual(timeline.segments, []);
});

/* ═══════════════════ STAGE TREE (still used for the stage tooltips) ═══════════════════ */

// The chart draws the lineage, but buildTree is still what produces the per-stage
// summary tooltip and the "n ids" sublabel, so both shapes are still tested.

test('the stage tree keeps the four stages flat under the order', () => {
  const { list } = buildIndex({ casting: [rec('casting', 'A|1', { slabId: 'F1' })] });
  const tree = buildTree(list[0]);
  assert.deepEqual(tree.children.map((c) => c.stageId), ['casting', 'rolling', 'finishing', 'dispatch']);
  for (const stage of tree.children) assert.equal(stage.depth, 1);
});

test('chain view nests the stages one under the next', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { slabId: 'F1' })],
    dispatch: [rec('dispatch', 'A|1', { billNo: 'B1' })],
  });
  const tree = buildTree(list[0], { spine: 'chain' });
  // Only casting hangs off the order; the rest descend from it.
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].stageId, 'casting');

  const rolling = tree.children[0].children[0];
  assert.equal(rolling.stageId, 'rolling');
  const finishing = rolling.children.find((c) => c.stageId === 'finishing');
  assert.ok(finishing, 'finishing is nested under rolling');
  const dispatch = finishing.children.find((c) => c.stageId === 'dispatch');
  assert.ok(dispatch, 'dispatch is nested under finishing');
});

test('chain view keeps a missing stage as a link, not a broken branch', () => {
  // Rolling has no records. The route must still read Casting > Rolling >
  // Finishing, otherwise the chain would jump a stage and hide the gap.
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', {})],
    dispatch: [rec('dispatch', 'A|1', {})],
  });
  const tree = buildTree(list[0], { spine: 'chain' });
  const rolling = tree.children[0].children.find((c) => c.stageId === 'rolling');
  assert.ok(rolling, 'the empty stage is still present');
  assert.equal(rolling.missing, true);
  assert.ok(rolling.children.some((c) => c.stageId === 'finishing'), 'and still carries the next stage');
});

/* ═══════════════════ LINEAGE: HEAT › SLAB › PLATE › DISPATCH ═══════════════════

   The chart no longer has a side-by-side mode. It is one lineage, so these
   tests assert the parent→child relations the chart draws. The joins are real
   relations in the data, not presentational groupings:
     heat  → slab     the slab id begins with the heat id
     slab  → plate    the plate id is the slab id plus a cut suffix
     plate → dispatch dispatch reports the same plate id                  */

test('the lineage reads heat, then slab, then plate, then dispatch', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { heatId: 'F63910', slabId: 'F6391001' })],
    rolling: [rec('rolling', 'A|1', { slabId: 'F6391001' })],
    finishing: [rec('finishing', 'A|1', { batch: 'F6391001A0' })],
    dispatch: [rec('dispatch', 'A|1', { batch: 'F6391001A0', billNo: 'B1' })],
  });
  const tree = buildLineage(list[0]);
  assert.equal(tree.children.length, 1, 'one heat');

  const heat = tree.children[0];
  assert.equal(heat.identityKind, 'Heat ID');
  assert.equal(heat.label, 'F63910');

  const slab = heat.children[0];
  assert.equal(slab.identityKind, 'Slab ID');
  assert.equal(slab.label, 'F6391001');

  const plate = slab.children.find((c) => c.identityKind === 'Plate ID');
  assert.ok(plate, 'the plate hangs under the slab it was cut from');
  assert.equal(plate.label, 'F6391001A0');

  // Dispatch hangs off the plate, and carries the shipment characteristics.
  const dispatch = plate.children.find((c) => c.record && c.record.billNo === 'B1');
  assert.ok(dispatch, 'the dispatch record hangs under the plate it shipped');
  const tip = Object.fromEntries(dispatch.tooltip);
  assert.equal(tip['Bill no'], 'B1');
  assert.equal(tip.Stage, 'Dispatch');
});

test('one heat can hold several slabs, and one slab several plates', () => {
  const { list } = buildIndex({
    casting: [
      rec('casting', 'A|1', { heatId: 'H1', slabId: 'F1001' }),
      rec('casting', 'A|1', { heatId: 'H1', slabId: 'F1002' }),
    ],
    finishing: [
      rec('finishing', 'A|1', { batch: 'F1001A0' }),
      rec('finishing', 'A|1', { batch: 'F1001B0' }),
    ],
  });
  const heat = buildLineage(list[0]).children[0];
  assert.equal(heat.label, 'H1');
  const slabs = heat.children.filter((c) => c.identityKind === 'Slab ID');
  assert.deepEqual(slabs.map((s) => s.label), ['F1001', 'F1002']);
  // Both plates are cut from F1001, so both sit under that slab — not under F1002.
  const fromFirst = slabs[0].children.filter((c) => c.identityKind === 'Plate ID');
  assert.deepEqual(fromFirst.map((p) => p.label), ['F1001A0', 'F1001B0']);
  assert.equal(slabs[1].children.filter((c) => c.identityKind === 'Plate ID').length, 0);
});

test('a slab with no rolling record is kept, dated from casting, and flagged', () => {
  // Casting named the slab; rolling never reported it. The unit must still appear
  // — a gap in the pipeline is a finding — and it must still carry a date.
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { heatId: 'H1', slabId: 'F1001', date: '2026-02-01' })],
  });
  const slab = buildLineage(list[0]).children[0].children[0];
  assert.equal(slab.label, 'F1001');
  assert.equal(slab.missing, true, 'flagged as having no rolling record');
  assert.equal(slab.date, '2026-02-01', 'dated from the casting row that named it');
  assert.ok(Object.fromEntries(slab.tooltip).Date, 'and the tooltip carries the date');
});

test('a unit with no parent is held in a labelled bucket, not dropped', () => {
  // A rolled slab with no casting row has no heat to hang under.
  const { list } = buildIndex({ rolling: [rec('rolling', 'A|1', { slabId: 'F9001' })] });
  const held = buildLineage(list[0]).children.find((c) => c.kind === 'holding');
  assert.ok(held, 'the unlinked slab is still on the chart');
  assert.equal(held.missing, true);
  assert.equal(held.children[0].label, 'F9001');
});

test('the stage tooltip carries the stage characteristics', () => {
  const { list } = buildIndex({
    finishing: [rec('finishing', 'A|1', {
      date: '2026-02-01', batch: 'F6484201A0', grade: 'JA41OPTN01',
      thicknessMm: 32, widthMm: 2500, lengthMm: 7500, weight: 4.716,
    })],
  });
  const node = buildTree(list[0]).children.find((c) => c.stageId === 'finishing');
  const tip = Object.fromEntries(node.tooltip);
  assert.equal(tip.Thickness, '32 mm');
  assert.equal(tip.Width, '2500 mm');
  assert.equal(tip['Internal grade'], 'JA41OPTN01');
  assert.equal(tip.Batch, 'F6484201A0');
  assert.equal(tip.Weight, '4.716 t');
});

test('a varying stage reports a range rather than one misleading number', () => {
  const { list } = buildIndex({
    finishing: [
      rec('finishing', 'A|1', { thicknessMm: 32 }),
      rec('finishing', 'A|1', { thicknessMm: 40 }),
    ],
  });
  const node = buildTree(list[0]).children.find((c) => c.stageId === 'finishing');
  assert.equal(Object.fromEntries(node.tooltip).Thickness, '32–40 mm');
});

test('a stage tooltip never implies a measurement the extract lacks', () => {
  const { list } = buildIndex({ casting: [rec('casting', 'A|1', { slabId: 'F1' })] });
  const node = buildTree(list[0]).children.find((c) => c.stageId === 'finishing');
  const tip = Object.fromEntries(node.tooltip);
  assert.equal(tip.Status, 'No record in this extract');
  assert.equal(tip.Thickness, undefined, 'casting records carry no thickness, so none is shown');
});

test('the order tooltip carries the EBTP order-book context', () => {
  const { list } = buildIndex({
    ebtp: [rec('ebtp', 'A|1', {
      orderQty: 100, delivered: 20, balanceToDeliver: 80,
      currentStatus: 'In production', soDate: '2026-01-01', remarks: 'Captive',
    })],
  });
  const tip = Object.fromEntries(buildTree(list[0]).tooltip);
  assert.equal(tip['Balance to deliver'], '80 t');
  assert.equal(tip['Order status'], 'In production');
  assert.equal(tip.Remarks, 'Captive');
});

test('the tree is order root then the four stages in pipeline order', () => {
  const { list } = buildIndex({ casting: [rec('casting', 'A|1', { slabId: 'F1' })] });
  const tree = buildTree(list[0]);
  assert.equal(tree.kind, 'order');
  assert.equal(tree.label, 'SO A');
  assert.deepEqual(tree.children.map((c) => c.stageId), STAGE_IDS);
  assert.deepEqual(tree.children.map((c) => c.kind), ['stage', 'stage', 'stage', 'stage']);
});

test('a stage with no records is marked missing and carries no children', () => {
  const { list } = buildIndex({ casting: [rec('casting', 'A|1', { slabId: 'F1' })] });
  const rolling = buildTree(list[0]).children.find((c) => c.stageId === 'rolling');
  assert.equal(rolling.missing, true);
  assert.equal(rolling.children.length, 0);
  assert.equal(rolling.sublabel, 'No record');
  // The tooltip says so rather than leaving the user guessing.
  assert.ok(rolling.tooltip.some(([label, value]) => label === 'Status' && /No record/.test(value)));
});

test('expanding a record reaches every characteristic, including raw columns', () => {
  const { list } = buildIndex({
    casting: [{ ...rec('casting', 'A|1', { slabId: 'F1' }), raw: { 'TCM Engg': 'SAROJ' } }],
  });
  const record = buildTree(list[0]).children[0].children[0];
  assert.equal(record.kind, 'record');
  const labels = record.children.map((a) => a.label);
  assert.ok(labels.includes('slabId'));
  assert.ok(labels.includes('TCM Engg'), 'unmapped columns are still reachable');
  assert.equal(record.children.find((a) => a.label === 'TCM Engg').value, 'SAROJ');
});

test('attribute leaves can be omitted for a lighter tree', () => {
  const { list } = buildIndex({ casting: [rec('casting', 'A|1', { slabId: 'F1' })] });
  const tree = buildTree(list[0], { includeAttributes: false });
  assert.equal(tree.children[0].children[0].children.length, 0);
});

test('the record headline is the identifier that stage is tracked by', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { slabId: 'SLAB-9' })],
    finishing: [rec('finishing', 'A|1', { batch: 'BATCH-8' })],
    dispatch: [rec('dispatch', 'A|1', { billNo: 'BILL-7' })],
  });
  const by = Object.fromEntries(buildTree(list[0]).children.map((c) => [c.stageId, c]));
  assert.equal(by.casting.children[0].label, 'SLAB-9');
  assert.equal(by.finishing.children[0].label, 'BATCH-8');
  assert.equal(by.dispatch.children[0].label, 'BILL-7');
});

/* ═══════════════════ LAYOUT ═══════════════════ */

test('a collapsed tree renders only the nodes that are open', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { slabId: 'F1' }), rec('casting', 'A|1', { slabId: 'F2' })],
  });
  const tree = buildTree(list[0]);
  // Empty set: the root is always drawn (there'd be no tree otherwise), but
  // nothing hangs off it.
  const collapsed = layoutTree(tree, new Set());
  assert.equal(collapsed.positions.length, 1, 'just the root');
  assert.equal(collapsed.edges.length, 0);
});

test('the stage tree expands to one node per stage', () => {
  const { list } = buildIndex({ casting: [rec('casting', 'A|1', { slabId: 'F1' })] });
  const tree = buildTree(list[0]);
  // 'siblings' is explicit: defaultExpandedIds with no spine now returns the
  // LINEAGE expansion, which is what the chart uses.
  const layout = layoutTree(tree, defaultExpandedIds(tree, { spine: 'siblings' }));
  assert.equal(layout.positions.length, 5, 'root plus four stages');
  assert.equal(layout.edges.length, 4);
});

test('the stage tree default expansion stops at the stage spine', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { slabId: 'F1' }), rec('casting', 'A|1', { slabId: 'F2' })],
  });
  const tree = buildTree(list[0]);
  const expanded = defaultExpandedIds(tree, { spine: 'siblings' });
  assert.deepEqual([...expanded], [tree.id], 'only the root');
  // And that means no stage's records leak into the default view.
  const layout = layoutTree(tree, expanded);
  assert.equal(layout.positions.filter((p) => p.depth === 2).length, 0, 'records stay shut');
});

test('depth drives X and siblings stack down Y', () => {
  const { list } = buildIndex({ casting: [rec('casting', 'A|1', { slabId: 'F1' })] });
  const tree = buildTree(list[0]);
  const layout = layoutTree(tree, defaultExpandedIds(tree));
  const root = layout.positions.find((p) => p.depth === 0);
  const stages = layout.positions.filter((p) => p.depth === 1);
  for (const stage of stages) assert.ok(stage.x > root.x, 'children sit right of the parent');
  const ys = stages.map((s) => s.y);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b), 'siblings run top to bottom');
});

test('a parent is vertically centred against its children', () => {
  const many = ['F1', 'F2', 'F3'].map((s) => rec('casting', 'A|1', { slabId: s }));
  const { list } = buildIndex({ casting: many });
  const tree = buildTree(list[0]);
  const layout = layoutTree(tree, new Set([tree.id, tree.children[0].id]));
  const stage = layout.positions.find((p) => p.id === tree.children[0].id);
  const kids = layout.positions.filter((p) => p.depth === 2);
  const firstMid = kids[0].y + kids[0].h / 2;
  const lastMid = kids[kids.length - 1].y + kids[kids.length - 1].h / 2;
  assert.ok(Math.abs((stage.y + stage.h / 2) - (firstMid + lastMid) / 2) < 0.001);
});

test('the layout canvas is big enough to hold every node', () => {
  const { list } = buildIndex({ casting: [rec('casting', 'A|1', { slabId: 'F1' })] });
  const tree = buildTree(list[0]);
  const layout = layoutTree(tree, defaultExpandedIds(tree));
  for (const p of layout.positions) {
    assert.ok(p.x + p.w <= layout.width, 'no node sticks out horizontally');
    assert.ok(p.y + p.h <= layout.height, 'no node sticks out vertically');
  }
});

test('a per-node limit truncates rather than rendering everything', () => {
  const many = Array.from({ length: 50 }, (_, i) => rec('casting', 'A|1', { slabId: 'F' + i }));
  const { list } = buildIndex({ casting: many });
  const tree = buildTree(list[0]);
  const layout = layoutTree(tree, new Set([tree.id, tree.children[0].id]), { limit: 10 });
  const stage = layout.positions.find((p) => p.id === tree.children[0].id);
  assert.equal(stage.truncated, true, 'the node admits it was cut short');
  assert.equal(layout.positions.filter((p) => p.depth === 2).length, 10);
});

test('elbow connectors are orthogonal and start where the parent ends', () => {
  const { list } = buildIndex({ casting: [rec('casting', 'A|1', { slabId: 'F1' })] });
  const tree = buildTree(list[0]);
  const layout = layoutTree(tree, defaultExpandedIds(tree));
  for (const edge of layout.edges) {
    const path = elbowPath(edge);
    assert.ok(path.startsWith('M ' + edge.from.x + ' ' + edge.from.y));
    assert.ok(path.endsWith('H ' + edge.to.x));
    assert.ok(path.includes(' V '), 'connectors step vertically, not diagonally');
  }
});

/* ═══════════════════ SEARCH + SUMMARY ═══════════════════ */

test('search matches SO, item, customer, grade, batch and slab', () => {
  const { list } = buildIndex({
    casting: [rec('casting', '607831786|70', { slabId: 'F6112312', grade: 'JA41PVQ01' })],
    finishing: [rec('finishing', '607831786|70', { batch: 'F6204202A0', customer: 'PES ENGINEERS PVT LTD' })],
  });
  assert.equal(searchPlates(list, '607831786').length, 1);
  assert.equal(searchPlates(list, 'PES ENGINEERS').length, 1);
  assert.equal(searchPlates(list, 'JA41PVQ01').length, 1);
  assert.equal(searchPlates(list, 'F6204202A0').length, 1, 'batch is searchable');
  assert.equal(searchPlates(list, 'F6112312').length, 1, 'slab is searchable');
  assert.equal(searchPlates(list, 'nothing-here').length, 0);
});

test('search filters by stage and date window', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { date: '2026-01-01' })],
    dispatch: [rec('dispatch', 'B|2', { date: '2026-06-01' })],
  });
  assert.equal(searchPlates(list, '', { stages: ['rolling'] }).length, 0, 'nothing was rolled');
  assert.equal(searchPlates(list, '', { stages: ['dispatch'] }).length, 1);
  assert.equal(searchPlates(list, '', { from: '2026-05-01' }).length, 1);
  assert.equal(searchPlates(list, '', { to: '2026-02-01' }).length, 1);
});

test('search honours its result limit', () => {
  const { list } = buildIndex({
    casting: Array.from({ length: 20 }, (_, i) => rec('casting', 'A|' + i)),
  });
  assert.equal(searchPlates(list, '', { limit: 5 }).length, 5);
});

test('the summary counts real stages and totals real weights', () => {
  // Two distinct orders: A|1 is cast and rolled, B|2 only finished.
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { weight: 10, date: '2026-01-01' })],
    rolling: [rec('rolling', 'A|1', { weight: 9, date: '2026-02-01' })],
    finishing: [rec('finishing', 'B|2', { weight: 5, date: '2026-03-01' })],
  });
  const summary = summarise(list);
  assert.equal(summary.total, 2);
  assert.equal(summary.byStage.casting, 1, 'only A|1 was cast');
  assert.equal(summary.byStage.rolling, 1);
  assert.equal(summary.byStage.finishing, 1);
  assert.equal(summary.byStage.dispatch, 0);
  assert.equal(summary.complete, 0);
  assert.equal(summary.weight, 24);
  assert.equal(summary.from, '2026-01-01');
  assert.equal(summary.to, '2026-03-01');
});





/* ═══════════════════ STAGE IDENTITY IN THE CHAIN ═══════════════════ */

// In chain view the stages are NESTED, not siblings, so a stage other than
// casting is not a direct child of the order. Tests look stages up by walking.
function findStage(node, stageId) {
  if (node.stageId === stageId) return node;
  for (const child of node.children || []) {
    const hit = findStage(child, stageId);
    if (hit) return hit;
  }
  return null;
}

test('every lineage node carries a date', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { heatId: 'H1', slabId: 'F1001', date: '2026-02-01' })],
    rolling: [rec('rolling', 'A|1', { slabId: 'F1001', date: '2026-03-01' })],
    finishing: [rec('finishing', 'A|1', { batch: 'F1001A0', date: '2026-04-01' })],
    dispatch: [rec('dispatch', 'A|1', { batch: 'F1001A0', date: '2026-05-01' })],
  });
  const dateless = [];
  const walk = (n) => {
    if (n.kind === 'ident' || n.kind === 'order' || n.kind === 'holding') {
      if (!n.date) dateless.push(n.label);
    }
    for (const c of n.children || []) walk(c);
  };
  walk(buildLineage(list[0]));
  assert.deepEqual(dateless, [], 'no unit or order node is left without a date');
});

test('the default expansion shows the whole route and the dispatch rows', () => {
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { heatId: 'H1', slabId: 'F1001' })],
    rolling: [rec('rolling', 'A|1', { slabId: 'F1001' })],
    finishing: [rec('finishing', 'A|1', { batch: 'F1001A0' })],
    dispatch: [rec('dispatch', 'A|1', { batch: 'F1001A0', billNo: 'B1' })],
  });
  const tree = buildLineage(list[0]);
  const layout = layoutTree(tree, defaultExpandedIds(tree, { spine: 'lineage' }));
  const shown = layout.positions.filter((p) => p.identityKind).map((p) => p.identityKind);
  for (const kind of ['Heat ID', 'Slab ID', 'Plate ID']) {
    assert.ok(shown.includes(kind), `${kind} is on the chart by default`);
  }
  // Dispatch rows hang off their plate and are always drawn, because showing what
  // shipped a plate is the point of the last column. The rolling and finishing
  // RECORDS stay closed — a plate can carry thousands of them and they are one
  // click away. Dispatch is a handful of shipment rows per plate, so drawing them
  // costs nothing.
  const records = layout.positions.filter((p) => p.kind === 'record');
  assert.equal(records.filter((r) => r.stageId === 'dispatch').length, 1,
    'the dispatch record is shown under its plate');
  assert.equal(records.filter((r) => r.stageId === 'rolling' || r.stageId === 'finishing').length, 0,
    'the stage records behind the units stay closed');
});

test('the lineage survives a tight per-node child limit', () => {
  // A plate can carry thousands of dispatch rows. The limit must not truncate the
  // route away, or the chart would stop before the plate.
  const many = Array.from({ length: 300 }, (_, i) => rec('dispatch', 'A|1', { billNo: 'B' + i }));
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { heatId: 'H1', slabId: 'F1001' })],
    dispatch: many,
  });
  const tree = buildLineage(list[0]);
  const layout = layoutTree(tree, defaultExpandedIds(tree, { spine: 'lineage' }), { limit: 2 });
  const shown = new Set(layout.positions.filter((p) => p.identityKind).map((p) => p.identityKind));
  for (const kind of ['Heat ID', 'Slab ID', 'Plate ID']) {
    assert.ok(shown.has(kind), `${kind} is still rendered under a tight limit`);
  }
});

test('finishing and dispatch key the lineage on the plate id, which is the batch', () => {
  // The bill is an invoice, not a plate, so the plate identity stays the batch.
  assert.equal(STAGE_IDENTITY.finishing.field, 'batch');
  assert.equal(STAGE_IDENTITY.dispatch.field, 'batch');
  assert.equal(STAGE_IDENTITY.finishing.kind, 'Plate ID');
  assert.equal(STAGE_IDENTITY.casting.kind, 'Heat ID', 'casting hands on the heat');
  assert.equal(STAGE_IDENTITY.rolling.kind, 'Slab ID', 'rolling hands on the slab');

  const { list } = buildIndex({
    finishing: [rec('finishing', 'A|1', { batch: 'F6204210A0' })],
    dispatch: [rec('dispatch', 'A|1', { batch: 'F6204210A0', billNo: '8197139827' })],
  });
  // Finishing and dispatch agree on the plate, so there is one plate and the
  // dispatch row attaches to it. With no casting or rolling row, nothing gives the
  // plate a parent, so it is held in the labelled bucket rather than dropped.
  const tree = buildLineage(list[0]);
  const held = tree.children.find((c) => c.kind === 'holding');
  assert.ok(held, 'the unlinked plate is held rather than dropped');
  const plate = held.children.find((c) => c.identityKind === 'Plate ID');
  assert.equal(plate.label, 'F6204210A0');
  assert.equal(plate.children.filter((c) => c.record && c.record.billNo).length, 1,
    'and the dispatch record sits under the plate it shipped');
});

test('a record with no identifier is kept, not dropped from the lineage', () => {
  // A casting row with neither a heat nor a slab still happened, so it stays
  // reachable in the holding bucket rather than vanishing.
  const { list } = buildIndex({
    casting: [rec('casting', 'A|1', { heatId: 'H1', slabId: 'F1001' }), rec('casting', 'A|1', {})],
  });
  const tree = buildLineage(list[0]);
  const all = [];
  const walk = (n) => { all.push(n); for (const c of n.children || []) walk(c); };
  walk(tree);
  const records = all.filter((n) => n.kind === 'record');
  assert.equal(records.length, 2, 'both casting rows are on the chart');
  const unkeyed = all.find((n) => n.missing);
  assert.ok(unkeyed, 'and the unkeyed one is flagged');
});

/* ═══════════════════ SLICERS ═══════════════════ */

test('every requested slicer is offered and maps to an order field', () => {
  assert.deepEqual(SLICERS.map((s) => s.label), [
    'Remarks', 'Mode', 'Customer Name', 'SO No.', 'Line Item',
    'Supply Condition', 'Inspection By', 'Domestic / Export',
  ]);
  const ebtp = SOURCES.ebtp.fields;
  // so and lineItem are the key itself; everything else must be an EBTP column.
  for (const { field } of SLICERS) {
    if (field === 'so' || field === 'lineItem') continue;
    assert.ok(ebtp[field], `no EBTP field for slicer ${field}`);
  }
});

function orderRec(key, extra) {
  return { ...rec('ebtp', key), soDate: '2026-01-01', ...extra };
}

test('slicer values are counted once per order, most common first', () => {
  const { list } = buildIndex({
    ebtp: [
      orderRec('A|1', { mode: 'Road', customer: 'ACME' }),
      orderRec('B|1', { mode: 'Road', customer: 'BETA' }),
      orderRec('C|1', { mode: 'Captive', customer: 'ACME' }),
    ],
  });
  const modes = slicerValues(list, 'mode');
  assert.deepEqual(modes.map((m) => m.value), ['Road', 'Captive']);
  assert.deepEqual(modes.map((m) => m.count), [2, 1]);
  assert.deepEqual(slicerValues(list, 'customer').map((c) => c.value), ['ACME', 'BETA']);
});

test('a slicer narrows the table to the selected value', () => {
  const { list } = buildIndex({
    ebtp: [orderRec('A|1', { mode: 'Road' }), orderRec('B|1', { mode: 'Captive' })],
  });
  assert.deepEqual(searchPlates(list, '', { slicers: { mode: new Set(['Road']) } }).map((p) => p.key), ['A|1']);
  assert.equal(searchPlates(list, '', { slicers: { mode: new Set(['Road', 'Captive']) } }).length, 2);
  assert.equal(searchPlates(list, '', { slicers: { mode: new Set(['Export']) } }).length, 0);
});

test('an empty slicer set filters nothing', () => {
  const { list } = buildIndex({ ebtp: [orderRec('A|1', { mode: 'Road' })] });
  assert.equal(searchPlates(list, '', { slicers: { mode: new Set() } }).length, 1);
  assert.equal(searchPlates(list, '', { slicers: {} }).length, 1);
});

test('slicers combine with each other and with the search text', () => {
  const { list } = buildIndex({
    ebtp: [
      orderRec('A|1', { mode: 'Road', customerType: 'Domestic' }),
      orderRec('B|1', { mode: 'Road', customerType: 'Export' }),
      orderRec('C|1', { mode: 'Captive', customerType: 'Domestic' }),
    ],
  });
  const out = searchPlates(list, '', {
    slicers: { mode: new Set(['Road']), customerType: new Set(['Domestic']) },
  });
  assert.deepEqual(out.map((p) => p.key), ['A|1']);
  assert.deepEqual(searchPlates(list, 'c', { slicers: { mode: new Set(['Road']) } }).map((p) => p.key), []);
});

test('SO and Line Item slicers match the plate key itself', () => {
  const { list } = buildIndex({ ebtp: [orderRec('A|1', {}), orderRec('A|2', {}), orderRec('B|1', {})] });
  assert.equal(searchPlates(list, '', { slicers: { so: new Set(['A']) } }).length, 2);
  assert.deepEqual(
    searchPlates(list, '', { slicers: { lineItem: new Set(['1']) } }).map((p) => p.key),
    ['A|1', 'B|1']);
});

test('a plate with no order record cannot satisfy an order slicer', () => {
  const { list } = buildIndex({ casting: [rec('casting', 'A|1', { slabId: 'F1' })] });
  assert.equal(list.length, 1, 'the production plate is still indexed');
  assert.equal(searchPlates(list, '', { slicers: { mode: new Set(['Road']) } }).length, 0,
    'nothing in the extracts says it is a Road order, so it is not offered as one');
  assert.equal(searchPlates(list, '', { slicers: {} }).length, 1);
});

test('a casting stage node states how many heats it produced', () => {
  const { list } = buildIndex({
    casting: [
      rec('casting', 'A|1', { slabId: 'F1', heatId: 'H1' }),
      rec('casting', 'A|1', { slabId: 'F2', heatId: 'H1' }),
      rec('casting', 'A|1', { slabId: 'F3', heatId: 'H2' }),
    ],
  });
  const tree = buildTree(list[0]);
  const casting = findStage(tree, 'casting');
  // Casting now keys on the HEAT, so this counts distinct heats, not slabs.
  assert.equal(casting.sublabel, '2 heat ids');
});
