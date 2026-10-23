// Negative control for scripts/sim-plate-tagging-zstk.mjs.
//
// Runs the exact same behavioural simulation against a copy of the page's ZSTK
// loader with the concurrency guard STRIPPED OUT. It must FAIL the "collapse to
// one render" check — if it passes, that check is vacuous and the sim proves
// nothing about the guard. Run both: this one should exit 1.
//
//   node scripts/sim-plate-tagging-zstk-negctl.mjs

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const pageSrc = await readFile('Plate-Tagging-Tool.html', 'utf8');

// Neutralise the guard: the early bail, the set, and the release. Each is
// matched with its own indentation so the declaration `let ZSTK_FETCHING=false;`
// (no leading newline+indent) survives — the slice boundaries in the sim depend
// on it, and keeping it means we removed behaviour rather than nothing.
const negated = pageSrc
  .replace('if(ZSTK_FETCHING) return;', '/* guard stripped */')
  .replace('\n  ZSTK_FETCHING=true;', '/* guard stripped */')
  .replace('\n    ZSTK_FETCHING=false;', '/* guard stripped */');

if (negated === pageSrc) {
  console.error('✖ could not strip the guard — the page changed; update this control');
  process.exit(2);
}
if (!/let ZSTK_FETCHING=false;/.test(negated)) {
  console.error('✖ the declaration vanished too — the substitutions were too broad');
  process.exit(2);
}
console.log('guard stripped; running the same simulation against the stripped page\n');

const tmpPage = 'Plate-Tagging-Tool.negctl.html';
await writeFile(tmpPage, negated, 'utf8');
try {
  const res = spawnSync(process.execPath, ['scripts/sim-plate-tagging-zstk.mjs', tmpPage], {
    stdio: 'inherit',
  });
  if (res.status === 0) {
    console.error('\n✖ the sim still passed with the guard removed — the "one render" check is vacuous');
    process.exit(1);
  }
  console.log('\n✔ the sim correctly failed with the guard removed — the guard is load-bearing');
} finally {
  await unlink(tmpPage).catch(() => {});
}
