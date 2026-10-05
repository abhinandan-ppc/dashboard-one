// Checks that the repo is in a state a static host can actually deploy, and
// that the Plate Tracker does not secretly depend on a file the server will not
// have.
//
//   node scripts/verify-deploy.mjs
//
// The page reads every workbook in the browser — drag-and-drop or file picker —
// so it needs no data on the server. That is the property this verifies, because
// it is easy to break by accident with a stray fetch() or a hard-coded path,
// and the failure only shows up after deploying.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`);
}

/* ═══════════════════ 1 · THE PAGE LOADS WITH NO DATA FILES ═══════════════════ */

const PAGE = 'Plate-Tracker.html';
check('page exists', existsSync(PAGE));

const html = existsSync(PAGE) ? readFileSync(PAGE, 'utf8') : '';
const js = existsSync('Plate-Tracker.js') ? readFileSync('Plate-Tracker.js', 'utf8') : '';
const worker = existsSync('plate-tracker-worker.js') ? readFileSync('plate-tracker-worker.js', 'utf8') : '';

// Nothing may fetch a workbook or hit an API for data. The page is offline by
// design, and a deployment that quietly depends on an endpoint the host does not
// serve would fail only in production.
const remoteCalls = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/XMLHttpRequest/, 'XMLHttpRequest'],
  [/\bimport\s*\(\s*['"]https?:/, 'dynamic import from a URL'],
].filter(([re]) => re.test(html) || re.test(js) || re.test(worker));

check('the tracker makes no network calls for data', remoteCalls.length === 0,
  remoteCalls.length ? remoteCalls.map(([, n]) => n).join(', ') : 'fully client-side');

// The workbooks the page expects are chosen by the user at runtime. It must not
// name a path under sheets/ as though the server served it.
const serverPathRefs = [...(html + js).matchAll(/['"][^'"]*\bsheets\/[^'"]*['"]/g)]
  .map((m) => m[0]);
check('the page does not reference a sheets/ path', serverPathRefs.length === 0,
  serverPathRefs.slice(0, 3).join(' '));

// The vendored parser must be local: a CDN reference would break under a strict
// CSP and offline.
check('the xlsx parser is vendored locally', existsSync('plate-tracker-xlsx.js')
  && !/src=["']https?:\/\/[^"']*xlsx/i.test(html));

/* ═══════════════════ 2 · NOTHING HUGE WILL BE DEPLOYED ═══════════════════ */

// What a static host actually uploads. The live extracts are the whole risk:
// 72MB of workbooks for a page that never reads one at runtime.
const SKIP_DIRS = new Set(['node_modules', '.git', '.vercel', '.claude', '.claude-flow', 'sheets']);
function walk(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push({ full, size: statSync(full).size });
  }
  return acc;
}

const files = existsSync('.') ? walk('.', []) : [];
const bySize = files.slice().sort((a, b) => b.size - a.size);
const total = files.reduce((n, f) => n + f.size, 0);
const mb = (n) => `${(n / 1048576).toFixed(1)}MB`;
const fmt = (f) => `${f.full.replace(/\\/g, '/')} ${mb(f.size)}`;

// The guard is on the code WE maintain, not on every file in the tree.
// plate-tracker-xlsx.js is the vendored SheetJS build: a third-party bundle we
// ship deliberately, and its size is fixed until we swap parsers. Flagging it
// would just train us to ignore the check.
const TRACKER_ASSETS = /^plate-tracker-[\w-]+\.(mjs|js|css)$/i;
const VENDORED = new Set(['plate-tracker-xlsx.js']);
const trackerFiles = files.filter((f) => {
  const name = path.basename(f.full);
  return TRACKER_ASSETS.test(name) && !VENDORED.has(name);
});
const trackerBytes = trackerFiles.reduce((n, f) => n + f.size, 0);
const overBudget = trackerFiles.filter((f) => f.size > 500 * 1024);

check('the tracker bundle stays under budget', overBudget.length === 0,
  overBudget.length ? overBudget.map(fmt).join(', ') : `${trackerFiles.length} files, ${mb(trackerBytes)}`);
console.log(`      full deployable tree: ${files.length} files, ${mb(total)} (all pages)`);
const largest = bySize.slice(0, 3).map(fmt).join(', ');
console.log(`      largest overall: ${largest}`);

// The live extracts must be ignored, or the next `git add .` puts them back.
let ignoredSheets = false;
if (existsSync('.gitignore')) {
  ignoredSheets = /^sheets\/?\s*$/m.test(readFileSync('.gitignore', 'utf8'));
}
check('sheets/ is gitignored', ignoredSheets);
// Committed for real, so a fresh clone can run the whole suite offline.
const fixtures = existsSync('sheets-schema')
  ? readdirSync('sheets-schema').filter((f) => f.endsWith('.xlsx'))
  : [];
check('sheets-schema/ fixtures are present', fixtures.length === 5, `${fixtures.length} of 5`);

/* ═══════════════════ 3 · THE HOSTING CONFIG ═══════════════════ */

check('vercel.json exists', existsSync('vercel.json'));
if (existsSync('vercel.json')) {
  let cfg = null;
  try { cfg = JSON.parse(readFileSync('vercel.json', 'utf8')); } catch { /* handled below */ }
  check('vercel.json is valid JSON', cfg !== null);
  if (cfg) {
    const csp = ((cfg.headers || []).flatMap((h) => h.headers || []))
      .find((h) => h.key === 'Content-Security-Policy');
    check('vercel.json sets a Content-Security-Policy', !!csp);
    if (csp) {
      const v = csp.value;
      // The page parses workbooks in a worker and caches in IndexedDB; a CSP
      // without these breaks it at runtime with no build-time warning.
      check("CSP allows the worker ('worker-src')", /worker-src[^;]*blob:/.test(v) || /worker-src[^;]*'self'/.test(v));
      check("CSP allows inline scripts (the vendored parser)", /script-src[^;]*'unsafe-inline'/.test(v));
      check('CSP does not lock connect-src to self only', !/connect-src\s+'self'\s*;/.test(v),
        'the hub loads the theme and fonts over the network');
    }
  }
}

/* ═══════════════════ 4 · .VERCELIGNORE EXCLUDES NOTHING A PAGE NEEDS ════════ */

// The highest-cost deployment mistake is a .vercelignore rule that looks
// harmless and quietly strips a script the page loads, so the site only breaks
// in production. Check the rules against what the pages actually reference.
let ignoreText = '';
if (existsSync('.vercelignore')) ignoreText = readFileSync('.vercelignore', 'utf8');

const ignoreRules = ignoreText
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => (l.startsWith('!') ? { negate: true, re: globToRe(l.slice(1)) } : { negate: false, re: globToRe(l) }));

// A directory rule like `sheets/` has to match the directory itself as well as
// the paths under it, so the trailing slash is folded into an optional group
// rather than left as a literal.
function globToRe(glob) {
  const bare = glob.replace(/\/+$/, '');
  const esc = bare
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${esc}(?:/.*)?$`);
}
const ignored = (rel) => {
  let hit = false;
  for (const rule of ignoreRules) {
    if (rule.re.test(rel)) hit = !rule.negate;
  }
  return hit;
};

const pages = readdirSync('.').filter((f) => f.endsWith('.html'));
const referenced = new Set();
for (const page of pages) {
  const body = readFileSync(page, 'utf8');
  for (const m of body.matchAll(/(?:src|href)="([^"#?]+\.(?:js|mjs|css|png|svg|json|webp|ico))"/g)) {
    const ref = m[1];
    if (/^(https?:|data:|\/api\/)/.test(ref)) continue;
    referenced.add(ref.replace(/^\.\//, ''));
  }
}
const missing = [...referenced].filter((ref) => !existsSync(ref)).filter((ref) => !ignored(ref));
check('every file a page references exists and is deployed', missing.length === 0,
  missing.length ? `ignored or missing: ${missing.join(', ')}` : `${referenced.size} asset(s) across ${pages.length} pages`);

const neededButIgnored = [...referenced].filter((ref) => existsSync(ref) && ignored(ref));
check('.vercelignore excludes nothing a page loads', neededButIgnored.length === 0,
  neededButIgnored.length ? `would break in production: ${neededButIgnored.join(', ')}` : 'clean');

const sheetsIgnored = ignoreRules.some((r) => !r.negate && r.re.test('sheets'));
check('.vercelignore excludes the live extracts', sheetsIgnored);

/* ═══════════════════ SUMMARY ═══════════════════ */

console.log('');
console.log(failures ? `${failures} deployment check(s) failed` : 'deployment-ready');
process.exit(failures ? 1 : 0);
