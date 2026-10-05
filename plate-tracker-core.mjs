// Plate Tracker — pure domain logic.
//
// Deliberately DOM-free and side-effect-free so it can be unit-tested directly
// under `node --test` (see test/plate-tracker.test.mjs) and reused unchanged
// inside the parse Worker and the page.
//
// The data model is built around what the five source extracts actually
// contain, verified against the real workbooks:
//
//   CASTING   57,632 rows · SO + Line item + Slab id      · dims in METRES
//   ROLLING    7,208 rows · SO + Line Item + SLAB_ID      · dims in MM
//   FG       133,021 rows · Sales Order + Item + BATCH    · dims as STRINGS
//   DISPATCH 132,880 rows · SO No. + SO Item + Batch      · dims in MM
//   EBTP       5,462 rows · SO No. + SOItm                · order book
//
// Only casting and rolling share an identical column layout, which is why every
// source declares its column map by header NAME and the loader resolves it
// rather than trusting a fixed position.

/* ═══════════════════ STAGES ═══════════════════ */

// Fixed, ordered pipeline. The order is the product's, not the data's: a plate
// is cast, rolled, finished, then dispatched.
export const STAGES = [
  { id: 'casting', label: 'Casting', source: 'CASTING DATA' },
  { id: 'rolling', label: 'Rolling', source: 'ROLLING DATA' },
  { id: 'finishing', label: 'Finishing', source: 'FG DATA' },
  { id: 'dispatch', label: 'Dispatch', source: 'DISPATCH DATA' },
];
export const STAGE_IDS = STAGES.map((s) => s.id);
export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label]));

/* ═══════════════════ SOURCE COLUMN MAPS ═══════════════════ */

// `required` fields must be present for a file to be accepted; `optional`
// ones enrich the trace when found. Header matching is case- and
// whitespace-insensitive so a re-export that pads "  AMOUNT IN LC" still maps.
export const SOURCES = {
  casting: {
    id: 'casting',
    label: 'Casting data',
    hint: 'Slab-level records — the start of every plate.',
    fields: {
      so: { header: 'SO', required: true },
      lineItem: { header: 'Line item', required: true },
      date: { header: 'DATE', required: true },
      slabId: { header: 'Slab id' },
      heatId: { header: 'Heat id' },
      mid: { header: 'Mid' },
      weight: { header: 'Weight' },
      grade: { header: 'Grade' },
      route: { header: 'Route' },
      charging: { header: 'Charging' },
      sloc: { header: 'Sloc' },
      shift: { header: 'Shift' },
      seq: { header: 'Seq' },
      holdReason: { header: 'Hold reason' },
    },
    // Casting reports length/width/thickness in metres; everything downstream
    // uses millimetres. Normalising here keeps one unit in the rest of the app.
    unit: 'm',
  },
  rolling: {
    id: 'rolling',
    label: 'Rolling data',
    hint: 'Roll-level records — slab becomes plate here.',
    fields: {
      so: { header: 'SO', required: true },
      lineItem: { header: 'Line Item', required: true },
      date: { header: 'DATE', required: true },
      slabId: { header: 'SLAB_ID' },
      status: { header: 'Rolling Status' },
      weight: { header: 'WEIGHT' },
      grade: { header: 'Internal grade' },
      extGrade: { header: 'EXTERNAL GRADE' },
      customer: { header: 'Customer' },
      length: { header: 'LENGTH' },
      width: { header: 'WIDTH' },
      thickness: { header: 'Thickness' },
      yield: { header: 'Yield' },
      utLevel: { header: 'UT LEVEL' },
      edgeCondition: { header: 'Edge Condition' },
      rakePoint: { header: 'Rake Point' },
    },
    unit: 'mm',
  },
  finishing: {
    id: 'finishing',
    label: 'FG (plate finishing) data',
    hint: 'Batch-level records — plate finished and graded.',
    fields: {
      so: { header: 'Sales Order', required: true },
      lineItem: { header: 'Item', required: true },
      date: { header: 'POSTING DATE', required: true },
      batch: { header: 'BATCH' },
      materialDoc: { header: 'MATERIAL DOC.' },
      weight: { header: 'QUANTITY' },
      grade: { header: 'Internal Grade' },
      extGrade: { header: 'External Grade' },
      thickness: { header: 'Thickness' },
      width: { header: 'Width' },
      length: { header: 'Length' },
      utStatus: { header: 'UT Status' },
      qualityRemark: { header: 'Quality Remark' },
      customer: { header: 'Customer Name' },
      movementType: { header: 'MOVEMENT TYPE' },
      // SAP names the column S_SLOC (source storage location) and R_SLOC for the
      // receiving side. Both the live extract and the blank template use
      // S_SLOC, so F_SLOC is kept only as a tolerated older spelling.
      fromSloc: { header: 'S_SLOC', alt: ['F_SLOC'] },
      toSloc: { header: 'R_SLOC' },
    },
    // FG dimensions arrive pre-formatted strings ("33.00 mm", "11.970 m").
    unit: 'parse',
  },
  dispatch: {
    id: 'dispatch',
    label: 'Dispatch data',
    hint: 'Invoice-level records — the plate left the plant.',
    fields: {
      so: { header: 'SO No.', required: true },
      lineItem: { header: 'SO Item', required: true },
      date: { header: 'Bill Date', required: true },
      batch: { header: 'Batch' },
      billNo: { header: 'Bill No.' },
      weight: { header: 'Quantity' },
      vehicleNo: { header: 'Vehicle No.' },
      transporter: { header: 'Transporter Name' },
      customer: { header: 'Sold To Party Name' },
      shipTo: { header: 'Ship to Pty Name' },
      shipToCity: { header: 'Ship to pty City' },
      grade: { header: 'SO-X_INT_GRADE' },
      extGrade: { header: 'SO-V_EXT_GRADE9' },
      quality: { header: 'BATCH-V_QUALITY' },
      mode: { header: 'Shippment type Desc' },
      thickness: { header: 'SO-V_THICKNESS' },
      width: { header: 'SO-V_WIDTH' },
      length: { header: 'SO-V_LENGTH' },
    },
    unit: 'mm',
  },
  ebtp: {
    id: 'ebtp',
    label: 'EBTP (order book)',
    hint: 'Order context — promise, balance and current status.',
    fields: {
      so: { header: 'SO No.', required: true },
      lineItem: { header: 'SOItm', required: true },
      soDate: { header: 'SO Date' },
      customer: { header: 'Sold To Party Name' },
      extGrade: { header: 'Ext Grade' },
      grade: { header: 'Int Grade' },
      thickness: { header: 'Thick' },
      width: { header: 'Width' },
      length: { header: 'Length Plan' },
      orderQty: { header: 'Order Qty_Live' },
      delivered: { header: 'Delivered' },
      balanceToDeliver: { header: 'Bal To deliver' },
      currentStatus: { header: 'Current Order Status' },
      paymentStatus: { header: 'Payment Status' },
      firstPrdDt: { header: 'First PrdDt' },
      firstDesDt: { header: 'First DesDt' },
      lastDesDt: { header: 'Last DesDt' },
      remarks: { header: 'Remarks' },
      // Commercial balance columns. The sheet repeats several header names
      // (e.g. BTR appears a second time near column 219, same issue as the
      // duplicate MODE column), so these are read by raw column POSITION —
      // the same indices Order-Status-Report.html already uses for this
      // export (its IDX map) — rather than by trusting header text.
      plateStockBal: { header: 'Plate Stock', col: 36 },
      btr: { header: 'BTR', col: 37 },
      slabStockBal: { header: 'Slab Stock', col: 39 },
      btc: { header: 'BTC', col: 41 },
      issued: { header: 'Issued', col: 43 },
      btp: { header: 'BTP', col: 45 },
      // Slicer fields. These carry no numeric meaning — they are how an order
      // gets described rather than measured — so they are read straight off the
      // record instead of being normalised. Customer TYPE reads "Domestic" and
      // is what the sheet calls the Domestic/Export split.
      mode: { header: 'MODE' },
      customerType: { header: 'Customer TYPE' },
      supplyCondition: { header: 'Supply Condition' },
      inspBy: { header: 'Insp By' },
    },
    unit: 'mm',
  },
  slabStock: {
    id: 'slabStock',
    label: 'Slab stock',
    hint: 'Current slab inventory — location, aging and rollability.',
    stockKind: 'slab',
    fields: {
      so: { header: 'SO No' },
      lineItem: { header: 'SO Item' },
      slabId: { header: 'Batch', required: true },
      heatId: { header: 'HEAT ID' },
      stockQty: { header: 'Total Qty', required: true },
      weight: { header: 'Slab Wt' },
      sloc: { header: 'Slocation' },
      stockLocation: { header: 'LOCATION' },
      aging: { header: 'Aging' },
      agingDays: { header: 'Aging Days' },
      stockStatus: { header: 'FINAL REMARKS' },
      rollability: { header: 'ROLLABLE STATUS' },
      orderType: { header: 'ORDER TYPE' },
      grade: { header: 'SO-X_INT_GRADE', alt: ['INTERNAL GRADE'] },
      customer: { header: 'Sold-to Party' },
      thickness: { header: 'BATCH-V_THICKNESS' },
      width: { header: 'BATCH-V_WIDTH' },
      length: { header: 'BATCH-V_LENGTH' },
      supplyCondition: { header: 'SO-V_SUPPLYCONDITION' },
    },
    unit: 'mm',
  },
  plateStock: {
    id: 'plateStock',
    label: 'Plate stock',
    hint: 'Current plate inventory — bin, crane, aging and quality.',
    stockKind: 'plate',
    fields: {
      so: { header: 'SO No' },
      lineItem: { header: 'SO Item' },
      batch: { header: 'Batch', required: true },
      slabId: { header: 'SLAB ID' },
      stockQty: { header: 'Total Qty', required: true },
      storageBin: { header: 'Storage Bin' },
      craneArea: { header: 'Crane Area' },
      area: { header: 'Area' },
      sloc: { header: 'Slocation' },
      customer: { header: 'Customer' },
      aging: { header: 'Aging' },
      agingDays: { header: 'Aging Days' },
      stockStatus: { header: 'Pending Job for Rwip' },
      grade: { header: 'BATCH-V_INT_GRADE' },
      extGrade: { header: 'BATCH-P_EXT_GRADE' },
      thickness: { header: 'Thick' },
      width: { header: 'Width' },
      length: { header: 'Length' },
      qualityRemark: { header: 'BATCH-V_QUALITYREMARK' },
      edgeCondition: { header: 'Edge Condition' },
      supplyCondition: { header: 'BATCH-V_SUPPLYCONDITION' },
      inspectionBy: { header: 'SO-V_INSPECTION_BY' },
      fgCreationDate: { header: 'FG Creation Date' },
    },
    unit: 'mm',
    lengthUnit: 'm',
  },
};
export const SOURCE_IDS = Object.keys(SOURCES);
export const STOCK_SOURCE_IDS = ['slabStock', 'plateStock'];
/* ═══════════════════ VALUE NORMALISATION ═══════════════════ */

