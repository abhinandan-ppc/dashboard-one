// Quick structural check for Plate-Tracker.html — run with `node check-html.mjs`.
// Verifies tag balance and the hooks the shared responsive contract test and the
// hub rely on, without needing a browser.
import { readFileSync } from 'node:fs';

const html = readFileSync('Plate-Tracker.html', 'utf8');
let bad = 0;

// Tag-balance check. Each pair is matched as a TAG, not a bare prefix: a plain
// split on '<head' also counts '<header', so simply using a <header> element
// (the correct semantic container for a page header, and what every other page
// here nests its .app-header inside) reported a phantom imbalance.
const pairs = [['<html', '</html>'], ['<head', '</head>'], ['<body', '</body>'],
  ['<style', '</style>'], ['<main', '</main>'], ['<section', '</section>']];
// `(?![A-Za-z0-9-])` closes the tag name, so '<head' does not match '<header'.
// The regex is rebuilt per use: a /g regex is stateful, and reusing one across
// loop iterations makes String.match() return null and silently report 0.
// NOTE the pairs already carry their own '<', so `tag` is matched verbatim.
const countOpenTag = (src, tag) => (src.match(new RegExp(tag + '(?![A-Za-z0-9-])', 'g')) || []).length;
for (const [open, close] of pairs) {
  const o = countOpenTag(html, open);
  const c = html.split(close).length - 1;
  const ok = o === c;
  if (!ok) bad += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${open}..${close}  open=${o} close=${c}`);
}

const required = [
  ['viewport-fit=cover', /viewport-fit=cover/],
  ['theme-boot.js', /theme-boot\.js/],
  ['theme.css', /theme\.css/],
  ['app-header', /app-header/],
  ['hubFrameHeaderSlot', /id="hubFrameHeaderSlot"/],
  ['jspl-logo', /class="jspl-logo"/],
  ['header-spacer', /header-spacer/],
  ['skip-link', /class="skip-link"/],
  ['page-trace body class', /<body class="page-trace">/],
  ['no body overflow-x hidden', /body\s*\{[^}]*overflow-x\s*:\s*hidden/],
  ['tooltip class', /class="tooltip"/],
  ['data-table-wrap', /data-table-wrap/],
  ['xlsx vendor script', /plate-tracker-xlsx\.js/],
  ['controller script', /Plate-Tracker\.js/],
];

// The worker is loaded by the controller via `new Worker(url)`, not by a page
// <script> tag — so its URL belongs in the JS, not the HTML. Asserting it in the
// HTML (as this check used to) could only ever fail, since adding it would
// break the very thing the next check protects.
const controller = readFileSync(new URL('./Plate-Tracker.js', import.meta.url), 'utf8');
if (!/new Worker\(\s*['"`][^'"`]*plate-tracker-worker\.js/.test(controller)) {
  bad += 1;
  console.log('FAIL controller must construct the worker with the worker script URL');
} else {
  console.log('ok   controller constructs the worker');
}
const workerTags = [...html.matchAll(/<script[^>]*src="([^"]*worker[^"]*)"[^>]*>/gi)];
if (workerTags.length) {
  bad += 1;
  console.log(`FAIL worker must not be a page script tag (${workerTags.map((m) => m[1]).join(', ')})`);
} else {
  console.log('ok   worker not referenced as a page script');
}
for (const [name, re] of required) {
  const neg = name.startsWith('no ');
  const hit = re.test(html);
  const ok = neg ? !hit : hit;
  if (!ok) bad += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
}

// Every element the controller reaches for by id must exist in the markup.
const ids = ['slots', 'dropAll', 'progress', 'progressBar', 'progressLabel', 'clearBtn',
  'cacheChip', 'linkReport', 'q', 'from', 'to', 'searchBtn', 'resetBtn', 'stageChips',
  'summaryChips', 'tableHost', 'detail', 'traceHead', 'tlTrack', 'tlAxis', 'tlGaps',
  'treeWrap', 'treeSvg', 'tip', 'expandAllBtn', 'collapseAllBtn', 'dataStatus',
  'dataStatusText'];
for (const id of ids) {
  if (!html.includes(`id="${id}"`)) { bad += 1; console.log(`FAIL missing id="${id}"`); }
}
console.log(`ok   all ${ids.length} controller ids present`);

console.log(bad ? `\n${bad} problem(s)` : '\nstructure OK');
process.exit(bad ? 1 : 0);