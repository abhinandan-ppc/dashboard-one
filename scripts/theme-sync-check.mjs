// Sweeps EVERY page across the darkness ramp and reports what each one ended
// up with, so a page whose own script overrides the shared value shows up as a
// disagreement rather than as a silent one.
//
//   node scripts/theme-sync-check.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const PAGES = [
  'admin.html', 'VDO-Generator.html', 'Plate-Tagging-Tool.html',
  'PM-Yard.html', 'Rake-Planner.html', 'Order-Status-Report.html',
  'Plate-Tracker.html',
  'SMS-Heat-Planner.html', 'SMS Heat Planner Daily.html', 'SMS Heat Planner Monthly.html',
];
const STOPS = [0, 20, 38, 50, 80, 100];
const diag = join(root, '.theme-sync-diag.json');
let failures = 0;

for (const page of PAGES) {
  const rows = [];
  for (const d of STOPS) {
    try { unlinkSync(diag); } catch {}
    try {
      execFileSync(process.execPath, ['scripts/shoot-page.mjs'], {
        cwd: root, stdio: 'ignore',
        env: { ...process.env, PAGE: page, THEME: String(d), ACCENT: '199,90,52', DIAG_OUT: diag, WIDTH: '900' },
      });
    } catch (e) {
      rows.push({ d, error: 'render failed' });
      continue;
    }
    let parsed;
    try { parsed = JSON.parse(readFileSync(diag, 'utf8')); } catch { rows.push({ d, error: 'no diag' }); continue; }
    // The page must honour the requested darkness, derive the right attribute,
    // and — critically — must not have rewritten the shared key on the way past.
    const want = String(d);
    const ok = parsed.themeD === want
      && String(parsed.storedAfter) === want
      && parsed.derived === (d < 38 ? 'light' : 'dark');
    if (!ok) failures++;
    rows.push({ ...parsed, d, ok });
  }
  console.log(`\n${page}`);
  for (const r of rows) {
    if (r.error) { console.log(`   d=${String(r.d).padStart(3)}  ${r.error}`); continue; }
    console.log(`   d=${String(r.d).padStart(3)}  ${r.ok ? 'ok  ' : 'DESYNC'}`
      + `  applied=${r.themeD}  stored=${r.storedAfter}  derived=${r.derived}  contrast=${r.contrast}:1`);
  }
}

try { unlinkSync(diag); } catch {}
console.log(failures ? `\n${failures} desync(s) found` : '\nall pages in sync across the ramp');
process.exit(failures ? 1 : 0);