// "33.00 mm" -> 33 ; "11.970 m" -> 11970 ; "2,500 mm" -> 2500 ; "19.116" -> 19.116
export function parseDimension(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = String(raw).trim();
  if (!text) return null;
  // Strip thousands separators, then read the unit that decides the scale.
  const cleaned = text.replace(/,/g, '');
  const match = cleaned.match(/^(-?\d*\.?\d+)\s*(mm|cm|m|in|")?$/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'm') return value * 1000;
  if (unit === 'cm') return value * 10;
  if (unit === 'in' || unit === '"') return value * 25.4;
  return value; // mm, or a bare number the source already means as mm
}

export function parseNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw).replace(/,/g, '').trim();
  if (!cleaned) return null;
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

// Excel stores dates as days since 1899-12-30. Verified against the extracts:
// casting serial 46023 is 2026-01-01, dispatch 46294 is 2026-09-29.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
export function excelSerialToISO(serial) {
  const value = typeof serial === 'number' ? serial : parseNumber(serial);
  if (value === null || value < 1 || value > 2958465) return null;
  return new Date(EXCEL_EPOCH_MS + Math.round(value * 86400000)).toISOString().slice(0, 10);
}

// SheetJS hands back a Date for date-formatted cells and a number for raw
// serials, so accept either (or an ISO string some CSV sources produce).
export function toISODate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === 'number') return excelSerialToISO(raw);
  const text = String(raw).trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return excelSerialToISO(parseFloat(text));
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

export function daysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const from = Date.parse(fromISO + 'T00:00:00Z');
  const to = Date.parse(toISO + 'T00:00:00Z');
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86400000);
}

// "Customer // LOT-2-ANG" carries a second, human-facing reference. Keep the
// leading name as the customer and expose the rest as a lot reference.
export function splitCustomerRef(raw) {
  const text = String(raw || '').trim();
  if (!text) return { customer: '', lotRef: '' };
  const parts = text.split('//').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { customer: parts[0] || '', lotRef: '' };
  return { customer: parts[0], lotRef: parts.slice(1).join(' // ') };
}

// SO numbers must compare as strings: the extracts mix 9-digit and 6-digit
// forms and Excel renders large numerics in exponent notation ("6.07832E+08"),
// which would otherwise never match a plain "607832000".
export function normalizeKey(raw) {
  if (raw === null || raw === undefined) return '';
  let text = String(raw).trim();
  if (!text) return '';
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(text)) {
    const asNum = Number(text);
    if (Number.isFinite(asNum)) text = String(Math.round(asNum));
  }
  // Trim trailing ".0" that some exports append to integer ids.
  if (/^\d+\.0+$/.test(text)) text = text.split('.')[0];
  return text;
}

// The cell separators found in the extracts: a slash, and the line breaks the
// MES uses when it wraps a multi-order cell. Both separate identifiers, so both
// are treated as separators — "609700552/40/1\n609700560/60/1" is two orders, not
// one cell with a newline in the middle of it.
export function splitClubbed(raw) {
  if (raw === null || raw === undefined) return [];
  return String(raw).split(/[/\r\n]+/).map((p) => p.trim()).filter(Boolean);
}

// A line item is a short token: a number, optionally with the "(2)" piece count,
// or the literal "STOCK" that casting uses for unallocated material. Anything
// longer or containing a space cannot be a line item — in practice that is a
// date that has bled into the column ("Thu Oct 29 2026 23:59:50 GMT+0530").
// Those are filtered out rather than turned into a join key, because a key
// containing a timestamp is worse than no key at all.
const ITEM_TOKEN = /^\S{1,10}$/;

export function isPlausibleLineItem(raw) {
  const text = normalizeLineItem(raw);
  return !!text && ITEM_TOKEN.test(text);
}

// Detects the MES triplet run: `SO No./Line Item/1` repeated end to end, e.g.
// "909704844/70/1" or "607852760/10/1/607852761/70/1/607852759/80/1". The shape
// is confirmed only when the segment count divides by three AND every third
// segment is the literal 1, so a plain "A/B" pair cannot be mistaken for one.
function isTripletRun(segments) {
  if (segments.length < 3 || segments.length % 3 !== 0) return false;
  for (let i = 2; i < segments.length; i += 3) if (segments[i] !== '1') return false;
  return true;
}

// Works out which (so, lineItem) pairs one source row stands for.
//
// The extracts pack several orders into one row in three different ways, and
// they are detected in order of how much they tell us:
//
//  1. TRIPLET RUN. The SO cell carries the line item with it — "SO/Item/1" — and
//     the Line Item column beside it is BLANK. This is the MES's own format and
//     the only shape where the line item can be read with certainty.
//  2. PARALLEL COLUMNS. The SO cell and the Line Item cell are both clubbed, and
//     the nth SO pairs with the nth item.
//  3. A plain single SO and item.
//
// A flat "split everything on /" cannot distinguish these. On the real casting
// file that mistake reads "909704844/70/1" as three identifiers, pairs them
// against an EMPTY item column, and drops all three — losing 7,498 real orders.
function readIdPairs(row, mapping) {
  const sos = splitClubbed(mapping.so ? row[mapping.so] : undefined);
  const rawItems = splitClubbed(mapping.lineItem ? row[mapping.lineItem] : undefined);
  // Unusable item segments are discarded first, so a date that bled into the
  // column cannot be counted as one half of a pair.
  const items = rawItems.filter(isPlausibleLineItem);

  // 1. Triplet run — the item is inside the SO cell, so take it from there and
  //    ignore the trailing 1, which is the MES's "one heat" marker, not a field.
  if (isTripletRun(sos)) {
    const pairs = [];
    for (let i = 0; i < sos.length; i += 3) {
      if (isPlausibleLineItem(sos[i + 1])) pairs.push({ so: sos[i], lineItem: sos[i + 1] });
    }
    return pairs;
  }

  if (!sos.length || !items.length) return [];
  if (sos.length <= 1 && items.length <= 1) return [{ so: sos[0], lineItem: items[0] }];

  // 2. Parallel columns. The counts do not always agree (casting has rows of 2
  //    SOs against 3 items), so a strict zip would drop the tail. Each side is
  //    therefore walked at its own length with the shorter one held at its final
  //    value, which keeps every identifier rather than discarding it.
  const n = Math.max(sos.length, items.length);
  const pairs = [];
  for (let i = 0; i < n; i += 1) {
    const so = sos[Math.min(i, sos.length - 1)];
    const lineItem = items[Math.min(i, items.length - 1)];
    if (so !== undefined && lineItem !== undefined) pairs.push({ so, lineItem });
  }
  return pairs;
}

// Line items carry a bracketed piece count — "50(2)" for item 50. Every other
// source (EBTP's SOItm, FG's Item, dispatch's SO Item) carries the bare number,
// so the suffix has to come off or the join finds nothing to match on.
export function normalizeLineItem(raw) {
  const text = normalizeKey(raw);
  if (!text) return '';
  return normalizeKey(text.replace(/\s*\([^)]*\)\s*$/, ''));
}

// The join key: SO No. + Line Item, exactly as specified for these extracts.
export function plateKey(so, lineItem) {
  const a = normalizeKey(so);
  const b = normalizeLineItem(lineItem);
  if (!a || !b) return '';
  return a + '|' + b;
}

/* ═══════════════════ HEADER RESOLUTION ═══════════════════ */

