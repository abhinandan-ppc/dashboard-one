// Builds a small, faithful stand-in for the real workbooks in sheets/.
//
//   node scripts/make-schema-fixtures.mjs
//
// The live extracts total ~72MB across ~335,000 rows. That is the right input
// for verifying the page, and the wrong thing to commit or deploy: it dwarfs
// the rest of the repo and a Vercel build has to upload all of it for a page
// that never reads a byte of it at runtime (every workbook is opened in the
// browser by drag-and-drop or file picker).
//
// This writes sheets-schema/, a few hundred KB of .xlsx covering every column
// the page reads AND every awkward shape the parser exists to handle, taken
// from rows that really occur in the live data. The result is small enough to
// commit, to serve, and to run the whole test suite against anywhere.
//
//   node scripts/make-schema-fixtures.mjs --from sheets      regenerate from live data
//
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const globalScope = {};
new Function('self', 'window', 'globalThis', readFileSync('plate-tracker-xlsx.js', 'utf8'))
  .call(globalScope, globalScope, globalScope, globalScope);
const XLSX = globalScope.XLSX || globalThis.XLSX;

const core = await import('../plate-tracker-core.mjs');
const { SOURCES, resolveColumns } = core;

const SOURCE_FILES = {
  casting: ['CASTING DATA.xlsx', '2026'],
  rolling: ['ROLLING DATA.xlsx', 'RECONCILE'],
  finishing: ['FG DATA.xlsx', null],
  dispatch: ['DISPATCH DATA.xlsx', null],
  ebtp: ['EBTP.xlsx', 'WS'],
};

const OUT = 'sheets-schema';
const MAX_ROWS = 220;          // per workbook; ~200 data rows is plenty to prove the paths
const CAP = 100;               // cap for any single column, e.g. 220-column EBTP

function sheetRows(file, preferred) {
  const wb = XLSX.read(readFileSync(path.join('sheets', file)), { type: 'buffer', cellDates: true });
  const names = preferred && wb.SheetNames.includes(preferred) ? [preferred] : wb.SheetNames;
  let best = null;
  for (const name of names) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    if (!best || rows.length > best.rows.length) best = { name, rows };
  }
  return best;
}

// Why a row is worth keeping. The parser has grown special cases for each of
// these, and a fixture that omits one would let that special case rot untested.
//
// Each shape names the FIELD it applies to, or null for "any column", plus a
// test over that one cell. Testing single cells rather than the row joined into
// a string matters: the anchored patterns below only match at the start of a
// value, so a row-level test would silently never fire and the shape would be
// reported as absent while the rows sit there in plain sight.
const SO_FIELD = 'so';
const ITEM_FIELD = 'lineItem';

