// Plate Tracker — parse worker.
//
// Parsing runs here rather than on the page because the largest extract
// (dispatch) is 133k rows across 51 columns: doing that on the main thread
// would freeze the UI for seconds and the progress bar could not paint.
//
// This is a CLASSIC worker, not a module worker. SheetJS is a classic script
// that publishes a global, and a module worker cannot call importScripts() —
// so the parser is loaded the classic way and the shared core is pulled in with
// a dynamic import(), which module workers alone would allow. Loading both that
// way works in a classic worker and keeps the two files shareable.

importScripts('./plate-tracker-xlsx.js');

// NOTE: do not re-declare XLSX here. The vendored bundle is a classic script
// that already defines `var XLSX` in this worker's global scope, so a second
// `const XLSX` is a redeclaration SyntaxError that kills the whole worker.
// Reference the global the bundle published instead.

// Column-probe set used to auto-route a dropped file to a stage. Each source
// declares columns distinctive to it, so a file is identified from its header
// row alone rather than trusting its filename.
const PROBE = {
  casting: ['SO', 'Line item', 'Slab id', 'Heat id'],
  rolling: ['SO', 'Line Item', 'SLAB_ID', 'Rolling Status'],
  finishing: ['Sales Order', 'BATCH', 'MATERIAL DOC.', 'S_SLOC'],
  dispatch: ['SO No.', 'SO Item', 'Bill No.', 'Vehicle No.'],
  ebtp: ['SO No.', 'SOItm', 'UID', 'Current Order Status'],
  slabStock: ['Batch', 'Total Qty', 'LOCATION', 'ROLLABLE STATUS', 'HEAT ID'],
  plateStock: ['Batch', 'Total Qty', 'Storage Bin', 'Crane Area', 'SLAB ID'],
};

const norm = (h) => String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');

// How many of a source's probe columns the header row actually contains.
function scoreHeaders(headers, sourceId) {
  const present = new Set(headers.map(norm));
  let score = 0;
  for (const probe of PROBE[sourceId]) if (present.has(norm(probe))) score += 1;
  return score;
}

// Identifies which stage a workbook belongs to, by its headers. The filename
// is only a tiebreaker hint, never the deciding factor — a re-export named
// "final_v2.xlsx" still has to land in the right slot.
// The core is the same pure module the unit tests cover, pulled in dynamically
// so this file can stay a classic worker (see the note at the top).
let core = null;

function identifySource(headers, fileName) {
  const scores = core.SOURCE_IDS.map((id) => ({ id, score: scoreHeaders(headers, id) }));
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  // Require a clear majority of the probe columns, otherwise a wrong guess
  // would silently corrupt the trace.
  if (best.score >= 3) return { sourceId: best.id, confident: true, score: best.score };
  const name = String(fileName || '').toLowerCase();
  if (name.includes('cast')) return { sourceId: 'casting', confident: false, score: best.score };
  if (name.includes('roll')) return { sourceId: 'rolling', confident: false, score: best.score };
  if (name.includes('ebtp')) return { sourceId: 'ebtp', confident: false, score: best.score };
  if (name.includes('dispatch')) return { sourceId: 'dispatch', confident: false, score: best.score };
  if (name.includes('slab') && name.includes('stock')) return { sourceId: 'slabStock', confident: false, score: best.score };
  if (name.includes('plate') && name.includes('stock')) return { sourceId: 'plateStock', confident: false, score: best.score };
  if (name.includes('fg')) return { sourceId: 'finishing', confident: false, score: best.score };
  return { sourceId: null, confident: false, score: best.score };
}


