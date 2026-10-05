// Confirms the lineage the chart draws matches the real identity hierarchy:
// Heat › Slab › Plate, with a date on every node.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const g = {};
new Function('self', 'window', 'globalThis', readFileSync('plate-tracker-xlsx.js', 'utf8'))
  .call(g, g, g, g);
const XLSX = g.XLSX || globalThis.XLSX;

const core = await import('../plate-tracker-core.mjs');
const { SOURCES, resolveColumns, rowToRecords, buildIndex, buildLineage, plateStem } = core;

const FILES = {
  casting: ['sheets/CASTING DATA.xlsx', '2026'],
  rolling: ['sheets/ROLLING DATA.xlsx', 'RECONCILE'],
  finishing: ['sheets/FG DATA.xlsx', null],
  dispatch: ['sheets/DISPATCH DATA.xlsx', null],
};

const byStage = {};
for (const [id, [file, sheetName]] of Object.entries(FILES)) {
  const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
  const sheet = wb.Sheets[sheetName || wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { raw: true, defval: '' });
  const { mapping } = resolveColumns(XLSX.utils.sheet_to_json(sheet, { header: 1 })[0], id);
  const recs = [];
  for (const row of rows) recs.push(...rowToRecords(row, id, mapping));
  byStage[id] = recs;
}

const index = buildIndex(byStage);
console.log(`index: ${index.list.length} orders, ${index.list.filter((p) => p.presentStages === 4).length} through all four stages`);

const complete = index.list.filter((p) => p.presentStages === 4).slice(0, 300);

let withHeat = 0; let withSlab = 0; let withPlate = 0; let withDispatch = 0;
let holding = 0; let noDate = 0; let total = 0;

const sample = [];
for (const plate of complete) {
  const tree = buildLineage(plate);
  total += 1;
  const kinds = new Set();
  let hasUnlinked = false;
  let noDateHere = false;
  const walk = (n) => {
    if (n.kind === 'holding') hasUnlinked = true;
    if (n.identityKind) kinds.add(n.identityKind);
    if ((n.kind === 'ident' || n.kind === 'order') && !n.date) noDateHere = true;
    for (const c of n.children || []) walk(c);
  };
  walk(tree);
  if (kinds.has('Heat ID')) withHeat += 1;
  if (kinds.has('Slab ID')) withSlab += 1;
  if (kinds.has('Plate ID')) withPlate += 1;
  if (kinds.has('Plate ID') && plate.records.dispatch.length) withDispatch += 1;
  if (hasUnlinked) holding += 1;
  if (noDateHere) noDate += 1;
  if (sample.length < 3) {
    const line = [];
    const render = (n, d) => {
      if (n.kind === 'ident' || n.kind === 'order') {
        line.push(`${'  '.repeat(d)}${n.identityKind || 'SO'} ${n.label}${n.date ? ' [' + n.date + ']' : ''}`);
        d += 1;
      }
      for (const c of (n.children || []).slice(0, 2)) render(c, d);
    };
    render(tree, 0);
    sample.push(`${plate.so}/${plate.lineItem}\n  ` + line.join('\n  '));
  }
}

console.log(`\nover ${total} complete orders:`);
console.log(`  lineage reaches a Heat ID : ${withHeat} (${((withHeat / total) * 100).toFixed(1)}%)`);
console.log(`  lineage reaches a Slab ID : ${withSlab} (${((withSlab / total) * 100).toFixed(1)}%)`);
console.log(`  lineage reaches a Plate ID: ${withPlate} (${((withPlate / total) * 100).toFixed(1)}%)`);
console.log(`  plate node carries dispatch: ${withDispatch} (${((withDispatch / total) * 100).toFixed(1)}%)`);
console.log(`  orders with unlinked units : ${holding} (${((holding / total) * 100).toFixed(1)}%)`);
console.log(`  orders with a dateless node: ${noDate}`);

console.log('\nsample lineages:');
for (const s of sample) console.log('  ' + s);

// plateStem spot check against the real joins. A plate is cut from a slab, and
// the slab may be known to casting, to rolling, or to both — so the join has to
// be tested against the union, which is what the lineage actually does.
const slabs = new Set([
  ...byStage.casting.map((r) => r.slabId),
  ...byStage.rolling.map((r) => r.slabId),
].filter(Boolean));
let hit = 0; let miss = 0;
for (const r of byStage.finishing.slice(0, 5000)) {
  if (!r.batch) continue;
  if (slabs.has(plateStem(r.batch))) hit += 1; else miss += 1;
}
console.log(`\nplateStem resolves to a real slab: ${hit}/${hit + miss} (${((hit / (hit + miss)) * 100).toFixed(1)}%)`);

