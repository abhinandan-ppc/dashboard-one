import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pages = [
  'index.html',
  'admin.html',
  'Grade-Clubbing-Matrix.html',
  'Order-Status-Report.html',
  'PM-Yard.html',
  'Plate-Tagging-Tool.html',
  'Rake-Planner.html',
  'SMS-Heat-Planner.html',
  'SMS Heat Planner Daily.html',
  'SMS Heat Planner Monthly.html',
  'VDO-Generator.html',
];

const read = (file) => readFile(join(root, file), 'utf8');

test('every first-party page opts into the safe viewport', async () => {
  for (const page of pages) {
    const html = await read(page);
    assert.match(
      html,
      /<meta\s+name=["']viewport["']\s+content=["'][^"']*viewport-fit=cover[^"']*["']/i,
      `${page} must include viewport-fit=cover`,
    );
  }
});

test('hub tool pages and the ACL grant catalog stay in sync', async () => {
  const [{ KNOWN_PAGES }, hub] = await Promise.all([
    import('../api/_acl.js'),
    read('index.html'),
  ]);
  const defaultsBlock = hub.match(/var DEFAULTS = \[([\s\S]*?)\n\];/)?.[1] || '';
  const hubPages = [...defaultsBlock.matchAll(/path:"([^"]+\.html)"/g)].map((match) => match[1]);
  const missing = hubPages.filter((page) => !KNOWN_PAGES.includes(page));
  assert.deepEqual(missing, [], `hub pages missing from KNOWN_PAGES: ${missing.join(', ')}`);
});

test('responsive pages do not hide document-level horizontal defects', async () => {
  for (const page of ['Order-Status-Report.html', 'Rake-Planner.html', 'SMS Heat Planner Daily.html', 'SMS Heat Planner Monthly.html']) {
    const html = await read(page);
    assert.doesNotMatch(
      html,
      /body\s*\{[^}]*overflow-x\s*:\s*hidden\s*;/is,
      `${page} must fix overflow at its source instead of hiding it on body`,
    );
  }
});

test('shared responsive primitives cover touch and table overflow behavior', async () => {
  const theme = await read('theme.css');
  assert.match(theme, /touch-action\s*:\s*manipulation/);
  assert.match(theme, /@media[^\{]*pointer\s*:\s*coarse/);
  assert.match(theme, /@media[^\{]*max-width\s*:\s*768px/);
  assert.match(theme, /overscroll-behavior-inline\s*:\s*contain/);
  assert.match(theme, /overflow-x\s*:\s*auto/);
  assert.match(theme, /\.leaflet-control-zoom a\{width:44px/);
});

test('PM Yard positions mobile overlays from measured header clearance', async () => {
  const pmYard = await read('PM-Yard.html');
  assert.match(pmYard, /\.dropdown-panel\s*\{[\s\S]*?top\s*:\s*var\(--panel-top/);
  assert.doesNotMatch(pmYard, /\.dropdown-panel\s*\{\s*top\s*:\s*178px\s*!important/);
  assert.doesNotMatch(pmYard, /\.dropdown-panel\s*\{\s*top\s*:\s*172px\s*!important/);
  assert.match(pmYard, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.left-toggle\s*\{\s*right:\s*-12px/);
});

test('Rake KPI cards can shrink instead of widening the page', async () => {
  const rake = await read('Rake-Planner.html');
  assert.match(rake, /function KCard\([\s\S]*?minWidth:0/);
  assert.match(rake, /function KCard\([\s\S]*?overflow:'hidden'/);
});

test('server-rendered access pages opt into safe viewport sizing', async () => {
  for (const file of ['middleware.js', 'api/auth/callback.js']) {
    const source = await read(file);
    assert.match(source, /viewport-fit=cover/);
    assert.match(source, /100dvh/);
  }
});

test('Order Status loading skeleton stays inside a horizontal scroller', async () => {
  const orderStatus = await read('Order-Status-Report.html');
  assert.match(orderStatus, /<div className="data-table-wrap">\s*<table className="skeleton-table">/);
});

test('Order Status desktop header spans its dashboard content width', async () => {
  const theme = await read('theme.css');
  assert.match(
    theme,
    /\.page-order \.glass-card\.header-enter\s*\{[^}]*max-width:\s*none\s*!important/s,
    'Order Status header must not be narrower than the full-width content below it',
  );
});