// Picks the sheet with the most data rows, since these workbooks carry
// several (casting has four hidden per-slab detail sheets alongside the main
// "2026" tab). Ties break toward the first sheet, which is the primary one.
function pickSheet(workbook, fileName) {
  let best = null;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet || !sheet['!ref']) continue;
    const bounds = XLSX.utils.decode_range(sheet['!ref']);
    const previewRange = {
      s: { r: bounds.s.r, c: bounds.s.c },
      e: { r: Math.min(bounds.e.r, bounds.s.r + 24), c: Math.min(bounds.e.c, bounds.s.c + 255) },
    };
    const preview = XLSX.utils.sheet_to_json(sheet, {
      header: 1, raw: true, defval: '', range: previewRange,
    });
    for (let rowIndex = 0; rowIndex < preview.length; rowIndex += 1) {
      const guess = identifySource(preview[rowIndex] || [], fileName);
      if (!guess.sourceId || guess.score < 3) continue;
      const candidate = { name, sheet, headerIndex: rowIndex, guess, rowCount: bounds.e.r - bounds.s.r + 1 };
      if (!best || candidate.guess.score > best.guess.score ||
        (candidate.guess.score === best.guess.score && candidate.rowCount > best.rowCount)) best = candidate;
    }
  }
  if (!best) return null;
  const rows = XLSX.utils.sheet_to_json(best.sheet, { header: 1, raw: true, defval: '' });
  return { ...best, rows, count: best.rowCount };
}

// Header row detection: the first row that resolves a source's required
// columns. Real exports sometimes carry a title or blank line above the
// header, so the header is not assumed to be row 1.
function findHeaderRow(rows, sourceId) {
  const required = Object.entries(core.SOURCES[sourceId].fields)
    .filter(([, spec]) => spec.required)
    .map(([, spec]) => norm(spec.header));
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i += 1) {
    const present = new Set((rows[i] || []).map(norm));
    const hits = required.filter((h) => present.has(h)).length;
    if (hits === required.length) return i;
  }
  return -1;
}

function parseWorkbook(buffer, fileName) {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
  const sheet = pickSheet(workbook, fileName);
  if (!sheet || !sheet.rows.length) {
    return { ok: false, error: 'No data sheet found in this file.' };
  }

  // Probe the leading rows across every source before committing, so a single
  // pass is enough to route the file.
  const guess = sheet.guess || identifySource(sheet.rows[0] || [], fileName);
  if (!guess.sourceId) {
    return { ok: false, error: 'Could not tell which stage this file belongs to.' };
  }
  const sourceId = guess.sourceId;

  const headerIndex = findHeaderRow(sheet.rows, sourceId);
  if (headerIndex < 0) {
    return { ok: false, error: 'Missing required columns for ' + core.SOURCES[sourceId].label + '.', sourceId };
  }

  const headers = sheet.rows[headerIndex].map((h) => String(h == null ? '' : h).trim());
  const { mapping, missing, matched } = core.resolveColumns(headers, sourceId);
  if (!core.isSourceAcceptable({ mapping, missing, matched })) {
    const needed = missing.filter((m) => m.required).map((m) => m.header);
    return { ok: false, error: 'Missing required column(s): ' + needed.join(', '), sourceId, missing };
  }

  const index = new Map(headers.map((h, i) => [h, i]));
  const records = [];
  let dropped = 0;
  // Rows a source row expanded into. A clubbed casting row ("A//B") becomes two
  // records, so this can exceed the row count — reported so the header can say so
  // rather than leaving the totals quietly inconsistent.
  let splitFrom = 0;
  for (let r = headerIndex + 1; r < sheet.rows.length; r += 1) {
    const raw = sheet.rows[r];
    if (!Array.isArray(raw) || !raw.some((c) => c !== '' && c !== null && c !== undefined)) continue;
    const row = {};
    for (const [field, header] of Object.entries(mapping)) {
      const i = index.get(header);
      row[header] = i === undefined ? undefined : raw[i];
    }
    // One row can yield several records when its identifiers are clubbed.
    const stock = core.STOCK_SOURCE_IDS.includes(sourceId);
    const stockRecord = stock ? core.rowToStockRecord(row, sourceId, mapping) : null;
    const built = stock ? (stockRecord ? [stockRecord] : []) : core.rowToRecords(row, sourceId, mapping);
    for (const rec of built) records.push(rec);
    if (built.length > 1) splitFrom += 1;
    if (!built.length) dropped += 1;
  }

  return {
    ok: true,
    sourceId,
    confident: guess.confident,
    sheet: sheet.name,
    records,
    totalRows: sheet.rows.length - headerIndex - 1,
    dropped,
    splitFrom,
    missingOptional: missing.filter((m) => !m.required).map((m) => m.header),
  };
}

