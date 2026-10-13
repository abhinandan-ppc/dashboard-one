import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadPlaywright() {
  const npxRoot = join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  if (!existsSync(npxRoot)) return null;
  for (const dir of readdirSync(npxRoot)) {
    for (const file of ['index.mjs', 'index.js']) {
      const candidate = join(npxRoot, dir, 'node_modules', 'playwright', file);
      if (existsSync(candidate)) return import(pathToFileURL(candidate).href);
    }
  }
  return null;
}

const playwright = await loadPlaywright();
if (!playwright) {
  console.log('skip  playwright not found in the npx cache');
  process.exit(0);
}

const root = resolve('.');
const port = 8732;
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent((request.url || '/').split('?')[0]);
    const file = join(root, pathname === '/' ? 'Plate-Tracker.html' : pathname);
    if (!file.startsWith(root)) throw new Error('outside root');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end('not found');
  }
});
await new Promise((resolveListen) => server.listen(port, resolveListen));

let failures = 0;
const check = (label, value, detail = '') => {
  console.log(`${value ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!value) failures += 1;
};

const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

try {
  await page.goto(`http://127.0.0.1:${port}/Plate-Tracker.html`, { waitUntil: 'load' });
  await page.setInputFiles('#file-slabStock', resolve('sheets/SLAB STOCK.xlsx'));
  await page.waitForFunction(() => document.querySelector('#slot-slabStock')?.classList.contains('ok'), null, { timeout: 180000 });
  await page.setInputFiles('#file-plateStock', resolve('sheets/PLATE STOCK.xlsx'));
  await page.waitForFunction(() => document.querySelector('#slot-plateStock')?.classList.contains('ok'), null, { timeout: 180000 });

  check('seven upload slots render', await page.locator('.slot').count() === 7);
  check('both stock workbooks load', await page.locator('.slot.ok').count() === 2);

  await page.click('[data-view="stock"]');
  await page.waitForTimeout(300);
  const stockRows = await page.locator('#tableHost tbody tr').count();
  check('stock view contains inventory rows', stockRows > 0, `${stockRows} rows`);
  check('slab stock appears', await page.locator('.stock-kind.slab').count() > 0);
  check('plate stock appears', await page.locator('.stock-kind.plate').count() > 0);
  check('every stock KPI is a cross-filter button', await page.locator('#summaryChips button[data-kpi-filter]').count() === 6);

  await page.click('#summaryChips [data-kpi-filter="slab"]');
  await page.waitForTimeout(100);
  check('slab KPI enters selected state', await page.locator('#summaryChips [data-kpi-filter="slab"][aria-pressed="true"]').count() === 1);
  const slabOnly = await page.locator('#tableHost [data-stock-kind]').evaluateAll((items) => items.length > 0 && items.every((item) => item.dataset.stockKind === 'slab'));
  check('slab KPI cross-filters the table', slabOnly);

  await page.click('#summaryChips [data-kpi-filter="slab"]');
  await page.waitForTimeout(100);
  check('clicking a selected KPI resets to all', await page.locator('#summaryChips [data-kpi-filter="all"][aria-pressed="true"]').count() === 1);

  await page.locator('#tableHost [data-stock-kind="plate"]').first().click();
  await page.waitForTimeout(100);
  check('table stock badge cross-filters its view', await page.locator('#summaryChips [data-kpi-filter="plate"][aria-pressed="true"]').count() === 1);
  await page.click('#summaryChips [data-kpi-filter="all"]');
  await page.waitForTimeout(100);
  await page.locator('#trace').screenshot({ path: 'plate-tracker-crossfilters.png' });
  check('cross-filter screenshot written', true, 'plate-tracker-crossfilters.png');

  await page.click('[data-view="orders"]');
  await page.waitForTimeout(100);
  check('every order KPI is a cross-filter button', await page.locator('#summaryChips button[data-kpi-filter]').count() === 6);
  await page.click('#summaryChips [data-kpi-filter="not-started"]');
  await page.waitForTimeout(100);
  check('order KPI cross-filter enters selected state', await page.locator('#summaryChips [data-kpi-filter="not-started"][aria-pressed="true"]').count() === 1);
  check('order KPI leaves matching rows visible', await page.locator('#tableHost tbody tr').count() > 0);
  await page.locator('#trace').screenshot({ path: 'plate-tracker-order-compact.png' });
  check('compact order screenshot written', true, 'plate-tracker-order-compact.png');
  await page.click('[data-view="stock"]');
  await page.click('#summaryChips [data-kpi-filter="all"]');
  await page.waitForTimeout(100);

  const linked = page.locator('#tableHost tr[data-key]').first();
  check('stock links to at least one order trace', await linked.count() === 1);
  if (await linked.count()) {
    await linked.click();
    await page.waitForTimeout(250);
    const cards = page.locator('#processFlow .lineage-card[data-lineage-level]');
    check('flow expands four lineage levels', await cards.count() >= 4);
    const levels = ['heat', 'slab', 'plate', 'dispatch'];
    for (const level of levels) check(`${level} lineage card is present`, await page.locator(`#processFlow [data-lineage-level="${level}"]`).count() >= 1);
    const route = await page.locator('#processFlow .lineage-route').innerText();
    check('flow order is Heat to Dispatch', route.replace(/\s+/g, ' ').trim().toLowerCase() === 'heat → slab → plate → dispatch', route);
    check('legacy pan and zoom controls are hidden', !(await page.locator('#flowPill').isVisible()));
    check('legacy expand controls are hidden', !(await page.locator('#expandAllBtn').isVisible()));

    const slab = page.locator('[data-lineage-level="slab"]').first();
    await slab.locator(':scope > .lineage-card-top').hover();
    await page.waitForTimeout(150);
    check('hover opens stage tooltip', await page.locator('#tip.show').count() === 1);
    const tooltip = await page.locator('#tip').innerText();
    check('stock detail is present in tooltip', /Stock (records|quantity)/i.test(tooltip), tooltip.replace(/\s+/g, ' ').slice(0, 120));
    check('stock stage shows individual slab cards', await page.locator('[data-lineage-level="slab"]').count() >= 1);
    await slab.locator(':scope > .lineage-card-top').hover();
    await page.waitForTimeout(100);
    const entityTooltip = await page.locator('#tip').innerText();
    check('individual slab card has its own tooltip', /Slab ID/i.test(entityTooltip), entityTooltip.replace(/\s+/g, ' ').slice(0, 120));

    await page.mouse.move(0, 0);
    await slab.focus();
    await page.waitForTimeout(100);
    check('keyboard focus opens stage tooltip', await page.locator('#tip.show').count() === 1);
    await page.keyboard.press('ArrowRight');
    check('arrow keys move through the lineage', await page.locator('[data-lineage-level="plate"]:focus').count() === 1);

    check('lineage exposes dates on the cards', await page.locator('#processFlow .lineage-date').count() >= 4);
    const chartModes = [
      ['flowchart', '.flowchart-view .flowchart-node'],
      ['tree', '.expandable-tree details'],
      ['sankey', '.sankey-svg .sankey-node'],
    ];
    for (const [mode, selector] of chartModes) {
      await page.click(`[data-chart-mode="${mode}"]`);
      await page.waitForTimeout(100);
      check(`${mode} mode is selected`, await page.locator(`[data-chart-mode="${mode}"]`).getAttribute('aria-pressed') === 'true');
      check(`${mode} mode renders its chart`, await page.locator(`#processFlow ${selector}`).count() >= 1);
      check(`${mode} mode keeps date status visible`, await page.locator('#processFlow').innerText().then((text) => /20\d{2}-\d{2}-\d{2}|Date not reported/.test(text)));
    }
    await page.click('[data-chart-mode="lineage"]');

    await page.locator('#detail').screenshot({ path: 'plate-tracker-stock-flow.png' });
    check('stock flow screenshot written', true, 'plate-tracker-stock-flow.png');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    widest: [...document.querySelectorAll('body *')]
      .map((element) => ({ selector: `${element.tagName.toLowerCase()}#${element.id}.${element.className}`, width: element.getBoundingClientRect().right }))
      .filter((item) => item.width > window.innerWidth + 1)
      .sort((a, b) => b.width - a.width)
      .slice(0, 3),
  }));
  check('cross-filters fit a narrow viewport', overflow.document <= overflow.viewport + 1, JSON.stringify(overflow));
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('browser smoke completed', false, error.message);
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall stock flow checks passed');
process.exit(failures ? 1 : 0);