export function normalizeHeader(header) {
  return String(header || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Maps a source's declared fields onto actual column headers, by name.
// Returns { mapping, missing, matched } where mapping[field] = column header.
export function resolveColumns(headers, sourceId) {
  const source = SOURCES[sourceId];
  if (!source) return { mapping: {}, missing: [], matched: 0 };
  const byName = new Map();
  for (const header of headers) {
    const key = normalizeHeader(header);
    if (key && !byName.has(key)) byName.set(key, header);
  }
  const mapping = {};
  const missing = [];
  let matched = 0;
  for (const [field, spec] of Object.entries(source.fields)) {
    // A field declaring `col` is read by raw column position instead of by
    // header text — for sheets where that header name repeats elsewhere
    // (duplicate columns), position is the only reliable way to pick the
    // ONE occurrence that is actually meant. `{ col }` is a distinguishable
    // shape from the plain header-string mapping value used below.
    if (spec.col !== undefined) {
      mapping[field] = { col: spec.col };
      matched += 1;
      continue;
    }
    // `header` is the name the extracts actually use. `alt` lists older or
    // mis-spelled names for the same column, tried in order — SAP's movement
    // report calls the source location S_SLOC, and an earlier guess of F_SLOC
    // silently produced an empty column rather than an error.
    const names = [spec.header].concat(spec.alt || []);
    const hit = names.map((n) => byName.get(normalizeHeader(n)))
      .find((h) => h !== undefined);
    if (hit !== undefined) {
      mapping[field] = hit;
      matched += 1;
    } else {
      missing.push({ field, header: spec.header, required: !!spec.required });
    }
  }
  return { mapping, missing, matched };
}

export function isSourceAcceptable(result) {
  return result.missing.filter((m) => m.required).length === 0;
}

/* ═══════════════════ ROW → RECORD ═══════════════════ */

function toMillimetres(value, unit) {
  if (value === null) return null;
  if (unit === 'm') return value * 1000;
  return value;
}

// Per-source identifiers and descriptors, surfaced in the record's tooltip.
const PASSTHROUGH_FIELDS = [
  'slabId', 'heatId', 'mid', 'batch', 'materialDoc', 'billNo', 'vehicleNo',
  'transporter', 'status', 'quality', 'utStatus', 'utLevel', 'qualityRemark',
  'edgeCondition', 'route', 'charging', 'sloc', 'shift', 'seq', 'holdReason',
  'movementType', 'fromSloc', 'toSloc', 'mode', 'shipTo', 'shipToCity',
  'currentStatus', 'paymentStatus', 'rakePoint', 'lotRef',
  // EBTP order-book context: quantities, promise dates and remarks are the whole
  // reason the order book is loaded, so they ride along on the record rather
  // than only surviving in `raw`.
  'orderQty', 'delivered', 'balanceToDeliver', 'firstPrdDt', 'firstDesDt',
  'lastDesDt', 'remarks',
  'mode', 'customerType', 'supplyCondition', 'inspBy',
];

// One source row → one OR MORE trace records. A row whose SO and line item are
// clubbed stands for several orders, so it yields one record per pair; every
// other characteristic on the row is shared across them, because the extract
// gives no per-order breakdown of it.
//
// Unmapped columns are preserved on `raw` so "every characteristic" stays
// available in the UI without re-parsing.
export function rowToRecords(row, sourceId, mapping) {
  const pairs = readIdPairs(row, mapping);
  if (!pairs.length) return [];
  if (pairs.length === 1) {
    const record = buildRecord(row, sourceId, mapping, pairs[0]);
    return record ? [record] : [];
  }
  const out = [];
  for (const pair of pairs) {
    const record = buildRecord(row, sourceId, mapping, pair);
    if (record) out.push(record);
  }
  // Provenance, so the UI can say the row was split rather than implying the
  // source had one row per order.
  if (out.length > 1) for (const record of out) record.clubbedFrom = pairs.length;
  return out;
}

// Single-record form of rowToRecords, kept because callers that deal in
// already-unique rows (and the existing tests) want one record or nothing. A
// clubbed row returns its FIRST pair here; use rowToRecords to keep them all.
export function rowToRecord(row, sourceId, mapping) {
  const first = rowToRecords(row, sourceId, mapping)[0];
  return first || null;
}

function buildRecord(row, sourceId, mapping, ids) {
  const source = SOURCES[sourceId];
  if (!source) return null;
  const get = (field) => (mapping[field] ? row[mapping[field]] : undefined);
  const so = normalizeKey(ids.so !== undefined ? ids.so : get('so'));
  const lineItem = normalizeLineItem(ids.lineItem !== undefined ? ids.lineItem : get('lineItem'));
  const key = plateKey(so, lineItem);
  if (!key) return null;

  const record = { key, so, lineItem, stage: sourceId, date: toISODate(get('date')) };

  const unit = source.unit;
  const thickness = parseDimension(get('thickness'));
  const width = parseDimension(get('width'));
  const length = parseDimension(get('length'));
  if (thickness !== null) record.thicknessMm = toMillimetres(thickness, unit);
  if (width !== null) record.widthMm = toMillimetres(width, unit);
  if (length !== null) record.lengthMm = toMillimetres(length, unit);

  const weight = parseNumber(get('weight'));
  if (weight !== null) record.weight = weight;

  if (get('grade')) record.grade = String(get('grade')).trim();
  if (get('extGrade')) record.extGrade = String(get('extGrade')).trim();

  if (get('customer')) {
    const { customer, lotRef } = splitCustomerRef(get('customer'));
    if (customer) record.customer = customer;
    if (lotRef) record.lotRef = lotRef;
  }

  for (const field of PASSTHROUGH_FIELDS) {
    const value = get(field);
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) record[field] = text;
  }

  // EBTP carries the order book, and its dates and quantities are what make it
  // worth loading. They need real conversion rather than the passthrough's raw
  // text: the promise dates arrive as Excel serials, and the order/balance
  // figures as numbers that must stay numeric so they can be compared and summed.
  const orderDates = { soDate: 'soDate', firstPrdDt: 'firstPrdDt', firstDesDt: 'firstDesDt', lastDesDt: 'lastDesDt' };
  for (const [field, prop] of Object.entries(orderDates)) {
    if (!mapping[field]) continue;
    const iso = toISODate(get(field));
    if (iso) record[prop] = iso;
  }
  const numericOrderFields = [
    'orderQty', 'delivered', 'balanceToDeliver',
    'plateStockBal', 'btr', 'slabStockBal', 'btc', 'issued', 'btp',
  ];
  for (const field of numericOrderFields) {
    if (!mapping[field]) continue;
    const n = parseNumber(get(field));
    if (n !== null) record[field] = n;
  }

  // The rolling extract stores yield as a fraction (0.9249); present a percent.
  const yieldValue = parseNumber(get('yield'));
  if (yieldValue !== null) {
    record.yieldPct = yieldValue <= 1 ? yieldValue * 100 : yieldValue;
  }

  // Everything else the source offered, untouched.
  const mapped = new Set([...Object.values(mapping),
    ...numericOrderFields, 'soDate',
    'firstPrdDt', 'firstDesDt', 'lastDesDt', 'remarks',
  ]);
  const raw = {};
  for (const header of Object.keys(row)) {
    if (mapped.has(header)) continue;
    const value = row[header];
    if (value === undefined || value === null || value === '') continue;
    raw[header] = value instanceof Date ? value.toISOString() : value;
  }
  if (Object.keys(raw).length) record.raw = raw;

  return record;
}

// Stock extracts are inventory snapshots rather than production events. Many
// rows deliberately have no SO/item, so they cannot use rowToRecords(), whose
// contract requires an order key. Their physical slab/plate id is mandatory and
// later links them to production without dropping genuine unallocated stock.
export function rowToStockRecord(row, sourceId, mapping) {
  const source = SOURCES[sourceId];
  if (!source || !source.stockKind) return null;
  const get = (field) => (mapping[field] ? row[mapping[field]] : undefined);
  const identityField = source.stockKind === 'slab' ? 'slabId' : 'batch';
  const identity = normalizeKey(get(identityField));
  if (!identity) return null;

  const so = normalizeKey(get('so'));
  const lineItem = normalizeLineItem(get('lineItem'));
  const key = plateKey(so, lineItem);
  const record = {
    key,
    so,
    lineItem,
    source: sourceId,
    stockKind: source.stockKind,
    stockId: identity,
  };
  if (source.stockKind === 'slab') record.slabId = identity;
  else record.batch = identity;

  const passthrough = [
    'slabId', 'heatId', 'batch', 'sloc', 'stockLocation', 'storageBin',
    'craneArea', 'area', 'aging', 'stockStatus', 'rollability', 'orderType',
    'grade', 'extGrade', 'customer', 'qualityRemark', 'edgeCondition',
    'supplyCondition', 'inspectionBy',
  ];
  for (const field of passthrough) {
    const value = get(field);
    if (value === undefined || value === null || value === '') continue;
    record[field] = String(value).trim();
  }

  for (const field of ['stockQty', 'agingDays']) {
    const value = parseNumber(get(field));
    if (value !== null) record[field] = value;
  }
  const fallbackWeight = parseNumber(get('weight'));
  if (fallbackWeight !== null) record.weight = fallbackWeight;
  else if (record.stockQty !== undefined) record.weight = record.stockQty;

  for (const field of ['thickness', 'width', 'length']) {
    const value = parseDimension(get(field));
    if (value === null) continue;
    const unit = field === 'length' && source.lengthUnit ? source.lengthUnit : source.unit;
    record[field + 'Mm'] = toMillimetres(value, unit);
  }
  const date = toISODate(get('fgCreationDate'));
  if (date) record.date = date;

  const mapped = new Set(Object.values(mapping));
  const raw = {};
  for (const [header, value] of Object.entries(row)) {
    if (mapped.has(header) || value === undefined || value === null || value === '') continue;
    raw[header] = value instanceof Date ? value.toISOString() : value;
  }
  if (Object.keys(raw).length) record.raw = raw;
  return record;
}

/* ═══════════════════ LINKING ═══════════════════ */

// Builds the plate index from per-stage record arrays.
//
// The primary link is SO No. + Line Item, as specified. Two secondary indexes
// record corroborating evidence where the primary key alone leaves a gap:
//   • Slab id — casting and rolling both carry the same slab id, so a
//     cast→roll pair can be confirmed physically.
//   • BATCH   — finishing and dispatch both key on batch, which is the real
//     plate identity at that end of the pipeline.
//
// Secondary links are RECORDED, not used to merge. Two orders sharing a slab or
// batch is a data problem worth surfacing, not something to silently fuse.
export function buildIndex(byStage) {
  const plates = new Map();

  const ensure = (key) => {
    let plate = plates.get(key);
    if (!plate) {
      const [so, lineItem] = key.split('|');
      plate = {
        key, so, lineItem, stages: {}, records: {}, links: [], corroborations: [],
        orders: [], stocks: { slab: [], plate: [] },
      };
      plates.set(key, plate);
    }
    return plate;
  };

  // EBTP is the ORDER BOOK, so it is seeded first and defines which orders exist
  // at all. An order that has been booked but not yet cast, rolled or shipped
  // has no production record anywhere, and building the index from the stage
  // arrays alone would leave it out of the list entirely — the view would only
  // show orders that already have history, which is the opposite of what an
  // order book is for. Seeding from EBTP means every order line appears, and the
  // stage columns then report what has (and has not) happened to it.
  for (const record of byStage.ebtp || []) {
    const plate = ensure(record.key);
    if (!plate.orders) plate.orders = [];
    plate.orders.push(record);
  }

  for (const stageId of STAGE_IDS) {
    for (const record of byStage[stageId] || []) {
      const plate = ensure(record.key);
      if (!plate.records[stageId]) plate.records[stageId] = [];
      plate.records[stageId].push(record);
    }
  }

  // Attach current inventory after production records establish the physical
  // identifiers. SO/item is authoritative when present. Otherwise an exact
  // slab or plate id links the stock row; shared identifiers stay explicitly
  // ambiguous and are attached to every candidate rather than silently picked.
  const slabOwners = new Map();
  const plateOwners = new Map();
  const noteOwner = (index, id, key) => {
    const normalized = normalizeKey(id);
    if (!normalized) return;
    if (!index.has(normalized)) index.set(normalized, new Set());
    index.get(normalized).add(key);
  };
  for (const plate of plates.values()) {
    for (const stageId of ['casting', 'rolling']) {
      for (const record of plate.records[stageId] || []) noteOwner(slabOwners, record.slabId, plate.key);
    }
    for (const stageId of ['finishing', 'dispatch']) {
      for (const record of plate.records[stageId] || []) noteOwner(plateOwners, record.batch, plate.key);
    }
  }
  const attachStock = (record, kind) => {
    let keys = new Set();
    if (record.key) {
      ensure(record.key);
      keys.add(record.key);
    } else {
      const index = kind === 'slab' ? slabOwners : plateOwners;
      keys = new Set(index.get(normalizeKey(record.stockId)) || []);
    }
    record.linkedKeys = [...keys];
    record.ambiguous = keys.size > 1;
    for (const key of keys) {
      const plate = ensure(key);
      if (!plate.stocks) plate.stocks = { slab: [], plate: [] };
      plate.stocks[kind].push(record);
    }
  };
  for (const record of byStage.slabStock || []) attachStock(record, 'slab');
  for (const record of byStage.plateStock || []) attachStock(record, 'plate');

  // Secondary links come in two flavours, and both are worth keeping:
  //
  //   corroboration — the SAME plate's cast slab matches its own roll slab
  //     (or its FG batch matches its own dispatch batch). This is positive
  //     evidence that the stage-to-stage join is physically right.
  //   collision — a slab or batch shared by two DIFFERENT orders. That is a
  //     data problem worth surfacing, and is recorded rather than used to
  //     merge, because silently fusing two orders would be worse than a gap.
  //
  // Group each ref by owning plate key so both are derivable in one pass.
  const refIndex = new Map();
  const noteRef = (ref, key, type, stageId) => {
    if (!ref) return;
    if (!refIndex.has(ref)) refIndex.set(ref, { type, owners: new Map() });
    const entry = refIndex.get(ref);
    if (!entry.owners.has(key)) entry.owners.set(key, new Set());
    entry.owners.get(key).add(stageId);
  };
  for (const stageId of ['casting', 'rolling']) {
    for (const record of byStage[stageId] || []) noteRef(record.slabId, record.key, 'slab', stageId);
  }
  for (const stageId of ['finishing', 'dispatch']) {
    for (const record of byStage[stageId] || []) noteRef(record.batch, record.key, 'batch', stageId);
  }
  for (const [ref, { type, owners }] of refIndex) {
    for (const [key, stages] of owners) {
      const plate = plates.get(key);
      if (!plate) continue;
      if (owners.size > 1) {
        plate.links.push({ type, ref, sharedWith: owners.size - 1 });
      } else if (stages.size > 1) {
        plate.corroborations.push({ type, ref, stages: [...stages] });
      }
    }
  }

  const list = [...plates.values()];
  for (const plate of list) finalisePlate(plate);
  return { plates, list };
}

export function finalisePlate(plate) {
  let present = 0;
  let weight = 0;
  let hasWeight = false;
  let grade = '';
  let extGrade = '';
  let customer = '';
  let batch = '';
  let slabId = '';
  let first = null;
  let last = null;

  // EBTP order context, promoted onto the plate so the order book is readable
  // without opening a record: what was promised, what is still to deliver, and
  // where the order stands.
  const order = (plate.orders || [])[0] || null;
  plate.order = order;
  if (order) {
    plate.orderQty = order.orderQty ?? null;
    plate.delivered = order.delivered ?? null;
    plate.balanceToDeliver = order.balanceToDeliver ?? null;
    plate.plateStockBal = order.plateStockBal ?? null;
    plate.btr = order.btr ?? null;
    plate.slabStockBal = order.slabStockBal ?? null;
    plate.btc = order.btc ?? null;
    plate.issued = order.issued ?? null;
    plate.btp = order.btp ?? null;
    plate.orderStatus = order.currentStatus || '';
    plate.paymentStatus = order.paymentStatus || '';
    plate.soDate = order.soDate || null;
    plate.firstPromiseDate = order.firstDesDt || null;
    plate.lastPromiseDate = order.lastDesDt || null;
    plate.firstProdDate = order.firstPrdDt || null;
    if (order.remarks) plate.orderRemarks = order.remarks;
  }

  for (const stageId of STAGE_IDS) {
    const records = plate.records[stageId] || [];
    const dates = [];
    for (const record of records) {
      if (record.date) dates.push(record.date);
      if (typeof record.weight === 'number') { weight += record.weight; hasWeight = true; }
      if (!grade && record.grade) grade = record.grade;
      if (!extGrade && record.extGrade) extGrade = record.extGrade;
      if (!customer && record.customer) customer = record.customer;
      if (!batch && record.batch) batch = record.batch;
      if (!slabId && record.slabId) slabId = record.slabId;
    }
    dates.sort();
    const stageFirst = dates[0] || null;
    const stageLast = dates[dates.length - 1] || null;
    plate.stages[stageId] = {
      stageId,
      count: records.length,
      present: records.length > 0,
      first: stageFirst,
      last: stageLast,
      // Elapsed days only when a stage genuinely spans a range. A single record
      // on one day is 0 days of dwell, not a missing measurement.
      durationDays: stageFirst && stageLast ? daysBetween(stageFirst, stageLast) : null,
      status: records.find((r) => r.status)?.status || '',
    };
    if (records.length) present += 1;
    if (stageFirst && (!first || stageFirst < first)) first = stageFirst;
    if (stageLast && (!last || stageLast > last)) last = stageLast;
  }

  // Order-book fallbacks, applied only AFTER production has been read — the
  // order book says what was ordered, production says what was made, so an
  // order that has reached the shop floor must report the real grade, customer
  // and dates. Applying these first would let EBTP shadow every production
  // value on any order present in both.
  if (order) {
    if (!customer && order.customer) customer = order.customer;
    if (!grade && order.grade) grade = order.grade;
    if (!extGrade && order.extGrade) extGrade = order.extGrade;
  }
  // A booked order with no production record at all still needs a date, or the
  // date filter would hide it and the lead-time column would read as unknown.
  // The SO date is the only date such an order has.
  if (!first && plate.soDate) first = plate.soDate;

  plate.presentStages = present;
  plate.stageCount = STAGE_IDS.length;
  plate.complete = present === STAGE_IDS.length;
  plate.weight = hasWeight ? round(weight, 3) : null;
  plate.grade = grade;
  plate.extGrade = extGrade;
  plate.customer = customer;
  plate.batch = batch;
  plate.slabId = slabId;
  plate.firstDate = first;
  plate.lastDate = last;
  plate.leadTimeDays = daysBetween(first, last);
  // Current stage is the furthest stage actually present, not the last stage in
  // the pipeline: a plate cast and never rolled is "Rolling", meaning it is
  // waiting at or short of rolling, and the trace shows the gap.
  plate.currentStage = lastPresentStage(plate);
  plate.linkConfidence = scoreConfidence(plate);
  const slabStock = plate.stocks?.slab || [];
  const plateStock = plate.stocks?.plate || [];
  const qty = (records) => round(records.reduce(
    (sum, record) => sum + (typeof record.stockQty === 'number' ? record.stockQty : 0), 0), 3);
  plate.stock = {
    slabCount: slabStock.length,
    slabQty: qty(slabStock),
    plateCount: plateStock.length,
    plateQty: qty(plateStock),
  };
  return plate;
}

// The furthest stage that actually has records — NOT the last stage in the
// pipeline. A plate cast and never rolled reports "casting" as its current
// stage, meaning it is waiting at casting; the trace shows the missing stages
// as gaps rather than implying progress that never happened.
function lastPresentStage(plate) {
  for (let i = STAGE_IDS.length - 1; i >= 0; i -= 1) {
    if (plate.stages[STAGE_IDS[i]].present) return STAGE_IDS[i];
  }
  return null;
}

// Confidence combines stage coverage with physical corroboration. Coverage
// alone is not enough: four stages present but joined only by SO number is a
// weaker trace than one where the slab and batch ids actually line up.
function scoreConfidence(plate) {
  const corroborated = plate.corroborations.length > 0;
  const complete = plate.complete;
  const coverage = plate.presentStages / plate.stageCount;
  if (complete && corroborated) return 'high';
  if (complete) return 'medium';
  if (corroborated && coverage >= 0.5) return 'medium';
  return 'low';
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/* ═══════════════════ TIMELINE ═══════════════════ */

// Builds the timeline as ordered segments over [minDate, maxDate].
//
// A stage with no records becomes an explicit gap segment. It is NOT collapsed
// away and NOT interpolated: the rolling extract only covers a subset of the
// period, so a missing stage usually means "not in this extract", and saying so
// is the honest rendering.
export function buildTimeline(plate) {
  const dated = STAGE_IDS.map((id) => plate.stages[id]).filter((s) => s.present && s.first);
  if (!dated.length) {
    return { start: null, end: null, spanDays: 0, segments: [], complete: false };
  }
  let start = dated[0].first;
  let end = dated[0].last || dated[0].first;
  for (const stage of dated) {
    if (stage.first < start) start = stage.first;
    const stageEnd = stage.last || stage.first;
    if (stageEnd > end) end = stageEnd;
  }
  const spanDays = Math.max(1, daysBetween(start, end) || 0);
  const segments = [];
  for (const stageId of STAGE_IDS) {
    const stage = plate.stages[stageId];
    if (!stage.present || !stage.first) {
      segments.push({
        stageId,
        label: STAGE_LABEL[stageId],
        kind: 'gap',
        start: null,
        end: null,
        offsetPct: 0,
        widthPct: 0,
      });
      continue;
    }
    const stageEnd = stage.last || stage.first;
    const offsetPct = clamp((daysBetween(start, stage.first) / spanDays) * 100, 0, 100);
    const widthPct = clamp((daysBetween(stage.first, stageEnd) / spanDays) * 100, 1.5, 100);
    segments.push({
      stageId,
      label: STAGE_LABEL[stageId],
      kind: 'stage',
      start: stage.first,
      end: stageEnd,
      durationDays: stage.durationDays,
      status: stage.status,
      count: stage.count,
      offsetPct,
      widthPct: Math.min(widthPct, 100 - offsetPct),
    });
  }
  return { start, end, spanDays, segments, complete: plate.complete };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/* ═══════════════════ TREE MODEL ═══════════════════ */

// The expandable left-to-right tree: order root → stage spine → records →
// Builds the tree for one plate.
//
// Two shapes are available, because they answer different questions:
//
//   'siblings' (default) — the four stages sit side by side under the order.
//     Best for "which stages does this order have?", since all four are visible
//     at once and a missing stage is obvious.
//   'chain' — Casting > Rolling > Finishing > Dispatch nested one under the
//     next. Best for "what happened, in order?", reading top-left to bottom-right
//     as the physical route the plate took.
//
// Both keep every stage node present, including stages with no record, because a
// gap in the pipeline is itself the finding.
// Builds the flow the plate actually took:
//
//   SO JA41PVQ01 › Heat F63910 › Slab F6391001 › Plate F6391001A0 › Dispatch
//
// One lineage, not four stage panels. Each stage contributes the unit it handed
// on, and the child is hung under the parent that produced it:
//
//   heat   ← the slab id begins with the heat id   (verified: 100% of casting rows)
//   slab   ← the plate id is the slab id + a cut suffix (99.2% of finishing rows)
//   plate  ← dispatch reports the same plate id
//
// Anything that cannot be linked to a parent is NOT dropped. It is gathered into
// a clearly labelled holding node at the right level, because a plate whose
// parent is missing is a finding, not noise.
// The key a record with no identifier of its own is collected under, so the
// lineage can show "this happened but nothing identifies it" instead of dropping
// the record. A Map key, so it can never collide with a real identifier.
const UNKEYED = Symbol('unkeyed');

export function buildLineage(plate, options = {}) {
  const includeAttributes = options.includeAttributes !== false;
  const spec = STAGE_IDENTITY;
  const idOf = (stageId, record) =>
    record[spec[stageId].field] || (spec[stageId].fallback ? record[spec[stageId].fallback] : null);

  // ── Collect the units each stage produced ────────────────────────────────
  const heats = new Map();   // heatId  -> { records, slabs:Set }
  const slabs = new Map();   // slabId  -> { records, heatId, plates:Map }
  const plates = new Map();  // plateId -> { records, slabId, dispatches }

  for (const record of plate.records.casting || []) {
    const heatId = record.heatId;
    // A casting row with no heat id is NOT skipped. It is collected under a
    // sentinel key and surfaced as a "No heat id" unit, because dropping it would
    // lose a real production event — and the "no identifier" case is exactly what
    // a reader needs to see rather than have silently vanish.
    const key = heatId || UNKEYED;
    if (!heats.has(key)) heats.set(key, { records: [], slabs: new Set() });
    const heat = heats.get(key);
    heat.records.push(record);
    // Remember the casting row against the slab it names. A slab the rolling
    // extract never reports would otherwise have no date at all, even though
    // casting dated it — and every node in this chart has to be able to say when
    // it happened.
    if (record.slabId) {
      if (!slabs.has(record.slabId)) {
        slabs.set(record.slabId, {
          records: [], castingRecords: [], heatId: null, plates: new Map(),
        });
      }
      slabs.get(record.slabId).castingRecords.push(record);
    }
    if (record.slabId) heat.slabs.add(record.slabId);
  }

  for (const record of plate.records.rolling || []) {
    const slabId = record.slabId;
    if (!slabId) continue;
    if (!slabs.has(slabId)) {
      // A slab can be seen only by casting, only by rolling, or by both. The set
      // has to hold the union: a plate is cut from a slab whether or not the
      // rolling extract happens to carry that slab, and joining on rolling alone
      // drops plates whose slab was never rolled under this order.
      slabs.set(slabId, { records: [], heatId: null, plates: new Map() });
    }
    slabs.get(slabId).records.push(record);
  }
  // Attach each slab to the heat that melted it. The relation is a prefix, so it
  // is exact: take the LONGEST heat id the slab starts with, which is what puts
  // F6000101 under F60001 rather than under a shorter accidental match.
  for (const [slabId, slab] of slabs) {
    let best = null;
    for (const heatId of heats.keys()) {
      // The unkeyed bucket is a Symbol, not text: it is not a heat any slab can
      // descend from, and String(symbol) would throw on startsWith.
      if (typeof heatId !== 'string') continue;
      if (!slabId.startsWith(heatId)) continue;
      if (!best || heatId.length > best.length) best = heatId;
    }
    slab.heatId = best;
  }
  // Casting already seeded every slab it names above, so there is no separate
  // pass for casting-only slabs: they are in the set, with no rolling records
  // and a date taken from the casting row.

  for (const record of plate.records.finishing || []) {
    const plateId = idOf('finishing', record);
    if (!plateId) continue;
    if (!plates.has(plateId)) plates.set(plateId, { records: [], slabId: null, dispatches: [] });
    const entry = plates.get(plateId);
    entry.records.push(record);
    const stem = plateStem(plateId);
    if (slabs.has(stem)) {
      entry.slabId = stem;
      slabs.get(stem).plates.set(plateId, entry);
    }
  }
  // A plate whose stem is not a slab this order rolled is attached at the heat
  // level by prefix where possible, and otherwise left for the holding node.
  for (const entry of plates.values()) {
    if (entry.slabId) continue;
    const stem = plateStem(idOf('finishing', entry.records[0]) || '');
    let best = null;
    for (const heatId of heats.keys()) {
      if (typeof heatId !== 'string') continue;
      if (!stem.startsWith(heatId)) continue;
      if (!best || heatId.length > best.length) best = heatId;
    }
    entry.heatId = best || null;
  }

  for (const record of plate.records.dispatch || []) {
    const plateId = idOf('dispatch', record);
    if (!plateId) continue;
    if (!plates.has(plateId)) {
      plates.set(plateId, { records: [], slabId: null, dispatches: [], noFinishing: true });
    }
    plates.get(plateId).dispatches.push(record);
  }

  const childrenOf = (id, recs, stageId) => recs.map((record, i) => ({
    id: `${id}::rec::${i}`,
    kind: 'record',
    stageId,
    label: record.date || recordHeadline(record, stageId),
    sublabel: truncateish(recordHeadline(record, stageId)),
    record,
    children: [],
    tooltip: recordTooltip(record, stageId),
  }));

  const plateNode = (plateId, entry) => {
    const id = `${plate.key}::plate::${plateId || 'none'}`;
    const children = childrenOf(id, entry.records, 'finishing');
    // Dispatch is the last stop, and it is where the shipment lives, so the
    // dispatch records hang off the plate they shipped rather than being
    // summarised away.
    entry.dispatches.forEach((record, i) => {
      children.push({
        id: `${id}::dispatch::${i}`,
        kind: 'record',
        stageId: 'dispatch',
        // `continues`: the dispatch row is the destination of the route, so it is
        // drawn whenever its plate is, without the reader having to click to see
        // that the plate shipped. Expanding it reveals the characteristics.
        continues: true,
        label: record.billNo || record.vehicleNo || record.date || 'Dispatch',
        sublabel: record.date || '',
        record,
        children: includeAttributes ? attributeNodes(record) : [],
        tooltip: recordTooltip(record, 'dispatch'),
      });
    });
    return {
      id,
      kind: 'ident',
      continues: true,
      stageId: 'finishing',
      identityKind: 'Plate ID',
      label: plateId || 'No plate id',
      sublabel: entry.dispatches.length ? `${entry.dispatches.length} dispatch` : '',
      // A plate dispatch reported but finishing never did still has a date: the
      // bill date. Falling back keeps the "date on every node" promise true for
      // the plates the finishing extract happens to be missing.
      date: earliest(entry.records.length ? entry.records : entry.dispatches),
      missing: !plateId || !!entry.noFinishing,
      children,
      tooltip: identityTooltip('Plate ID', plateId,
        entry.records.length ? entry.records : entry.dispatches,
        entry.dispatches.length ? 'dispatch' : 'finishing'),
    };
  };

  // ── Assemble the lineage ─────────────────────────────────────────────────
  const heatNodes = [];
  for (const [key, heat] of heats) {
    const unkeyed = key === UNKEYED;
    const heatId2 = `${plate.key}::heat::${unkeyed ? '(none)' : key}`;
    const heatNode = {
      id: heatId2,
      kind: 'ident',
      continues: true,
      stageId: 'casting',
      identityKind: unkeyed ? '' : 'Heat ID',
      label: unkeyed ? 'No heat id' : key,
      sublabel: '',
      date: earliest(heat.records),
      missing: unkeyed,
      children: [],
      tooltip: identityTooltip('Heat ID', unkeyed ? '' : key, heat.records, 'casting'),
    };
    for (const slabId of heat.slabs) {
      const slab = slabs.get(slabId);
      if (!slab) continue;
      const slabId2 = `${heatId2}::slab::${slabId}`;
      const slabNode = {
        id: slabId2,
        kind: 'ident',
        continues: true,
        stageId: 'rolling',
        identityKind: 'Slab ID',
        label: slabId,
        sublabel: '',
        // A slab casting named but rolling never reported still has a date: the
        // casting row that named it. Falling back to casting is what keeps the
        // "date on every node" promise true for the units that only one extract
        // knows about.
        date: earliest(slab.records.length ? slab.records : slab.castingRecords),
        // Dashed, not dropped: a slab casting named but rolling never reported is
        // exactly the kind of gap this chart exists to show.
        missing: !slab.records.length,
        // The casting rows that produced this slab are shown under it as well as
        // the rolling rows, because the slab is where the metal was made. Without
        // them the heat's own records would be invisible anywhere on the chart.
        children: [
          ...childrenOf(`${slabId2}::cast`, slab.castingRecords, 'casting'),
          ...childrenOf(slabId2, slab.records, 'rolling'),
        ],
        tooltip: identityTooltip('Slab ID', slabId,
          slab.records.length ? slab.records : slab.castingRecords, 'rolling'),
      };
      for (const [plateId, entry] of slab.plates) {
        entry.placed = true;
        slabNode.children.push(plateNode(plateId, entry));
      }
      slab.placed = true;
      heatNode.children.push(slabNode);
    }
    // Plates this heat produced that no slab in this order rolled. They keep
    // their heat parent and ride at the heat level, rather than being dropped.
    for (const [plateId, entry] of plates) {
      if (entry.slabId || entry.heatId !== (unkeyed ? null : key)) continue;
      entry.placed = true;
      heatNode.children.push(plateNode(plateId, entry));
    }
    // A casting row with neither a heat nor a slab has no children of its own, so
    // its records are hung directly on the "No heat id" unit rather than lost.
    if (unkeyed && !heatNode.children.length) {
      heatNode.children = childrenOf(heatId2, heat.records, 'casting');
    }
    heatNodes.push(heatNode);
  }

  // Units with no parent to hang from. Held at the top and clearly labelled, so
  // an incomplete join is visible instead of quietly absent.
  //
  // "No parent" means the unit was never placed ABOVE, not that it is missing
  // below. `placed` records what the heat/slab walk already attached; without it
  // every unit would also be copied into this bucket and the whole lineage would
  // be drawn twice.
  const rootlessSlabs = [...slabs.entries()].filter(([, s]) => !s.heatId && !s.placed);
  const rootlessPlates = [...plates.entries()].filter(([, p]) => !p.slabId && !p.heatId && !p.placed);
  if (rootlessSlabs.length || rootlessPlates.length) {
    const held = [];
    for (const [slabId, slab] of rootlessSlabs) {
      const slabId2 = `${plate.key}::unlinked::slab::${slabId}`;
      held.push({
        id: slabId2,
        kind: 'ident',
        stageId: 'rolling',
        identityKind: 'Slab ID',
        label: slabId,
        sublabel: '',
        date: earliest(slab.records.length ? slab.records : slab.castingRecords),
        missing: true,
        children: [...childrenOf(slabId2, slab.records, 'rolling'),
          ...[...slab.plates].map(([id, e]) => plateNode(id, e))],
        tooltip: [['Unlinked', 'No casting row names this heat']],
      });
    }
    for (const [plateId, entry] of rootlessPlates) {
      held.push(plateNode(plateId, entry));
    }
    heatNodes.push({
      id: `${plate.key}::unlinked`,
      kind: 'holding',
      stageId: 'rolling',
      label: 'Not linked to a parent',
      sublabel: `${held.length} unit${held.length === 1 ? '' : 's'}`,
      // The bucket is dated by what it holds, so it satisfies the same
      // "every node has a date" rule as the rest of the chart.
      date: earliestDateOf(held),
      missing: true,
      children: held,
      tooltip: [
        ['Unlinked units', String(held.length)],
        ['Why', 'No casting heat or rolled slab in this order accounts for these identifiers'],
      ],
    });
  }

  const allDates = [plate.firstDate, plate.soDate].filter(Boolean).sort();
  return {
    id: plate.key,
    kind: 'order',
    label: 'SO ' + plate.so,
    sublabel: 'Item ' + plate.lineItem,
    date: allDates.length ? allDates[0] : '',
    children: heatNodes,
    meta: {
      grade: plate.grade,
      extGrade: plate.extGrade,
      customer: plate.customer,
      weight: plate.weight,
      confidence: plate.linkConfidence,
    },
    tooltip: orderTooltip(plate),
  };
}

// The earliest date across a group of records, for the node's own date line.
function earliest(records) {
  const dates = records.map((r) => r.date).filter(Boolean).sort();
  return dates.length ? dates[0] : '';
}

// The earliest date across a group of NODES, for a grouping node that has no
// records of its own.
function earliestDateOf(nodes) {
  const dates = nodes.map((n) => n.date).filter(Boolean).sort();
  return dates.length ? dates[0] : '';
}

// The old four-panel builder, kept for the "which stages does this order have?"
// question. The default view no longer uses it.
export function buildTree(plate, options = {}) {
  const includeAttributes = options.includeAttributes !== false;
  const spine = options.spine === 'chain' ? 'chain' : 'siblings';
  const root = {
    id: plate.key,
    kind: 'order',
    label: 'SO ' + plate.so,
    sublabel: 'Item ' + plate.lineItem,
    depth: 0,
    children: [],
    meta: {
      grade: plate.grade,
      extGrade: plate.extGrade,
      customer: plate.customer,
      weight: plate.weight,
      confidence: plate.linkConfidence,
    },
    tooltip: orderTooltip(plate),
  };

  const stageNodes = [];
  for (const stageId of STAGE_IDS) {
    const stage = plate.stages[stageId];
    const records = plate.records[stageId] || [];
    // What this stage produces, and how many of them. Stated on the node itself
    // so the chain is readable without expanding anything: "Casting — 6 slab IDs".
    const identity = STAGE_IDENTITY[stageId];
    const distinctIds = new Set();
    for (const record of records) if (record[identity.field]) distinctIds.add(record[identity.field]);
    const idCount = distinctIds.size;
    const node = {
      id: plate.key + '::' + stageId,
      kind: 'stage',
      stageId,
      label: STAGE_LABEL[stageId],
      sublabel: stage.present
        ? (idCount + ' ' + identity.kind.toLowerCase() + (idCount === 1 ? '' : 's'))
        : 'No record',
      depth: 1,
      missing: !stage.present,
      children: [],
      meta: {
        first: stage.first,
        last: stage.last,
        durationDays: stage.durationDays,
        status: stage.status,
        count: stage.count,
      },
      // The stage's own characteristics, so hovering a stage node answers what
      // happened there without expanding it. Aggregated from its records, with
      // the spread reported when the records disagree.
      tooltip: stageTooltip(plate, stageId),
    };
    // In chain view the children are the identifiers the stage produced — the
    // slabs it cast, the plates it finished — because following one unit across
    // the pipeline is the whole point of that view. Siblings view keeps the flat
    // list of records, which is what "which rows exist?" needs.
    node.children = spine === 'chain'
      ? identityNodes(plate, stageId, records)
      : records.map((record, index) => ({
        id: plate.key + '::' + stageId + '::' + index,
        kind: 'record',
        stageId,
        label: recordHeadline(record, stageId),
        sublabel: record.date || '',
        depth: 2,
        record,
        children: includeAttributes ? attributeNodes(record) : [],
        tooltip: recordTooltip(record, stageId),
      }));
    stageNodes.push(node);
  }

  if (spine === 'chain') {
    // Nest each stage inside the previous one. A stage with no records still
    // carries the next stage, so the route stays unbroken and the gap shows as
    // a dashed node rather than a truncated branch.
    //
    // The next stage goes FIRST among the children and is flagged `continues`,
    // so layoutTree's per-node child limit can never truncate the spine away —
    // otherwise a plate with thousands of dispatch rows would hide the very node
    // the chain exists to show.
    // Walked BACKWARDS. Each node must be fully built before it is copied into
    // its parent, otherwise the copy is a snapshot taken before the deeper
    // stages were attached and the chain would stop one stage early.
    for (let i = stageNodes.length - 2; i >= 0; i -= 1) {
      const node = stageNodes[i];
      node.children = [{ ...stageNodes[i + 1], continues: true }, ...node.children];
    }
    root.children = stageNodes.slice(0, 1);
  } else {
    root.children = stageNodes;
  }
  return root;
}

function orderTooltip(plate) {
  const lines = [['Sales Order', plate.so], ['Line Item', plate.lineItem]];
  if (plate.grade) lines.push(['Internal grade', plate.grade]);
  if (plate.extGrade) lines.push(['External grade', plate.extGrade]);
  if (plate.customer) lines.push(['Customer', plate.customer]);
  if (plate.weight !== null && plate.weight !== undefined) lines.push(['Total weight', plate.weight + ' t']);
  if (plate.batch) lines.push(['Batch', plate.batch]);
  // Order-book context from EBTP, so the order node answers what was ordered and
  // what is still outstanding, not just what has been produced.
  if (plate.orderQty !== null && plate.orderQty !== undefined) lines.push(['Order qty', plate.orderQty + ' t']);
  if (plate.delivered !== null && plate.delivered !== undefined) lines.push(['Delivered', plate.delivered + ' t']);
  if (plate.balanceToDeliver) lines.push(['Balance to deliver', plate.balanceToDeliver + ' t']);
  if (plate.soDate) lines.push(['SO date', plate.soDate]);
  if (plate.firstPromiseDate) lines.push(['First promise', plate.firstPromiseDate]);
  if (plate.lastPromiseDate) lines.push(['Last promise', plate.lastPromiseDate]);
  if (plate.orderStatus) lines.push(['Order status', plate.orderStatus]);
  if (plate.paymentStatus) lines.push(['Payment status', plate.paymentStatus]);
  if (plate.orderRemarks) lines.push(['Remarks', plate.orderRemarks]);
  lines.push(['Stages present', plate.presentStages + ' of ' + plate.stageCount]);
  lines.push(['Link confidence', plate.linkConfidence]);
  return lines;
}

// The stage tooltip carries that stage's own characteristics, so hovering a
// stage node answers "what happened here" without expanding it. Values are
// aggregated across the stage's records, and a range is shown when they
// disagree — a single number would misrepresent a stage whose plates varied.
function stageTooltip(plate, stageId) {
  const stage = plate.stages[stageId];
  const records = plate.records[stageId] || [];
  if (!stage.present) {
    return [
      ['Stage', STAGE_LABEL[stageId]],
      ['Status', 'No record in this extract'],
      ['Source', SOURCES[stageId].label],
    ];
  }
  const lines = [
    ['Stage', STAGE_LABEL[stageId]],
    ['Records', String(stage.count)],
    ['First', stage.first || '—'],
    ['Last', stage.last || '—'],
  ];
  if (stage.durationDays !== null) lines.push(['Span', stage.durationDays + ' day(s)']);
  if (stage.status) lines.push(['Status', stage.status]);

  // The physical characteristics this stage recorded. Only values the stage
  // actually carries are listed, so the tooltip never implies a measurement the
  // extract did not make.
  const range = (values, unit) => {
    const label = rangeLabel(values);
    return label === null ? null : label.replace(/ mm$/, unit);
  };
  const distinct = (values) => {
    const set = new Set(values.filter((v) => v !== undefined && v !== null && v !== '').map(String));
    if (!set.size) return null;
    const list = [...set];
    return list.length === 1 ? list[0] : list.slice(0, 3).join(', ') + ` (+${list.length - 3})`;
  };

  const thickness = range(records.map((r) => r.thicknessMm), ' mm');
  const width = range(records.map((r) => r.widthMm), ' mm');
  const length = range(records.map((r) => r.lengthMm), ' mm');
  if (thickness) lines.push(['Thickness', thickness]);
  if (width) lines.push(['Width', width]);
  if (length) lines.push(['Length', length]);

  const weight = records.reduce((a, r) => a + (typeof r.weight === 'number' ? r.weight : 0), 0);
  if (weight) lines.push(['Weight', round(weight, 3) + ' t']);

  const grade = distinct(records.map((r) => r.grade));
  if (grade) lines.push(['Internal grade', grade]);
  const extGrade = distinct(records.map((r) => r.extGrade));
  if (extGrade) lines.push(['External grade', extGrade]);
  const customer = distinct(records.map((r) => r.customer));
  if (customer) lines.push(['Customer', customer]);

  // The identifier that stage keys on, so the stage can be tied to the physical
  // unit: slab at the front, batch once the plate exists, invoice at dispatch.
  const idField = stageId === 'dispatch' ? 'billNo'
    : stageId === 'finishing' ? 'batch'
      : 'slabId';
  const id = distinct(records.map((r) => r[idField]));
  if (id) lines.push([idField === 'billNo' ? 'Bill no' : idField === 'batch' ? 'Batch' : 'Slab id', id]);

  lines.push(['Source', SOURCES[stageId].label]);
  return lines;
}

/* ═══════════════════ STAGE IDENTITY ═══════════════════
   What each stage produces, and what the chain calls it.

   Casting and rolling key on a SLAB. Once the slab has been finished into a
   plate, the plate's identity is the BATCH, and both finishing and dispatch
   carry it — so the chain reads Slab IDs up front and Plate IDs from finishing
   onwards, which is the same unit being followed across the pipeline.

   Rolling has no batch of its own: the extract gives it SLAB_ID and nothing
   else, so it is reported as the slab it is rather than given a plate id it
   does not have. Dispatch also carries a Bill No, but a bill is an invoice, not
   a plate, so the plate identity stays the batch. */

export const STAGE_IDENTITY = {
  casting: { field: 'heatId', kind: 'Heat ID', fallback: 'slabId' },
  rolling: { field: 'slabId', kind: 'Slab ID', fallback: 'slabId' },
  finishing: { field: 'batch', kind: 'Plate ID', fallback: 'materialDoc' },
  dispatch: { field: 'batch', kind: 'Plate ID', fallback: 'billNo' },
};

// The trace reads as one lineage, not four stage panels:
//
//   Heat F63910 → Slab F6391001 → Plate F6391001A0 → Dispatch F6391001A0
//
// so each stage contributes the unit it HANDED ON, not the unit it worked on.
// Casting yields the heat that melted; rolling yields the slab; finishing yields
// the plate; dispatch reports the same plate again, and is where its shipment
// characteristics live.
//
// Rolling used to be keyed on the slab too, which made casting and rolling show
// the same id twice with nothing between them. Keying casting on the heat puts a
// real parent above the slab, which is what makes the chain followable.

// The id a plate carries is its slab id plus a short suffix marking the cut
// position — F6391001 + A0 → F6391001A0. Stripping the suffix recovers the slab
// the plate was cut from. This is the join between rolling and finishing, and it
// is checked against the data rather than assumed: see verifyLineage().
export function plateStem(batch) {
  const id = String(batch || '').trim();
  const m = id.match(/^(.+?)[A-Z]\d{1,2}$/);
  return m ? m[1] : id;
}

// Groups a stage's records by the identifier that stage produces, one node per
// distinct identifier. This is what makes the chain read
// SO > Casting > F6000101, G6157801 > Rolling > … rather than a flat list of
// identical-looking rows.
function identityNodes(plate, stageId, records) {
  const { field, kind } = STAGE_IDENTITY[stageId];
  const grouped = new Map();
  for (const record of records) {
    const id = record[field];
    if (!id) continue;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(record);
  }
  const nodes = [];
  for (const [id, recs] of grouped) {
    nodes.push({
      id: plate.key + '::' + stageId + '::id::' + id,
      kind: 'ident',
      stageId,
      identityKind: kind,
      identityField: field,
      label: id,
      sublabel: recs.length + (recs.length === 1 ? ' record' : ' records'),
      depth: 2,
      // The records behind this identifier stay available one click further
      // down, so grouping never hides them — it only names the plate.
      children: recs.map((record, i) => ({
        id: plate.key + '::' + stageId + '::id::' + id + '::' + i,
        kind: 'record',
        stageId,
        label: record.date || recordHeadline(record, stageId),
        sublabel: truncateish(recordHeadline(record, stageId)),
        depth: 3,
        record,
        children: [],
        tooltip: recordTooltip(record, stageId),
      })),
      tooltip: identityTooltip(kind, id, recs, stageId),
    });
  }
  // Records that carry no identifier at all would otherwise vanish from the
  // chain. They are kept as an explicitly unnamed group rather than dropped.
  const unkeyed = records.filter((r) => !r[field]);
  if (unkeyed.length) {
    nodes.push({
      id: plate.key + '::' + stageId + '::id::(none)',
      kind: 'ident',
      stageId,
      identityKind: kind,
      label: 'No ' + kind.toLowerCase(),
      sublabel: unkeyed.length + (unkeyed.length === 1 ? ' record' : ' records'),
      depth: 2,
      missing: true,
      children: unkeyed.map((record, i) => ({
        id: plate.key + '::' + stageId + '::id::(none)::' + i,
        kind: 'record',
        stageId,
        label: record.date || recordHeadline(record, stageId),
        sublabel: truncateish(recordHeadline(record, stageId)),
        depth: 3,
        record,
        children: [],
        tooltip: recordTooltip(record, stageId),
      })),
      tooltip: identityTooltip(kind, '', unkeyed, stageId),
    });
  }
  return nodes;
}

function truncateish(s) {
  const str = String(s == null ? '' : s);
  return str.length > 18 ? str.slice(0, 17) + '…' : str;
}

// The tooltip for one identifier: what it is, what it weighs, and over what
// period — the questions you ask of a slab or a plate.
function identityTooltip(kind, id, recs, stageId) {
  const lines = [[kind, id || 'not recorded']];
  lines.push(['Stage', STAGE_LABEL[stageId]]);
  lines.push(['Records', String(recs.length)]);
  const dates = recs.map((r) => r.date).filter(Boolean).sort();
  // Every tooltip in the chart carries a date. A lineage is a sequence in time,
  // and a node that could not say when it happened is only half the answer.
  if (dates.length) lines.push(['Date', dates[0]]);
  if (dates.length) lines.push(['First', dates[0]]);
  if (dates.length > 1) lines.push(['Last', dates[dates.length - 1]]);
  else if (dates.length === 1) lines.push(['Last', dates[0]]);
  let weight = 0;
  for (const r of recs) if (typeof r.weight === 'number') weight += r.weight;
  if (weight) lines.push(['Weight', round(weight, 3) + ' t']);
  const thk = rangeLabel(recs.map((r) => r.thicknessMm));
  if (thk) lines.push(['Thickness', thk]);
  const wid = rangeLabel(recs.map((r) => r.widthMm));
  if (wid) lines.push(['Width', wid]);
  return lines;
}

// Shared by the stage and identifier tooltips so a value reads the same
// wherever it appears. Returns null when there is nothing to show.
function rangeLabel(values) {
  let min = Infinity;
  let max = -Infinity;
  let n = 0;
  // Reduced in a loop, never Math.min(...values): a stage can hold tens of
  // thousands of records, and spreading them into one call overflows the
  // engine's argument limit.
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    n += 1;
  }
  if (!n) return null;
  const fmt = (x) => (Number.isInteger(x) ? String(x) : String(round(x, 2)));
  return min === max ? fmt(min) + ' mm' : fmt(min) + '–' + fmt(max) + ' mm';
}

function recordHeadline(record, stageId) {
  if (stageId === 'casting') return record.slabId || record.heatId || 'Slab';
  if (stageId === 'rolling') return record.slabId || 'Roll';
  if (stageId === 'finishing') return record.batch || record.materialDoc || 'Batch';
  if (stageId === 'dispatch') return record.billNo || record.batch || 'Invoice';
  return record.key;
}

function recordTooltip(record, stageId) {
  const lines = [['Stage', STAGE_LABEL[stageId]]];
  const push = (label, value) => {
    if (value === null || value === undefined || value === '') return;
    lines.push([label, String(value)]);
  };
  push('Date', record.date);
  push('Slab id', record.slabId);
  push('Heat id', record.heatId);
  push('Batch', record.batch);
  push('Material doc', record.materialDoc);
  push('Bill no', record.billNo);
  push('Vehicle', record.vehicleNo);
  push('Transporter', record.transporter);
  push('Internal grade', record.grade);
  push('External grade', record.extGrade);
  if (record.thicknessMm !== undefined) push('Thickness', record.thicknessMm + ' mm');
  if (record.widthMm !== undefined) push('Width', record.widthMm + ' mm');
  if (record.lengthMm !== undefined) push('Length', record.lengthMm + ' mm');
  if (record.weight !== undefined) push('Weight', record.weight + ' t');
  if (record.yieldPct !== undefined) push('Yield', record.yieldPct.toFixed(2) + ' %');
  push('Status', record.status || record.quality || record.utStatus || record.utLevel);
  push('Quality remark', record.qualityRemark);
  push('Edge condition', record.edgeCondition);
  push('Movement', record.movementType);
  push('From / to', [record.fromSloc, record.toSloc].filter(Boolean).join(' → '));
  push('Ship to', [record.shipTo, record.shipToCity].filter(Boolean).join(', '));
  return lines;
}

// The leaf level: every remaining characteristic, so expanding a record shows
// the complete picture without a second click.
function attributeNodes(record) {
  const nodes = [];
  const ordered = [
    'date', 'slabId', 'heatId', 'batch', 'materialDoc', 'billNo', 'vehicleNo',
    'transporter', 'grade', 'extGrade', 'thicknessMm', 'widthMm', 'lengthMm',
    'weight', 'yieldPct', 'status', 'quality', 'utStatus', 'utLevel',
    'qualityRemark', 'edgeCondition', 'route', 'charging', 'holdReason',
    'movementType', 'fromSloc', 'toSloc', 'mode', 'shipTo', 'shipToCity',
    'customer', 'lotRef', 'rakePoint',
  ];
  const add = (label, value) => {
    if (value === null || value === undefined || value === '') return;
    nodes.push({
      id: 'attr::' + nodes.length + '::' + label,
      kind: 'attribute',
      label,
      value: String(value),
      depth: 3,
      children: [],
    });
  };
  for (const field of ordered) add(field, record[field]);
  for (const [header, value] of Object.entries(record.raw || {})) add(header, value);
  return nodes;
}

/* ═══════════════════ TREE LAYOUT ═══════════════════ */

// Left-to-right layout: depth maps to X, sibling order maps to Y. Node boxes
// are fixed-size so the maths stays DOM-free and unit-testable.
//
// Ident nodes are taller than records because they carry a second line: the date.
// Every node in the lineage shows when it happened, and a unit that cannot say
// so is a unit you have to hover to understand.
export const LAYOUT = {
  colWidth: 268,
  rowHeight: 40,
  rowGap: 10,
  padding: 20,
  nodeWidth: 232,
  nodeHeight: 30,
  // Ident nodes (heat / slab / plate) and the order node are the tall ones.
  identHeight: 44,
  attrHeight: 24,
};

function nodeHeightFor(kind) {
  if (kind === 'attr' || kind === 'record') return LAYOUT.attrHeight;
  return LAYOUT.identHeight;
}

export function layoutTree(root, expandedIds = new Set(), options = {}) {
  const colWidth = options.colWidth || LAYOUT.colWidth;
  const rowHeight = options.rowHeight || LAYOUT.rowHeight;
  const rowGap = options.rowGap || LAYOUT.rowGap;
  const nodeWidth = options.nodeWidth || LAYOUT.nodeWidth;
  const nodeHeight = options.nodeHeight || LAYOUT.nodeHeight;
  const padding = options.padding === undefined ? LAYOUT.padding : options.padding;
  const limit = options.limit || Infinity;

  const positions = [];
  const edges = [];
  let cursorY = padding;

  // Post-order walk: a node's Y is the vertical centre of its children's span,
  // which is what makes the elbow connectors read as a tree rather than a list.
  const visit = (node, depth) => {
    const x = padding + depth * colWidth;
    const nodeHeight = options.nodeHeight || nodeHeightFor(node.kind);
    const isExpanded = expandedIds.has(node.id) && node.children.length > 0;
  // Which children are always drawn. Only nodes the LINEAGE marks `continues` are:
  // the units of the route, and the dispatch rows that are the point of the last
  // column. Marking them in buildLineage rather than inferring from `kind` keeps
  // the stage tree's behaviour unchanged — there, an identifier node is a thing
  // you expand, not a thing that is always shown.
  //
  // The spine is capped by the limit too, so a plate with a very large dispatch
  // history still cannot draw an unbounded number of nodes.
  const spineChildren = node.children.filter((c) => c.continues).slice(0, limit);
  const restChildren = node.children.filter((c) => !c.continues);
  const visibleChildren = isExpanded
    ? [...spineChildren, ...restChildren.slice(0, Math.max(0, limit - spineChildren.length))]
    : spineChildren;

    let y;
    const childGeometry = [];
    if (!visibleChildren.length) {
      y = cursorY;
      cursorY += nodeHeight + rowGap;
    } else {
      // visit() returns this node's box, not the pushed record, so the geometry
      // has to be collected as it is produced — reading x/h off the child NODE
      // objects (which have neither) is what produced NaN connector paths.
      for (const child of visibleChildren) childGeometry.push(visit(child, depth + 1));
      y = (childGeometry[0].y + childGeometry[childGeometry.length - 1].y) / 2;
    }

    positions.push({
      id: node.id,
      kind: node.kind,
      stageId: node.stageId,
      label: node.label,
      sublabel: node.sublabel,
      value: node.value,
      // Carried through so the renderer can label a node "Slab ID F6000101"
      // without having to look the node back up in the tree.
      identityKind: node.identityKind,
      // Drawn on the node itself, so the date is readable without a hover.
      date: node.date,
      depth,
      x,
      y: y - nodeHeight / 2,
      w: nodeWidth,
      h: nodeHeight,
      hasChildren: node.children.length > 0,
      expanded: isExpanded,
      truncated: isExpanded && node.children.length > visibleChildren.length,
      missing: !!node.missing,
      tooltip: node.tooltip,
      meta: node.meta,
    });

    childGeometry.forEach((childBox, index) => {
      edges.push({
        id: node.id + '->' + visibleChildren[index].id,
        from: { x: x + nodeWidth, y },
        to: { x: childBox.x, y: childBox.y + childBox.h / 2 },
      });
    });
    return { x, y, h: nodeHeight };
  };

  const rootPosition = visit(root, 0);

  const width = positions.reduce((acc, p) => Math.max(acc, p.x + p.w), 0) + padding;
  const height = Math.max(cursorY, rootPosition.y + (rootPosition.h || nodeHeightFor(root.kind))) + padding;
  return { positions, edges, width, height };
}

// Orthogonal elbow connector between a parent and child, in the coordinate
// space layoutTree() returns.
export function elbowPath(edge) {
  const midX = edge.from.x + (edge.to.x - edge.from.x) / 2;
  return 'M ' + edge.from.x + ' ' + edge.from.y +
    ' H ' + midX +
    ' V ' + edge.to.y +
    ' H ' + edge.to.x;
}

// The default view: the stage spine is visible, everything below it is closed.
//
// Only the root goes in the expanded set. Adding a stage node here would, by
// layoutTree's own semantics, render that stage's records — which is the
// opposite of what "collapsed until expanded" means, and on a plate with
// thousands of dispatch rows it would build the whole subtree unasked.
export function defaultExpandedIds(root, options = {}) {
  const ids = new Set([root.id]);
  // The stage tree predates the lineage and has no `continues` spine, so its
  // shapes keep their own expansion rules: siblings opens only the root, chain
  // opens every stage node so the route reads end to end.
  if (options.spine === 'siblings') return ids;
  if (options.spine === 'chain') {
    const walkStages = (node) => {
      for (const child of node.children || []) {
        if (child.kind === 'stage') { ids.add(child.id); walkStages(child); }
      }
    };
    walkStages(root);
    return ids;
  }

  // The lineage: only the root. Every unit of the route, and every dispatch row,
  // is flagged `continues` by buildLineage, and layoutTree draws those from the
  // parent's own expansion — so the whole lineage appears without a single extra
  // id here. The earlier stages' records are deliberately NOT expanded: they are
  // the thing a click is for, and a plate can carry thousands of them.
  return ids;
}

/* ═══════════════════ SEARCH ═══════════════════ */

export function searchPlates(list, query, options = {}) {
  const text = String(query || '').trim().toLowerCase();
  const { stages, from, to, grade, limit = 500, slicers } = options;
  const out = [];
  for (const plate of list) {
    if (stages && stages.length && !stages.some((s) => plate.stages[s]?.present)) continue;
    if (from && (!plate.lastDate || plate.lastDate < from)) continue;
    if (to && (!plate.firstDate || plate.firstDate > to)) continue;
    if (grade && normalizeHeader(plate.grade) !== normalizeHeader(grade)) continue;
    if (slicers && !matchesSlicers(plate, slicers)) continue;
    if (text && !plateMatches(plate, text)) continue;
    out.push(plate);
    if (out.length >= limit) break;
  }
  return out;
}

// Slicers are order-book attributes, so they are matched against the EBTP
// record rather than the production data. A plate with no order record cannot
// satisfy an order filter — showing it would be claiming it is a "Captive" order
// when nothing says so.
function matchesSlicers(plate, slicers) {
  const fields = Object.keys(slicers);
  if (!fields.length) return true;
  const orders = plate.orders || [];
  if (!orders.length) return false;
  for (const field of fields) {
    const wanted = slicers[field];
    if (!wanted || !wanted.size) continue;
    // so / lineItem are the key themselves rather than a copied field, so they
    // are read from the plate directly; the rest come off the order record.
    let value = field === 'so' ? plate.so
      : field === 'lineItem' ? plate.lineItem
        : null;
    if (value === null) {
      for (const order of orders) {
        if (order[field] !== undefined && order[field] !== null && order[field] !== '') {
          value = order[field];
          break;
        }
      }
    }
    if (value === null || value === undefined) return false;
    if (!wanted.has(String(value))) return false;
  }
  return true;
}

// The slicers offered above the table, and the order field each one reads.
// These are all EBTP columns: they describe how an order is placed and fulfilled,
// which production extracts do not carry.
export const SLICERS = [
  { field: 'remarks', label: 'Remarks' },
  { field: 'mode', label: 'Mode' },
  { field: 'customer', label: 'Customer Name' },
  { field: 'so', label: 'SO No.' },
  { field: 'lineItem', label: 'Line Item' },
  { field: 'supplyCondition', label: 'Supply Condition' },
  { field: 'inspBy', label: 'Inspection By' },
  { field: 'customerType', label: 'Domestic / Export' },
];

// The distinct values a slicer can offer, with a count for each, so the list
// shows what selecting a value would actually buy. Built from the loaded plates
// rather than from every order, so it never offers a filter that matches nothing.
export function slicerValues(list, field) {
  const counts = new Map();
  for (const plate of list) {
    const seen = new Set();
    for (const order of plate.orders || []) {
      let value = field === 'so' ? plate.so
        : field === 'lineItem' ? plate.lineItem
          : order[field];
      if (value === undefined || value === null) continue;
      const text = String(value).trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      counts.set(text, (counts.get(text) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function plateMatches(plate, text) {
  if (plate.key.toLowerCase().includes(text)) return true;
  if ((plate.customer || '').toLowerCase().includes(text)) return true;
  if ((plate.grade || '').toLowerCase().includes(text)) return true;
  if ((plate.extGrade || '').toLowerCase().includes(text)) return true;
  if ((plate.batch || '').toLowerCase().includes(text)) return true;
  if ((plate.slabId || '').toLowerCase().includes(text)) return true;
  // Order-book context, so an order can be found by its status or remarks too.
  if ((plate.orderStatus || '').toLowerCase().includes(text)) return true;
  if ((plate.orderRemarks || '').toLowerCase().includes(text)) return true;
  for (const record of plate.orders || []) {
    if ((record.remarks || '').toLowerCase().includes(text)) return true;
    if ((record.currentStatus || '').toLowerCase().includes(text)) return true;
  }
  for (const stageId of STAGE_IDS) {
    for (const record of plate.records[stageId] || []) {
      if (record.batch && record.batch.toLowerCase().includes(text)) return true;
      if (record.billNo && record.billNo.toLowerCase().includes(text)) return true;
      if (record.slabId && record.slabId.toLowerCase().includes(text)) return true;
      if (record.materialDoc && record.materialDoc.toLowerCase().includes(text)) return true;
    }
  }
  return false;
}

/* ═══════════════════ SUMMARY ═══════════════════ */

// Aggregate figures for the header strip, computed from real records only.
export function summarise(list) {
  const summary = {
    total: list.length,
    byStage: Object.fromEntries(STAGE_IDS.map((id) => [id, 0])),
    complete: 0,
    weight: 0,
    hasWeight: false,
    from: null,
    to: null,
  };
  for (const plate of list) {
    for (const stageId of STAGE_IDS) {
      if (plate.stages[stageId].present) summary.byStage[stageId] += 1;
    }
    if (plate.complete) summary.complete += 1;
    if (plate.weight !== null) { summary.weight += plate.weight; summary.hasWeight = true; }
    if (plate.firstDate && (!summary.from || plate.firstDate < summary.from)) summary.from = plate.firstDate;
    if (plate.lastDate && (!summary.to || plate.lastDate > summary.to)) summary.to = plate.lastDate;
  }
  summary.weight = summary.hasWeight ? round(summary.weight, 2) : null;
  return summary;
}
