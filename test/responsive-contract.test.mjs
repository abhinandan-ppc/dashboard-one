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
  assert.match(pmYard, /body\s*\{\s*position:\s*fixed;\s*inset:\s*0;\s*width:\s*100%;\s*\}/);
  assert.match(pmYard, /#root canvas\s*\{[^}]*width:\s*100%\s*!important;\s*height:\s*100%\s*!important/);
});

test('Rake KPI values stay whole on narrow screens via a scrolling strip', async () => {
  const rake = await read('Rake-Planner.html');
  // Narrow screens stop sharing the row and scroll the strip instead, so the
  // overflow lands on the strip and never becomes a document-level scrollbar.
  assert.match(rake, /flexWrap:mob\?'nowrap':'wrap'/);
  assert.match(rake, /overflowX:mob\?'auto':'visible'/);
  // Each card is sized to its own content rather than competing for row width.
  assert.match(rake, /function KCard\([\s\S]*?flex:mob\?'0 0 auto':'1 0 auto'/);
  assert.match(rake, /function KCard\([\s\S]*?minWidth:mob\?156:undefined/);

  const kcard = rake.slice(rake.indexOf('function KCard('), rake.indexOf('JINDAL STEEL LOGO'));
  // The value line must render in full: the automatic minimum width is what
  // holds it open now that the card no longer shrinks, so min-width:0 and the
  // ellipsis both have to stay gone.
  assert.match(kcard, /lineHeight:1\.1,whiteSpace:'nowrap'\}\}>\{value\}/);
  assert.doesNotMatch(kcard, /textOverflow:'ellipsis'[^}]*\}\}>\{value\}/);
  assert.doesNotMatch(kcard, /maxWidth:mob\?'calc\(50% - 4px\)'/);

  // The card root itself must no longer clip or cap its width. (The short `sub`
  // caption below it keeps its own ellipsis, which is unrelated to the value.)
  const cardRoot = kcard.slice(kcard.indexOf('return<div style={{...card,'), kcard.indexOf('onMouseEnter'));
  assert.doesNotMatch(cardRoot, /maxWidth/);
  assert.doesNotMatch(cardRoot, /overflow:'hidden'/);
  assert.doesNotMatch(cardRoot, /minWidth:0/);
});

