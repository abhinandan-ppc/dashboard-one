// Measures the header card against the content below it at several widths, so a
// misalignment can be read as a number rather than argued about.
// Usage: node scripts/measure-header.mjs
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Playwright is deliberately NOT a project dependency — this repo ships with no
// npm dependencies. Resolve it from the npx cache, the same way
// smoke-plate-tracker.mjs does, so this script adds nothing to package.json.
async function loadPlaywright() {
  if (process.env.PLAYWRIGHT_MODULE) return import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
  const npxRoot = join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  if (existsSync(npxRoot)) {
    for (const dir of readdirSync(npxRoot)) {
      for (const name of ['index.mjs', 'index.js']) {
        const candidate = join(npxRoot, dir, 'node_modules', 'playwright', name);
        if (existsSync(candidate)) return import(pathToFileURL(candidate).href);
      }
    }
  }
  throw new Error('playwright not found — set PLAYWRIGHT_MODULE');
}
const { chromium } = await loadPlaywright();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer((req, res) => {
  const file = decodeURIComponent(req.url.split('?')[0]);
  const full = resolve('.' + (file === '/' ? '/Plate-Tracker.html' : file));
  if (!existsSync(full)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' });
  res.end(readFileSync(full));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage();

for (const width of [2560, 1920, 1600, 1440, 1280, 1024, 860, 768, 640, 390]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/Plate-Tracker.html`);
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) };
    };
    return {
      shell: box('.app-header-shell'),
      header: box('.app-header'),
      first: box('main > section'),
      last: box('main > section:last-of-type'),
      gutter: getComputedStyle(document.documentElement).getPropertyValue('--page-gutter').trim(),
    };
  });
  if (!m.header || !m.first) { console.log(`${width}: missing`); continue; }
  // The comparison the user actually sees: the header card's edges against the
  // cards beneath it.
  const dL = m.header.l - m.first.l;
  const dR = m.header.r - m.first.r;
  const flag = Math.abs(dL) > 1 || Math.abs(dR) > 1 ? '  <-- MISALIGNED' : '';
  console.log(`${String(width).padStart(5)}px  gutter=${(m.gutter || '?').padStart(4)}  header=[${m.header.l}..${m.header.r}] w=${m.header.w}  content=[${m.first.l}..${m.first.r}] w=${m.first.w}  Δleft=${dL} Δright=${dR}${flag}`);
}

await browser.close();
server.close();

// A screenshot at the width where the misalignment was worst, so the fix can be
// seen rather than taken on trust. Opt-in: it writes a file.
if (process.env.SHOT) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 2560, height: 1400 } });
  const s = createServer((req, res) => {
    const file = decodeURIComponent(req.url.split('?')[0]);
    const full = resolve('.' + (file === '/' ? '/Plate-Tracker.html' : file));
    if (!existsSync(full)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' });
    res.end(readFileSync(full));
  });
  await new Promise((r) => s.listen(0, r));
  await p.goto(`http://127.0.0.1:${s.address().port}/Plate-Tracker.html`);
  await p.waitForTimeout(600);
  await p.screenshot({ path: process.env.SHOT });
  await b.close();
  s.close();
  console.log('wrote ' + process.env.SHOT);
}