// Browser smoke test for Plate-Tracker.html.
//
//   node scripts/smoke-plate-tracker.mjs
//
// Loads the real page over http, drops in real workbooks, and asserts the
// upload → index → search → flow-chart path actually works in a browser. The
// unit tests prove the logic and verify-pipeline.mjs proves it against the real
// data, but only this proves the wiring, the worker and the SVG rendering.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Playwright is deliberately NOT a project dependency — this repo ships with no
// npm dependencies, and scripts/shoot-page.mjs reaches the CLI through the npx
// cache for the same reason. Resolve it from there so this smoke test adds
// nothing to package.json.
async function loadPlaywright() {
  if (process.env.PLAYWRIGHT_MODULE) return import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
  const npxRoot = join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  if (existsSync(npxRoot)) {
    for (const dir of readdirSync(npxRoot)) {
      const candidate = join(npxRoot, dir, 'node_modules', 'playwright', 'index.mjs');
      if (existsSync(candidate)) return import(pathToFileURL(candidate).href);
      const cjs = join(npxRoot, dir, 'node_modules', 'playwright', 'index.js');
      if (existsSync(cjs)) return import(pathToFileURL(cjs).href);
    }
  }
  return null;
}

const playwright = await loadPlaywright();
if (!playwright) {
  console.log('skip  playwright not found in the npx cache — run `npx playwright install chromium` first');
  process.exit(0);
}
const { chromium } = playwright;

const ROOT = resolve('.');
const PORT = 8731;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = join(ROOT, path === '/' ? 'Plate-Tracker.html' : path);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(PORT, r));

// The two smallest extracts keep the run quick while still producing a real
// multi-stage plate (SO 607831786 is present in both).
const UPLOADS = [
  ['rolling', 'sheets/ROLLING DATA.xlsx'],
  ['casting', 'sheets/CASTING DATA.xlsx'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const failedRequests = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' <- ')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r) => failedRequests.push(r.url() + ' ' + (r.failure()?.errorText || '')));
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(r.url() + ' HTTP ' + r.status()); });

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed += 1;
};

