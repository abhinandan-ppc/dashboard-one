// Integration test: the committed schema fixtures must load through the same
// parser the browser runs, and produce a usable index.
//
// The unit tests in plate-tracker.test.mjs use small hand-built rows. This one
// uses the GENERATED workbooks, so if fixture generation drops a column, loses a
// row shape, or writes a header the page no longer recognises, it fails here
// rather than in production. It is the test that keeps the fixtures honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const globalScope = {};
new Function('self', 'window', 'globalThis', readFileSync('plate-tracker-xlsx.js', 'utf8'))
  .call(globalScope, globalScope, globalScope, globalScope);
const XLSX = globalScope.XLSX || globalThis.XLSX;

const core = await import('../plate-tracker-core.mjs');
const { SOURCES, STAGE_IDS, SLICERS, resolveColumns, isSourceAcceptable, rowToRecords } = core;

const DIR = 'sheets-schema';
const fixtures = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.xlsx')) : [];

// Rows come back keyed by HEADER, because resolveColumns() maps a field to a
// header name and the parser reads row[header]. Handing it array rows makes
// every lookup undefined, which reads as "the parser produced nothing" rather
// than as the test bug it is.
function readRows(stage) {
  const wb = XLSX.read(readFileSync(`${DIR}/${stage.toUpperCase()} SCHEMA.xlsx`), { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  const header = matrix[0] || [];
  const rows = XLSX.utils.sheet_to_json(sheet, { raw: true, defval: '' });
  return { header, rows };
}

test('the schema fixtures are committed', () => {
  assert.ok(fixtures.length, `${DIR}/ is missing — run: npm run fixtures:make`);
  assert.equal(fixtures.length, 5, 'expected one fixture per stage plus the order book');
});

for (const stage of STAGE_IDS) {
  test(`${stage} fixture resolves every required column`, () => {
    const { header, rows } = readRows(stage);
    assert.ok(header.length, 'fixture has no header row');
    assert.ok(rows.length, 'fixture has no data rows');

    // Every required column the page declares must resolve against the fixture
    // headers. This is the check that would have caught the F_SLOC/S_SLOC
    // mismatch, where the declared name matched nothing and the field stayed
    // empty for every one of 129,389 finishing rows.
    const resolved = resolveColumns(header, stage);
    const required = resolved.missing.filter((m) => m.required);
    assert.deepEqual(required, [],
      `${stage}: required column(s) the page declares but the fixture lacks: ` +
      required.map((m) => `${m.field} ("${m.header}")`).join(', '));
    assert.ok(resolved.matched > 0, `${stage}: nothing resolved`);
  });

  test(`${stage} fixture yields records the page can use`, () => {
    const { header, rows } = readRows(stage);
    const resolved = resolveColumns(header, stage);
    assert.ok(isSourceAcceptable(resolved),
      `${stage}: fixture does not satisfy the source's required columns`);

    let records = 0;
    for (const row of rows) records += rowToRecords(row, stage, resolved.mapping).length;
    assert.ok(records > 0, `${stage}: fixture produced zero records`);

    // A plate key is what links a row to its siblings across stages. If none of
    // the fixture rows produce one, the cross-stage view has nothing to join on.
    const keyed = rows.filter((r) => rowToRecords(r, stage, resolved.mapping)
      .some((rec) => rec.so && rec.lineItem));
    assert.ok(keyed.length > 0, `${stage}: no fixture row yields an SO + line item pair`);
  });
}

test('the order book fixture offers real slicer choices', () => {
  // A fixture where every EBTP row shares one customer and one mode would let a
  // slicer bug hide behind a UI that looks populated.
  const { header, rows } = readRows('ebtp');
  const { mapping } = resolveColumns(header, 'ebtp');
  let tested = 0;
  for (const slicer of SLICERS) {
    if (mapping[slicer.field] === undefined) continue;
    const distinct = new Set(rows
      .map((r) => String(r[mapping[slicer.field]] ?? '').trim())
      .filter(Boolean));
    assert.ok(distinct.size >= 2,
      `ebtp: slicer "${slicer.label}" has only ${distinct.size} distinct value(s) — too uniform to catch slicer bugs`);
    tested += 1;
  }
  assert.ok(tested >= 5, `only ${tested} slicer columns present in the ebtp fixture`);
});

test('fixtures still cover the awkward row shapes the real extracts contain', () => {
  // These shapes are why the parser is shape-aware. If fixture generation stops
  // preserving them, the parser can quietly regress on exactly the rows that
  // break it.
  const seen = new Set();
  for (const stage of STAGE_IDS) {
    for (const row of readRows(stage).rows) {
      for (const cell of Object.values(row)) {
        const s = String(cell ?? '');
        if (s.includes('//')) seen.add('clubbed identifiers');
        if (s.includes('\n')) seen.add('newline-separated identifiers');
        if (/\b50\s*\(2\)/.test(s)) seen.add('line item 50(2)');
        if (/^STOCK\b/i.test(s.trim())) seen.add('non-numeric order STOCK etc.');
        if (/^#(N\/A|REF!|VALUE!|DIV\/0!)/.test(s.trim())) seen.add('excel error value');
      }
    }
  }
  for (const shape of ['clubbed identifiers', 'newline-separated identifiers', 'line item 50(2)', 'non-numeric order STOCK etc.']) {
    assert.ok(seen.has(shape), `fixtures no longer cover: ${shape} (found: ${[...seen].join(', ') || 'none'})`);
  }
});