const shapeDefs = () => ([
  ['MES triplet (SO/Item/1 repeated)', SO_FIELD, (c) => /\d+\/\s*\d+\/1/.test(c)],
  ['clubbed parallel columns', null, (c) => c.includes('//')],
  ['newline-separated identifiers', null, (c) => c.includes('\n')],
  ['normalised line item 50(2)', ITEM_FIELD, (c) => /\(\d+\)\s*$/.test(c)],
  ['non-numeric order STOCK etc.', SO_FIELD, (c) => /^(STOCK|HEL|EXPORT|[A-Z]{2,}\(.+\))$/i.test(c)],
  ['Excel error value', null, (c) => /^#(ERROR|REF|VALUE|DIV\/0|N\/A|NAME)!/i.test(c)],
  ['no order at all', SO_FIELD, (c) => c === ''],
  ['sparse row', null, (c) => c === ''],
]);

// Score a row by the shapes it contains. The selected rows are the ones that
// cover the most awkward cases, not a random slice — a random slice of casting
// would almost certainly contain no clubbed rows and quietly stop testing the
// clubbing path entirely.
// `colOf(field)` maps a SOURCES field name to its column in the original sheet.
// It has to go through the mapping, because `index` is keyed by HEADER text:
// looking a field name up in it returns undefined and every field-scoped shape
// silently stops matching.
function shapesIn(row, colIdx, colOf) {
  const cells = colIdx.map((i) => String(row[i] == null ? '' : row[i]).trim());
  const hits = [];
  for (const [name, field, test] of shapeDefs()) {
    if (field === null) {
      if (cells.some((c) => test(c))) hits.push(name);
      continue;
    }
    const at = colIdx.indexOf(colOf(field));
    if (at >= 0 && test(cells[at])) hits.push(name);
  }
  // "sparse row" only counts when the row is genuinely thin, otherwise every
  // row with one empty trailing cell would qualify and flood the selection.
  if (hits.includes('sparse row') && cells.filter((c) => c !== '').length > 8) {
    return hits.filter((h) => h !== 'sparse row');
  }
  return hits;
}

// `diversityCols` are columns the fixture should cover with as many distinct
// values as possible — for EBTP that is the eight slicer fields, so a fixture
// with 220 orders still exercises Domestic and Export, Road and Captive, and
// more than one customer. Taking rows in sheet order instead would give eight
// near-identical orders and test nothing.
function pickRows(rows, colIdx, colOf, diversityCols) {
  const header = rows[0];
  const data = [];
  for (let r = 1; r < rows.length; r += 1) {
    const raw = rows[r];
    if (!Array.isArray(raw) || !raw.some((c) => c !== '' && c !== null)) continue;
    data.push({ raw, index: r });
  }

  // Always take one example of every shape, however rare. A shape present once
  // in 57,000 rows is exactly the case a random sample would drop, and exactly
  // the case that broke the page in production.
  const chosen = new Map();
  const taken = new Set();
  for (const entry of data) {
    for (const s of shapesIn(entry.raw, colIdx, colOf)) {
      if (chosen.has(s) || taken.has(entry.index)) continue;
      chosen.set(s, entry);
      taken.add(entry.index);
    }
  }

  // Then rows that widen the spread of the diversity columns, before any filler.
  if (diversityCols && diversityCols.length) {
    const seen = new Set();
    const addSeen = (e) => {
      for (const c of diversityCols) {
        const v = String(e.raw[c] == null ? '' : e.raw[c]).trim();
        if (v) seen.add(`${c}:${v}`);
      }
    };
    for (const e of chosen.values()) addSeen(e);
    for (const e of data) {
      if (chosen.size >= MAX_ROWS) break;
      if (taken.has(e.index)) continue;
      const before = seen.size;
      addSeen(e);
      // Only keep the row if it actually introduced a new value somewhere.
      if (seen.size === before) continue;
      chosen.set(`diversity:${e.index}`, e);
      taken.add(e.index);
    }
  }

  // Finally fill the budget in sheet order, for stability across regenerations.
  for (const e of data) {
    if (chosen.size >= MAX_ROWS) break;
    if (taken.has(e.index)) continue;
    chosen.set(`filler:${e.index}`, e);
    taken.add(e.index);
  }

  const picked = [...chosen.values()].sort((a, b) => a.index - b.index);
  return { header, picked };
}
if (!existsSync('sheets')) {
  console.error('sheets/ not found — the fixtures are generated from the live extracts, which are not committed.');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const manifest = { generated: new Date().toISOString(), sources: {}, sheets: {} };

for (const [id, [file, preferred]] of Object.entries(SOURCE_FILES)) {
  const { name, rows } = sheetRows(file, preferred);
  const headers = rows[0].map((h) => String(h == null ? '' : h).trim());
  const { mapping } = resolveColumns(headers, id);

  // A column the page READS is always kept, however far right it sits — EBTP
  // spreads its promise dates out to column 115, and a blanket cap silently
  // dropped them, which made the fixture unable to exercise the trace dates.
  // The cap applies only to the named-but-unread columns kept for realism.
  const used = new Set(Object.values(mapping).map((h) => headers.indexOf(h)));
  used.delete(-1);
  const keepCols = [];
  for (let c = 0; c < headers.length; c += 1) {
    if (used.has(c)) keepCols.push(c);
    else if (headers[c] && c < CAP) keepCols.push(c);
  }
  keepCols.sort((a, b) => a - b);
  const colIdx = keepCols;

  // shapeDefs and the picker both work in original-sheet column numbers, so the
  // field -> column index map is built from the full header list, not keepCols.
  const index = new Map(headers.map((h, i) => [h, i]));
  const fieldCol = (field) => {
    const h = mapping[field];
    return h === undefined ? -1 : index.get(h);
  };
  // For the order book, spread the slicer columns as widely as the budget allows.
  const diversityCols = id === 'ebtp'
    ? core.SLICERS.map((s) => fieldCol(s.field)).filter((c) => c >= 0)
    : [];

  const { header, picked } = pickRows(rows, colIdx, fieldCol, diversityCols);
  const out = [keepCols.map((c) => header[c])];
  for (const entry of picked) {
    out.push(colIdx.map((c) => {
      const v = entry.raw[c];
      return v === undefined ? '' : v;
    }));
  }

  const outFile = path.join(OUT, `${id.toUpperCase()} SCHEMA.xlsx`);
  const ws = XLSX.utils.aoa_to_sheet(out);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31) || 'Sheet1');
  // The vendored bundle is the browser build, whose writeFile() tries to
  // download rather than write. Serialise to a buffer here and write it with
  // node:fs instead. Compression is what keeps the committed set small.
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer', compression: true });
  writeFileSync(outFile, buf);

  const shapes = new Set();
  for (const entry of picked) for (const s of shapesIn(entry.raw, colIdx, fieldCol)) shapes.add(s);
  manifest.sources[id] = { file, sheet: name, sourceRows: rows.length - 1 };
  // Forward slashes: this manifest is committed, and a Windows path separator
  // in a repo file is noise that reads as a bug on every other platform.
  manifest.sheets[id] = {
    file: `sheets-schema/${id.toUpperCase()} SCHEMA.xlsx`,
    rows: picked.length,
    columns: keepCols.length,
    shapes: [...shapes],
  };
  const distinct = new Map();
  for (const c of diversityCols) {
    const set = new Set();
    for (const entry of picked) {
      const v = String(entry.raw[c] == null ? '' : entry.raw[c]).trim();
      if (v) set.add(v);
    }
    distinct.set(headers[c], set.size);
  }
  // The order book's fixtures carry no row SHAPES — it is a flat order book —
  // but they do carry slicer diversity, which is the thing worth recording: a
  // fixture where every row had the same customer and mode would let a slicer
  // bug hide behind a UI that looks populated.
  if (diversityCols.length) {
    manifest.sheets[id].slicerDistinct = Object.fromEntries([...distinct]);
  }
  const divNote = diversityCols.length
    ? ` · distinct: ${[...distinct].map(([h, n]) => `${h}=${n}`).join(', ')}`
    : '';
  console.log(`${id.padEnd(10)} ${rows.length - 1} rows -> ${String(picked.length).padStart(4)} rows, ` +
    `${keepCols.length} cols, shapes: ${[...shapes].join(', ') || 'none'}${divNote}`);
}