test('sticky header shells are not displaced by the fixed-position centring', async () => {
  const theme = await read('theme.css');
  // The desktop rule centres the shell with left:50% + translateX(-50%), which
  // only applies while it is position:fixed. The mobile block flips the shell to
  // position:sticky, so it must clear those offsets — otherwise the in-flow
  // header is pushed half a viewport off-canvas while scrollWidth stays equal
  // to clientWidth (leftward overflow is unreachable in an LTR document).
  const mobileShell = theme.slice(
    theme.indexOf('@media (max-width:768px)'),
    theme.indexOf('@media (max-width:640px)'),
  );
  assert.match(mobileShell, /\.app-header-shell\s*\{[\s\S]*?position:sticky!important/);
  assert.match(mobileShell, /\.app-header-shell\s*\{[\s\S]*?left:auto!important/);
  assert.match(mobileShell, /\.app-header-shell\s*\{[\s\S]*?right:auto!important/);
  assert.match(mobileShell, /\.app-header-shell\s*\{[\s\S]*?transform:none!important/);

  // The SMS view tabs used to be absolutely centred inside the header bar and
  // overlapped the reset control as the bar narrowed. They must sit in the flex
  // flow instead, growing into the gap but never shrinking below their content.
  assert.match(theme, /\.app-header \.view-tabs\s*\{[\s\S]*?position:static!important/);
  assert.match(theme, /\.app-header \.view-tabs\s*\{[\s\S]*?transform:none!important/);
  assert.match(theme, /\.app-header \.view-tabs\s*\{[\s\S]*?flex:0 0 auto!important/);
  assert.match(theme, /\.app-header \.view-tabs\s*\{[\s\S]*?margin-left:auto!important/);
  assert.match(theme, /\.app-header \.view-tabs\s*\{[\s\S]*?margin-right:auto!important/);
});

test('the browser audit guards against off-canvas headers, not just overflow', async () => {
  const audit = await read('scripts/responsive-browser-audit.mjs');
  // Leftward displacement is invisible to scrollWidth, so the audit has to
  // measure the header's own edges and the widths it samples.
  assert.match(audit, /headerShell: edges\(document\.querySelector\('\.app-header-shell'\)\)/);
  assert.match(audit, /header: edges\(document\.querySelector\('\.app-header'\)\)/);
  assert.match(audit, /rect\.left < -0\.5/);
  assert.match(audit, /rect\.right > result\.clientWidth \+ 0\.5/);
  for (const width of [320, 390, 768, 1440, 1920]) {
    assert.match(audit, new RegExp(`width: ${width},`), `audit must sample ${width}px`);
  }
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

test('standalone dashboard headers opt into the shared hub chrome', async () => {
  const theme = await read('theme.css');
  assert.match(theme, /\.app-header-shell\s*\{[\s\S]*?position:fixed!important/);
  assert.match(theme, /\.app-header,\s*\.page-order \.glass-card\.header-enter/);
  assert.match(theme, /--header-control-size:40px/);
  assert.match(theme, /\.page-admin\{--header-shell-max-width:1180px\}/);
  assert.match(theme, /\.page-grade\{--header-shell-max-width:1440px\}/);
  assert.match(theme, /\.page-plate\{--header-shell-max-width:1720px\}/);
  assert.match(theme, /\.page-sms-shell\{--header-shell-max-width:1600px\}/);
  assert.match(theme, /--header-main-radius:20px/);
  assert.match(theme, /background:linear-gradient\(145deg,color-mix\(in srgb,var\(--glass\) 94%,white 6%\),var\(--glass-card\)\)!important/);
  assert.match(theme, /border:0!important/);
  assert.match(theme, /box-shadow:var\(--shadow-lg\),var\(--shadow-inset\)!important/);
  assert.match(theme, /font-family:var\(--font-display\)!important/);
  assert.match(theme, /@media\s*\(max-width:640px\)[\s\S]*?\.app-header \.jspl-logo[\s\S]*?width:34px!important;height:16px!important/);
  assert.match(theme, /@media\s*\(max-width:400px\)[\s\S]*?padding:10px!important/);

  const pages = [
    'index.html',
    'admin.html',
    'Grade-Clubbing-Matrix.html',
    'Order-Status-Report.html',
    'PM-Yard.html',
    'Plate-Tagging-Tool.html',
    'Rake-Planner.html',
    'SMS-Heat-Planner.html',
    'VDO-Generator.html',
  ];
  for (const page of pages) {
    const html = await read(page);
    assert.match(html, /app-header/, `${page} must use the shared header chrome`);
  }

  for (const page of ['Order-Status-Report.html', 'Rake-Planner.html']) {
    const html = await read(page);
    assert.match(html, /className="jspl-logo"/, `${page} must use the shared responsive logo hook`);
  }
  const orderStatus = await read('Order-Status-Report.html');
  assert.match(orderStatus, /const placeholderHeaderBar=/, 'Order Status loading/error states must retain the full header');

  const gradeClubbing = await read('Grade-Clubbing-Matrix.html');
  assert.match(gradeClubbing, /--grade-header-offset/, 'Grade Clubbing must reserve its fixed-header clearance dynamically');
  assert.match(gradeClubbing, /ResizeObserver[\s\S]*?scheduleGradeHeaderOffset/, 'Grade Clubbing header clearance must react to header size changes');
});

test('shared content surfaces and controls reuse the header material', async () => {
  const theme = await read('theme.css');
  assert.match(theme, /--component-radius:20px/);
  assert.match(theme, /--component-surface:linear-gradient\(145deg,color-mix\(in srgb,var\(--glass\) 94%,white 6%\),var\(--glass-card\)\)/);
  assert.match(theme, /--component-shadow:var\(--shadow-lg\),var\(--shadow-inset\)/);
  assert.match(theme, /body:is\([^)]*\.page-hub[^)]*\) :is\([^]*?\.panel:not\(\.app-header\)[^]*?\)/);
  assert.match(theme, /button:not\(\.app-header button\)\{[\s\S]*?background:var\(--input-bg\)/);
  assert.match(theme, /button:not\(\.app-header button\):is\(\.primary,[\s\S]*?background:var\(--md-sys-color-primary\)!important/);
  assert.match(theme, /\.page-sms-daily \.tab-bar,[\s\S]*?border-radius:var\(--component-radius\) var\(--component-radius\) 0 0!important/);
  assert.match(theme, /\.page-sms-monthly \.fn\.fn-selected\{[\s\S]*?0 0 0 7px var\(--md-sys-color-primary\)!important/);

  const contract = theme.slice(
    theme.indexOf('/* Shared content component contract.'),
    theme.indexOf('button,.btn,.m3-button'),
  );
  assert.doesNotMatch(
    contract,
    /(^|[;{])\s*(?:display|position|inset|top|right|bottom|left|width|height|min-width|min-height|max-width|max-height|padding|margin|gap|grid|flex|overflow|transform)\s*:/m,
    'shared component paint must not introduce layout properties',
  );

  for (const page of ['Order-Status-Report.html', 'Rake-Planner.html']) {
    const html = await read(page);
    assert.match(html, /background:'var\(--component-surface\)'/, `${page} React cards must use the shared component surface`);
    assert.match(html, /boxShadow:'var\(--component-shadow\)'/, `${page} React cards must use the shared component shadow`);
    assert.match(html, /borderRadius:'var\(--radius-pill\)'/, `${page} React inputs and buttons must use the shared pill control`);
  }
});

test('Order Status desktop header spans its dashboard content width', async () => {
  const theme = await read('theme.css');
  assert.match(
    theme,
    /\.page-order \.glass-card\.header-enter\s*\{[^}]*max-width:\s*none\s*!important/s,
    'Order Status header must not be narrower than the full-width content below it',
  );
});