try {
  await page.goto(`http://127.0.0.1:${PORT}/Plate-Tracker.html`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  check('page loads', true);
  check('five upload slots render', (await page.locator('.slot').count()) === 5);
  check('header status present', (await page.locator('#dataStatus').count()) === 1);
  check('hub slot present', (await page.locator('#hubFrameHeaderSlot').count()) === 1);
  check('empty state shown', (await page.locator('#tableHost .empty-msg').count()) === 1);

  for (let i = 0; i < UPLOADS.length; i += 1) {
    const [slot, file] = UPLOADS[i];
    await page.setInputFiles('#file-' + slot, resolve(file));
    // Wait for the JOB to complete. The slot flips green on the per-file
    // message, but the index, the link report and the header are only written
    // when the worker's `done` arrives. Keying off the status line's file
    // COUNT is what makes this deterministic: the previous job's state also
    // satisfies "slots are green" and "mentions plates", so those alone let the
    // assertion read a half-applied job.
    await page.waitForFunction(
      (n) => {
        const ok = document.querySelectorAll('.slot.ok').length;
        const txt = document.getElementById('dataStatusText')?.textContent || '';
        return ok >= n && new RegExp('· ' + n + ' files?').test(txt);
      },
      i + 1,
      { timeout: 180000 },
    );
  }
  // Files arrive one at a time, so the index has to ACCUMULATE: after the
  // second upload the first stage must still be present. This regressed once,
  // when each job rebuilt from only its own batch and reported the earlier
  // file as "not loaded".
  // The FG and DISPATCH extracts are large (133k rows) and are the stages that
  // previously failed to load, so they are exercised here rather than only in
  // the Node pipeline check — the worker runs a different parse path.
  for (const [slot, file, stage] of [
    ['finishing', 'sheets/FG DATA.xlsx', 'Finishing'],
    ['dispatch', 'sheets/DISPATCH DATA.xlsx', 'Dispatch'],
  ]) {
    await page.setInputFiles('#file-' + slot, resolve(file));
    // Wait on THIS stage's counter specifically. Keying the wait off any stage
    // would return immediately for the second upload, because the first stage's
    // count is already non-zero — the check would then read the previous file's
    // state and report a false failure.
    const re = new RegExp(stage + ': [1-9]');
    await page.waitForFunction(
      (pattern) => new RegExp(pattern).test(document.getElementById('linkReport')?.textContent || ''),
      stage + ': [1-9]',
      { timeout: 300000 },
    ).catch(() => {});
    const r = await page.locator('#linkReport').innerText().catch(() => '');
    check(`${stage} workbook loads`, re.test(r), r.replace(/\s+/g, ' ').slice(0, 150));
  }

  // The EBTP order book is now the base view, so it is exercised in the browser
  // too: it seeds the index, and its orders must appear in the table.
  await page.setInputFiles('#file-ebtp', resolve('sheets/EBTP.xlsx'));
  await page.waitForFunction(
    // Anchored on the LOADED form. A loose /EBTP/ also matches the "not loaded"
    // warning, so the wait returned instantly and the assertions below read the
    // table as it stood BEFORE the order book was ingested.
    () => /EBTP order book: \d/.test(document.getElementById('linkReport')?.textContent || ''),
    undefined,
    { timeout: 180000 },
  ).catch(() => {});
  const ebtpReport = await page.locator('#linkReport').innerText().catch(() => '');
  check('EBTP order book loads', /EBTP order book: \d/.test(ebtpReport), ebtpReport.replace(/\s+/g, ' ').slice(0, 150));

  // Orders booked but never produced must still be listed — that is the whole
  // point of leading with the order book.
  const bookedOnly = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#tableHost tbody tr')];
    return rows.filter((r) => r.querySelectorAll('.pill.none').length === 4).length;
  });
  check('orders with no stage record are listed', bookedOnly > 0, bookedOnly + ' of the visible rows');

  // No identifier may still carry a clubbed separator after parsing.
  const clubbed = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#tableHost tbody tr')];
    return rows.filter((r) => (r.children[0]?.textContent || '').includes('//')
      || (r.children[1]?.textContent || '').includes('//')).length;
  });
  check('no clubbed identifiers remain in the table', clubbed === 0, clubbed + ' rows still clubbed');

  // The chart is one lineage: Heat › Slab › Plate › Dispatch, with no separate
  // stage cards and no view toggle. Search for a plate that reached all four
  // stages so the screenshot shows a real route rather than placeholders.
  await page.fill('#q', '607831786');
  await page.waitForTimeout(400);
  await page.locator('#tableHost tbody tr').first().click();
  await page.waitForTimeout(500);

  const heatNodes = await page.locator('#treeSvg .node.ident').count();
  check('the lineage draws unit nodes', heatNodes > 0, heatNodes + ' units');
  // The labels carry the unit's KIND, so the chain reads Heat/Slab/Plate without
  // the reader having to know which column each stage uses. Read textContent
  // rather than innerText: innerText is unreliable on SVG <text> in Chromium and
  // comes back empty.
  const labelText = await page.locator('#treeSvg').evaluate((svg) =>
    [...svg.querySelectorAll('.node.ident .label')].map((n) => n.textContent.trim()));
  check('units are labelled Heat / Slab / Plate',
    labelText.some((t) => /Heat ID/i.test(t))
    && labelText.some((t) => /Slab ID/i.test(t))
    && labelText.some((t) => /Plate ID/i.test(t)),
    [...new Set(labelText.map((t) => t.split(/\s+/)[0]))].join(' '));
  check('every unit node carries a date',
    (await page.locator('#treeSvg .node.ident .date').count()) === heatNodes,
    (await page.locator('#treeSvg .node.ident .date').count()) + ' of ' + heatNodes);
  // Nested, not flat: heat, slab and plate sit at increasing depths.
  check('the lineage is nested, not flat', await page.locator('#treeSvg').evaluate((svg) => {
    const xs = [...svg.querySelectorAll('.node.ident')].map((n) => n.getBoundingClientRect().x);
    return new Set(xs.map((x) => Math.round(x))).size > 1;
  }), 'units sit at different depths');
  check('there are no separate stage cards', (await page.locator('#treeSvg .node.stage').count()) === 0);

  // The pan/zoom/fullscreen pill, which is how a long lineage is navigated.
  check('the flow control pill is present', await page.locator('#flowPill').isVisible());
  check('a fullscreen button is offered', await page.locator('#flowFullscreen').isVisible());
  const zoomBefore = await page.locator('#flowZoom').innerText();
  await page.click('#flowZoomIn');
  await page.waitForTimeout(200);
  const zoomAfter = await page.locator('#flowZoom').innerText();
  check('zooming in changes the scale', zoomBefore !== zoomAfter, zoomBefore + ' -> ' + zoomAfter);
  await page.click('#flowFit');
  await page.waitForTimeout(200);

  // Keep the lineage expanded for the screenshot: it is the shape most likely to
  // look wrong (deep nesting, long spans) and so the one most worth seeing.
  await page.click('#expandAllBtn');
  await page.waitForTimeout(400);
  await page.locator('#treeWrap').screenshot({ path: 'plate-tracker-chain.png' });
  check('lineage screenshot written', true, 'plate-tracker-chain.png');
  await page.click('#collapseAllBtn');
  await page.waitForTimeout(300);

  const okSlots = await page.locator('.slot.ok').count();
  // All five workbooks: the four production stages plus the EBTP order book.
  check('all five uploads retained (slots)', okSlots === UPLOADS.length + 3, okSlots + ' of ' + (UPLOADS.length + 3));
  const report = await page.locator('#linkReport').innerText();
  check('link report counts every stage', ['Casting', 'Rolling', 'Finishing', 'Dispatch']
    .every((s) => new RegExp(s + ': [1-9]').test(report)),
    report.replace(/\s+/g, ' ').slice(0, 130));
  const chipText = await page.locator('#dataStatusText').innerText();
  check('header status updates after ingest', /plates/.test(chipText), chipText.replace(/\s+/g, ' '));

  // Search for a key we know exists in the real extracts.
  await page.fill('#q', '607831786');
  await page.click('#searchBtn');
  await page.waitForTimeout(500);
  const found = await page.locator('#tableHost tbody tr').count();
  check('search by SO returns rows', found > 0, found + ' rows');

  if (found > 0) {
    await page.locator('#tableHost tbody tr').first().click();
    await page.waitForTimeout(500);
    check('detail section opens', await page.locator('#detail').isVisible());
    check('trace header filled', (await page.locator('#traceHead .cell').count()) >= 10);

    const nodes = await page.locator('#treeSvg .node').count();
    check('flow chart renders nodes', nodes >= 5, nodes + ' nodes');
    check('connectors drawn', (await page.locator('#treeSvg .tree-edge').count()) >= 4);

    const before = nodes;
    // Pick a node that actually has something to open. A "No record" stage
    // renders with aria-expanded absent, so clicking it correctly does nothing
    // — asserting on that would be testing the wrong thing.
    const expandable = page.locator('#treeSvg .node[aria-expanded]').first();
    check('chart has an expandable node', (await expandable.count()) > 0);
    await expandable.click();
    await page.waitForTimeout(300);
    const after = await page.locator('#treeSvg .node').count();
    check('expanding a node reveals children', after > before, before + ' -> ' + after);

    // Every node in the lineage opens a tooltip on hover, and every tooltip
    // carries a date. These checks pin down both, plus that a click or a keyboard
    // focus does NOT throw a popup over the thing being read.
    const heat = page.locator('#treeSvg .node.ident').first();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    check('the tooltip starts closed', (await page.locator('#tip.show').count()) === 0);

    await heat.hover();
    await page.waitForTimeout(250);
    check('hovering a unit opens the tooltip', (await page.locator('#tip.show').count()) === 1);
    const tipText = await page.locator('#tip').innerText();
    check('the tooltip has content', (tipText || '').length > 0, tipText.replace(/\s+/g, ' ').slice(0, 70));
    check('the tooltip carries a date', /\b20\d\d-\d\d-\d\d\b/.test(tipText),
      (tipText.match(/\b20\d\d-\d\d-\d\d\b/) || ['none'])[0]);

    // Moving off the node must close it again — a tooltip that sticks open covers
    // the chart it is describing.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    check('moving away closes the tooltip', (await page.locator('#tip.show').count()) === 0);

    await page.locator('#treeSvg .node').first().focus();
    await page.waitForTimeout(200);
    check('keyboard focus opens no tooltip', (await page.locator('#tip.show').count()) === 0);

    // A click is a toggle, not a hover, so it must not throw a popup either.
    await page.mouse.move(0, 0);
    await heat.click();
    await page.waitForTimeout(250);
    check('clicking a unit opens no tooltip', (await page.locator('#tip.show').count()) === 0);

    // Slicers sit above the table and filter it.
    check('slicer bar is shown', await page.locator('#slicerBar').isVisible());
    check('all eight slicers render', (await page.locator('#slicerRow .slicer').count()) === 8,
      String(await page.locator('#slicerRow .slicer').count()));
    const beforeSliced = await page.locator('#tableHost table.data tbody tr').count();
    await page.locator('#slicer-customerType > summary').click();
    await page.waitForTimeout(150);
    // An open panel is PORTALLED to document.body as position:fixed — that is what
    // lifts it above the table and gives the blur a backdrop. So it is addressed
    // as `body > .slicer-panel`, not as a descendant of #slicerRow.
    const openPanel = page.locator('body > .slicer-panel');
    const typeOpt = page.locator('body > .slicer-panel [data-list="customerType"] input[type=checkbox]').first();
    check('slicer lists order-book values', (await typeOpt.count()) === 1);

    // Both bugs this replaced, asserted directly.
    // 1. It must paint ABOVE the table. elementFromPoint at the panel's centre
    //    returns whatever the user would actually click, so this catches the
    //    table winning the paint order, not merely a high z-index being declared.
    // Force the panel to be tall enough that it MUST reach down into the table, then
    // hit-test a point inside that overlap band. Without this the check is flaky:
    // a short panel can legitimately stop just above the table, and then there is
    // no overlap to win and the assertion proves nothing either way.
    const aboveTable = await page.evaluate(() => {
      const p = document.querySelector('body > .slicer-panel');
      const prevMin = p.style.minHeight;
      p.style.minHeight = '520px';
      const r = p.getBoundingClientRect();
      const wrap = document.querySelector('.data-table-wrap');
      const wrapTop = wrap.getBoundingClientRect().top;
      const overlapsTable = r.bottom > wrapTop;
      // A point inside the band where panel and table coexist.
      const y = Math.min(r.bottom - 4, (r.top + wrapTop) / 2);
      const hit = document.elementFromPoint(r.left + r.width / 2, y);
      p.style.minHeight = prevMin;
      return {
        onTop: !!(hit && hit.closest('.slicer-panel')),
        overlapsTable,
        band: overlapsTable ? `y=${Math.round(y)} panel ${Math.round(r.top)}..${Math.round(r.bottom)} table@${Math.round(wrapTop)}` : 'no overlap',
      };
    });
    check('the panel overlaps the table it was hiding behind', aboveTable.overlapsTable, aboveTable.band);
    check('the open panel paints above the table', aboveTable.onTop, aboveTable.band);
    check('the panel is portalled to the body root', (await openPanel.count()) === 1);
    // Kept as an artefact: the two defects fixed here (panel hidden behind the
    // table, blur not resolving) are both VISUAL, and a passing assertion cannot
    // show that the glass actually reads as glass.
    await page.screenshot({ path: 'plate-tracker-slicer-open.png', fullPage: false });
    check('open-panel screenshot written', true, 'plate-tracker-slicer-open.png');

    // 2. The blur must actually resolve. Nested inside .glass-card the panel had
    //    no backdrop root to sample; this only proves it is DECLARED, which is
    //    why the paint-order check above is the one that matters.
    const blur = await page.evaluate(() => {
      const p = document.querySelector('body > .slicer-panel');
      return p ? getComputedStyle(p).backdropFilter : '';
    });
    check('the slicer panel keeps its blur', /blur/.test(blur), blur || 'none');

    // Flipping: a trigger near the fold must open upward rather than off-screen.
    // The <details> toggle event is queued as a task, so this has to await a
    // frame before reading the DOM — otherwise the PREVIOUSLY open panel is
    // still the one sitting on document.body and gets measured instead.
    const flipped = await page.evaluate(async () => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const bar = document.getElementById('slicerBar');
      const d = document.getElementById('slicer-mode');
      d.open = false;
      await frame();
      // Push the trigger down to just above the fold, using a transform so the
      // measured rect really moves. NOT position:fixed: .glass-card carries a
      // backdrop-filter, which makes it the containing block for fixed-position
      // descendants, so a fixed bar would be measured against the CARD, not the
      // viewport — and would not land where intended. (That same fact is exactly
      // why the panel has to be portalled to the body to behave.)
      const sum = d.querySelector('summary');
      const delta = (window.innerHeight - 30) - sum.getBoundingClientRect().bottom;
      const prevT = bar.style.transform;
      bar.style.transform = `translateY(${delta}px)`;
      d.open = true;
      await frame();
      // Address the panel by its OWN field, not "the first one on body".
      const p = [...document.querySelectorAll('body > .slicer-panel')]
        .find((x) => x.querySelector('[data-list]')?.getAttribute('data-list') === 'mode');
      const r = p.getBoundingClientRect();
      const s = d.querySelector('summary').getBoundingClientRect();
      const out = {
        flip: p.hasAttribute('data-flip'),
        inside: r.top >= 0 && r.bottom <= window.innerHeight + 1,
        triggerBottom: Math.round(s.bottom), panelTop: Math.round(r.top), panelBottom: Math.round(r.bottom),
      };
      bar.style.transform = prevT;
      d.open = false;
      return out;
    });
    check('a low trigger flips the panel above itself', flipped.flip,
      `trigger bottom ${flipped.triggerBottom}, panel ${flipped.panelTop}..${flipped.panelBottom}`);
    check('a flipped panel stays inside the viewport', flipped.inside,
      `panel ${flipped.panelTop}..${flipped.panelBottom} of ${900}`);
    await page.waitForTimeout(150);

    // Values are listed alphabetically: a slicer is a reference list people scan,
    // and first-seen order means nothing to a reader looking for a customer.
    // Queried at the document, because an open panel is portalled to body.
    const modeVals = await page.evaluate(() => {
      const d = document.getElementById('slicer-mode');
      if (!d) return null;
      d.open = true;
      const list = document.querySelector('[data-list="mode"]');
      return list ? [...list.querySelectorAll('.slicer-opt-text')].map((n) => n.textContent.trim()) : [];
    });
    if (modeVals && modeVals.length > 1) {
      const sorted = [...modeVals].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      check('slicer values are alphabetical', JSON.stringify(modeVals) === JSON.stringify(sorted),
        modeVals.slice(0, 3).join(' | '));
    }
    // Opening `mode` above closed the customerType panel (only one may be open),
    // so reopen it before interacting with typeOpt.
    await page.locator('#slicer-customerType > summary').click();
    await page.waitForTimeout(150);

    await typeOpt.check();
    await page.waitForTimeout(400);
    check('selecting a value narrows the table',
      (await page.locator('#tableHost table.data tbody tr').count()) <= beforeSliced);
    check('slicer summary reports the filter',
      ((await page.locator('#slicerSummary').innerText()) || '').includes('match'),
      await page.locator('#slicerSummary').innerText());
    await page.locator('#clearSlicersBtn').click();
    await page.waitForTimeout(300);
    check('clearing slicers restores the table',
      (await page.locator('#tableHost table.data tbody tr').count()) === beforeSliced);

    // The lineage labels each unit with its kind, so the chart reads
    // Heat → Slab → Plate without the reader needing to know which column each
    // stage uses. There is no view toggle to press any more.
    const chainKinds = await page.evaluate(() =>
      [...document.querySelectorAll('#treeSvg .node.ident')].map((n) => n.textContent));
    check('lineage labels each unit with its kind',
      chainKinds.length > 0 && chainKinds.every((t) => /Heat ID|Slab ID|Plate ID/.test(t)),
      chainKinds.slice(0, 4).join(' | '));
    // Casting is slab-identified and finishing onwards is plate-identified, which
    // is the whole point of reading the ids out of the batch column. Matched
    // with a regex because each node's text starts with its expand chevron.
    const identText = await page.evaluate(() =>
      [...document.querySelectorAll('#treeSvg .node.ident')].map((n) => n.textContent));
    const plateIds = identText.filter((t) => /Plate ID/.test(t)).length;
    const slabIds = identText.filter((t) => /Slab ID/.test(t)).length;
    check('lineage shows both slab ids and plate ids', plateIds > 0 && slabIds > 0,
      `slab=${slabIds} plate=${plateIds}`);
    const heatIds = identText.filter((t) => /Heat ID/.test(t)).length;
    check('lineage shows heat ids', heatIds > 0, `heat=${heatIds}`);
    // The route reads heat, then slab, then plate. Positions come out of layoutTree
    // in depth-first order, which is NOT left-to-right, so the check sorts by the
    // column each unit sits in: heats leftmost, plates rightmost, slabs between.
    const byColumn = await page.locator('#treeSvg').evaluate((svg) =>
      [...svg.querySelectorAll('.node.ident')].map((n) => {
        const kind = /Heat ID/i.test(n.textContent) ? 'heat'
          : /Slab ID/i.test(n.textContent) ? 'slab'
            : /Plate ID/i.test(n.textContent) ? 'plate' : 'other';
        return { kind, x: Math.round(n.querySelector('.box').getBoundingClientRect().x) };
      }));
    const minX = (k) => Math.min(...byColumn.filter((n) => n.kind === k).map((n) => n.x));
    const maxX = (k) => Math.max(...byColumn.filter((n) => n.kind === k).map((n) => n.x));
    check('lineage runs heat, then slab, then plate, left to right',
      minX('heat') < minX('slab') && maxX('slab') < maxX('plate'),
      `heat<=${minX('heat')} slab=${minX('slab')}..${maxX('slab')} plate>=${maxX('plate')}`);

    if (process.env.SMOKE_DEBUG) {
      const chain = await page.evaluate(() => {
        const t = document.querySelector('table.data');
        if (!t) return 'no table';
        const out = [];
        let el = t;
        while (el && el !== document.documentElement) {
          const cs = getComputedStyle(el);
          out.push(`${el.tagName}#${el.id || ''}.${(el.className || '').toString().split(' ')[0]} w=${Math.round(el.getBoundingClientRect().width)} minW=${cs.minWidth} maxW=${cs.maxWidth} ovf=${cs.overflowX} disp=${cs.display}`);
          el = el.parentElement;
        }
        return out.join('\n  ');
      });
      console.log('DEBUG width chain:\n  ' + chain);
    }
  }

  // The shared contract forbids animating layout properties inside a frosted
  // panel; the progress bar and tooltips must stay transform/opacity only.
  const anim = await page.evaluate(() => {
    const bad = [];
    const layoutProps = ['width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding'];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      for (const p of (cs.transitionProperty || '').split(',')) {
        if (layoutProps.includes(p.trim())) bad.push((el.className || el.tagName) + ' -> ' + p.trim());
      }
    }
    return bad.slice(0, 5);
  });
  check('no layout-property transitions', anim.length === 0, anim.join(', '));

  // Horizontal overflow must be fixed at source, never hidden on body.
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    const report = await page.evaluate((vw) => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - doc.clientWidth;
      const wide = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 || r.width > vw + 1) {
          wide.push(`${el.tagName}.${(el.className || '').toString().slice(0, 24)}=${Math.round(r.width)}@${Math.round(r.left)}`);
        }
      }
      // Walk up from each wide element to the first ancestor that actually clips.
      const culprits = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.right <= vw + 1 && r.width <= vw + 1) continue;
        let p = el.parentElement;
        while (p && p !== document.body) {
          const cs = getComputedStyle(p);
          if (cs.overflowX !== 'visible' || cs.overflow !== 'visible') break;
          p = p.parentElement;
        }
        if (!p || p === document.body) {
          culprits.push(`${el.tagName}.${(el.className || '').toString().slice(0, 30)}=${Math.round(r.width)} unclipped`);
        }
      }
      return { overflow, wide: wide.slice(0, 4), culprits: culprits.slice(0, 4) };
    }, width);
    check(`no horizontal overflow at ${width}px`, report.overflow <= 1,
      report.overflow + 'px | culprit: ' + (report.culprits.join(' ; ') || 'none') +
      ' | wide: ' + (report.wide.join(' ; ') || 'none'));
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  // Clear the pinned tooltip so it does not sit over the capture.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'plate-tracker-smoke.png' });
  check('screenshot written', true, 'plate-tracker-smoke.png');
  if (process.env.SMOKE_SHOTS) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'plate-tracker-top.png' });
    await page.evaluate(() => document.querySelector('#treeWrap')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'plate-tracker-tree.png' });