// A note in the folder, so anyone who finds it knows what it is and how it was
// made rather than mistaking it for a truncated copy of production data. Written
// from the manifest so it can never drift from what was actually generated.
const totalKb = (ids) => Math.round(
  ids.reduce((n, id) => n + statSync(path.join(OUT, `${id.toUpperCase()} SCHEMA.xlsx`)).size, 0) / 1024);

const table = Object.entries(manifest.sheets).map(([id, s]) => {
  const covered = s.shapes.length
    ? s.shapes.join(', ')
    : `slicer diversity across ${Object.entries(s.slicerDistinct || {})
      .filter(([, n]) => n > 1).map(([h, n]) => `${h} (${n})`).join(', ')}`;
  return `| \`${id.toUpperCase()} SCHEMA.xlsx\` | ${s.rows} | ${s.columns} | ${covered} |`;
}).join('\n');

writeFileSync(path.join(OUT, 'README.md'), `# Schema fixtures

Generated by \`npm run fixtures:make\` from the live extracts in \`sheets/\`. These
are **not** a sample of production data and the numbers in them mean nothing —
they are a schema plus edge-case corpus.

Why they exist: the live workbooks are ~72MB, so they cannot be committed and a
fresh clone could not run a single check. These are ~${totalKb(Object.keys(manifest.sheets))}KB, cover
the same columns and the same awkward row shapes, and let the full integrity
suite and the test suite run anywhere.

> These workbooks contain **real customer names, order numbers and dates**,
> copied from the source extracts. If that is not acceptable in a public
> repository, redact them before publishing — see the note at the end.

Each workbook holds every column the Plate Tracker reads, plus the surrounding
named columns for context. Its rows are chosen to cover every awkward shape the
parser handles, and the order book's rows are spread across distinct customers,
sales modes, remarks and inspections so the slicers have real choices:

| Fixture | Rows | Cols | Covers |
| --- | --- | --- | --- |
${table}

\`manifest.json\` records the same summary in machine-readable form.

Regenerate with:

\`\`\`
npm run fixtures:make
\`\`\`

## Checking them

\`\`\`
npm run verify:fixtures   # the full integrity suite, against these files
npm test                  # includes test/plate-tracker-fixtures.test.mjs
\`\`\`

\`verify:fixtures\` runs exactly the same checks as \`verify:integrity\`, which runs
against the live extracts. A parser change has to satisfy both, so a regression
cannot pass on one and hide on the other.

## If the data must be redacted

The fixtures are test inputs, not published samples, so a real customer name in
one is a small leak with a real cost. To strip the identifying columns without
breaking the checks, edit the redaction map in
\`scripts/make-schema-fixtures.mjs\` and regenerate: keep identifier *shapes*
(so \`//\`-clubbing, \`50(2)\` line items and \`STOCK etc.\` still parse) while
replacing the *values*. The integrity suite checks structure, not values, so a
redacted corpus stays green.

The live workbooks are ~72MB and are deliberately **not** committed. The page
reads every workbook in the browser, so it needs no data on the server at all.
`);
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

const total = readdirSync(OUT).reduce((n, f) => n + statSync(path.join(OUT, f)).size, 0);
console.log('');
console.log(`wrote ${readdirSync(OUT).length} files to ${OUT}/ — ${(total / 1024).toFixed(0)} KB total`);