// The worker keeps the accumulated records itself. Files usually arrive one at
// a time (or in a partial batch), so re-sending every previously parsed record
// back across the boundary on each upload would be wasteful — and rebuilding
// from only the newest batch would silently drop the earlier stages, which is
// exactly the "Rolling: not loaded" regression this replaced.
const store = {};
const loadedMeta = {};

// `core` is still null while this module is being evaluated (it arrives via a
// dynamic import on the first message), so the stage buckets are created here
// from a literal list and re-synced by coreInit() once the import lands.
function coreInit() {
  for (const stageId of core.STAGE_IDS) if (!store[stageId]) store[stageId] = [];
}
['casting', 'rolling', 'finishing', 'dispatch', 'ebtp', 'slabStock', 'plateStock'].forEach((id) => { store[id] = []; });

async function ingestFiles(files, id) {
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    self.postMessage({ type: 'progress', id, index: i, total: files.length, name: file.name });
    try {
      const buffer = await file.arrayBuffer();
      const result = parseWorkbook(buffer, file.name);
      if (result.ok) {
        // Append WITHOUT spreading. `push(...records)` passes one argument per
        // record, and the engines cap the argument count (~65k-125k depending on
        // browser). The FG extract yields ~129k records and dispatch ~133k, so
        // that spread died with "RangeError: Maximum call stack size exceeded"
        // and both stages silently reported as not loaded — while the same files
        // parsed fine under Node, which has a far higher limit. Looping, or
        // concat, has no such ceiling and is measurably faster as well.
        const bucket = store[result.sourceId];
        for (let r = 0; r < result.records.length; r += 1) bucket.push(result.records[r]);
        loadedMeta[result.sourceId] = {
          name: file.name,
          sheet: result.sheet,
          records: bucket.length,
          totalRows: result.totalRows,
          dropped: result.dropped,
          splitFrom: result.splitFrom || 0,
          missingOptional: result.missingOptional,
          confident: result.confident,
        };
        self.postMessage({ type: 'file', id, sourceId: result.sourceId, loaded: loadedMeta[result.sourceId] });
      } else {
        self.postMessage({ type: 'file-error', id, name: file.name, sourceId: result.sourceId, error: result.error });
      }
    } catch (err) {
      // Include the stack: a RangeError from a large extract ("Maximum call
      // stack size exceeded") names the failing frame only in the stack, and
      // that frame is what identifies the fix.
      self.postMessage({
        type: 'file-error', id, name: file.name,
        error: (err && err.message) || 'Could not read file',
        stack: (err && err.stack) || '',
      });
    }
  }
}

async function handleJob(event) {
  const { id, files } = event.data || {};
  if (files && files.length) await ingestFiles(files, id);
  // EBTP is order context rather than a production stage, so it is indexed
  // here but never becomes a fifth pipeline stage.
  const { list } = core.buildIndex(store);
  self.postMessage({
    type: 'done', id, plates: list, loaded: loadedMeta,
    stocks: { slab: store.slabStock, plate: store.plateStock },
  });
}

self.onmessage = async (event) => {
  const data = event.data || {};
  if (!core) {
    try {
      core = await import('./plate-tracker-core.mjs');
    } catch (err) {
      self.postMessage({ type: 'fatal', id: data.id, error: 'Could not load the parser core: ' + ((err && err.message) || err) });
      return;
    }
    coreInit();
  }
  if (data.type === 'reset') {
    for (const sourceId of core.SOURCE_IDS) store[sourceId] = [];
    for (const key of Object.keys(loadedMeta)) delete loadedMeta[key];
    self.postMessage({ type: 'reset-done', id: data.id });
    return;
  }
  await handleJob(event);
};