// The order-book table, with the EBTP columns leading. Cleared of the search
// term first so the unstarted orders at the top of the list are visible.
await page.fill('#q', '');
await page.waitForTimeout(300);
const table = await page.locator('#tableHost').first();
if (await table.count()) {
  await table.screenshot({ path: 'plate-tracker-table.png' });
  check('order-book table screenshot written', true, 'plate-tracker-table.png');
}
// The slicer bar and the renamed section headings, together, so the layout
// above the table is visible in a screenshot rather than only in assertions.
const trace = page.locator('#trace').first();
if (await trace.count()) {
  await trace.screenshot({ path: 'plate-tracker-slicers.png' });
  check('slicer bar screenshot written', true, 'plate-tracker-slicers.png');
}
const heading = await page.locator('#findH').innerText();
check('section is named, not numbered', !/^Step\b/i.test(heading), heading);
const headingSize = await page.locator('#findH').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
check('section heading is enlarged', headingSize >= 16, headingSize + 'px');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'plate-tracker-mobile.png' });
    check('extra screenshots written', true, 'top / tree / mobile');
  }
} catch (err) {
  failed += 1;
  console.log('FAIL threw: ' + err.message);
} finally {
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  server.close();
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall browser checks passed');
process.exit(failed ? 1 : 0);

  check('workbooks parsed and indexed', true);

  const status = await page.locator('#dataStatusText').innerText();
  check('header reports plate count', /\d/.test(status), status);
  check('link report visible', await page.locator('#linkReport').isVisible());

  const rows = await page.locator('#tableHost tbody tr').count();
  check('result table populated', rows > 0, rows + ' rows');
