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

// Collect every brace-balanced @media block with the given prelude. Slicing
// from one breakpoint marker to the next instead silently yields an empty
// string the moment an unrelated breakpoint is introduced between two blocks
// (e.g. the --page-gutter tablet/mobile steps), and a page's mobile rules may
// legitimately live in more than one block at the same breakpoint.
const mediaBlocks = (css, prelude) => {
  const blocks = [];
  for (let at = css.indexOf(prelude); at >= 0; at = css.indexOf(prelude, at + prelude.length)) {
    const open = css.indexOf('{', at);
    if (open < 0) break;
    let depth = 0;
    let end = -1;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end < 0) break;
    blocks.push(css.slice(at, end));
  }
  return blocks;
};

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

test('section spacing comes from one shared vertical-rhythm contract', async () => {
  const theme = await read('theme.css');
  // Two tiers, so pages stop restating gaps as literals: a section tier for the
  // top-level content blocks and a denser tier for rows/card internals.
  assert.match(theme, /--space-stack:\s*24px/);
  assert.match(theme, /--space-stack-sm:\s*16px/);
  assert.match(theme, /--space-section:\s*16px/);
  assert.match(theme, /--space-mobile:\s*12px/);

  // Every stack container the four dashboards actually use must be in the
  // contract, at the desktop step AND at the responsive step, or it keeps its
  // own literal and drifts apart again.
  const stacks = [
    '.app-shell', '.main-container', '.content-area', '.controls-sidebar',
    '.main-layout', '.dashboard-top-section', '.dashboard-side-controls',
    '.ov-grid', '.pm-grid', '.eq-grid',
  ];
  const rows = ['.grid', '.kpis', '.kpi-row', '.kpi-strip', '.row', '.tabs'];
  // The mobile step must re-declare the same selector list, or a page that
  // dropped its literal reverts to the desktop gap on small screens. Parse the
  // rules rather than slicing the file, so the declaration is matched to the
  // selector list it actually belongs to.
  const rulesFor = (rawSrc) => {
    // Strip comments first: a comment sitting above a rule becomes part of the
    // captured selector text, and any comma inside it splits the list.
    const src = rawSrc.replace(/\/\*[\s\S]*?\*\//g, ' ');
    // Walk the source tracking brace depth. A regex over `[^{}]+` mis-associates
    // declarations with selectors once two rules share a selector, so scan.
    const map = new Map();
    let depth = 0, selStart = 0, blockStart = -1;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === '{') {
        if (depth === 0) blockStart = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && blockStart > -1) {
          const selText = src.slice(selStart, blockStart);
          const decls = src.slice(blockStart + 1, i);
          for (const sel of selText.split(',')) {
            const name = sel.replace(/\s+/g, ' ').trim();
            if (name) map.set(name, (map.get(name) || '') + ';' + decls);
          }
          selStart = i + 1;
          blockStart = -1;
        }
      }
    }
    return map;
  };
  const desktop = rulesFor(theme);
  for (const sel of stacks) {
    assert.match(
      desktop.get(sel) || '',
      /gap:\s*var\(--space-stack\)/,
      `${sel} must resolve its gap to --space-stack at the desktop step`,
    );
  }
  for (const sel of rows) {
    assert.match(
      desktop.get(sel) || '',
      /gap:\s*var\(--space-section\)/,
      `${sel} must resolve its gap to --space-section`,
    );
  }
  // Slice from just inside the enclosing @media block: starting at `@media`
  // would make the scanner capture the whole media query as a single selector
  // and swallow every rule inside it.
  const mobileUsage = theme.indexOf('--space-stack-sm)');
  const mobileMedia = theme.lastIndexOf('@media', mobileUsage);
  const mobile = rulesFor(theme.slice(theme.indexOf('{', mobileMedia) + 1));
  for (const sel of stacks) {
    assert.match(
      mobile.get(sel) || '',
      /gap:\s*var\(--space-stack-sm\)/,
      `${sel} must resolve to --space-stack-sm at the mobile step`,
    );
  }
  for (const sel of rows) {
    assert.match(
      mobile.get(sel) || '',
      /gap:\s*var\(--space-mobile\)/,
      `${sel} must resolve to --space-mobile at the mobile step`,
    );
  }

  // The pages must not reintroduce literals for those containers.
  const files = [
    'Rake-Planner.html', 'SMS-Heat-Planner.html',
    'SMS Heat Planner Daily.html', 'SMS Heat Planner Monthly.html',
  ];
  const owned = [...stacks, ...rows];
  // Match class names exactly, not as substrings: `.tabs` would otherwise also
  // match `.tabs-hdr`, which is a tab strip with its own dense-tier gap.
  const ownedPattern = new RegExp(
    owned.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])').join('|'),
  );
  for (const file of files) {
    const src = await read(file);
    for (const line of src.split('\n')) {
      if (!/gap:/.test(line)) continue;
      if (!ownedPattern.test(line)) continue;
      assert.doesNotMatch(
        line,
        /gap:\s*\d+px/,
        `${file} must not hardcode a gap for a contract-owned container: ${line.trim().slice(0, 80)}`,
      );
    }
  }

  // Rake used to stack its main column with gap:0 plus per-card margins, which
  // produced three different separations for the same role.
  const rake = await read('Rake-Planner.html');
  assert.doesNotMatch(rake, /flexDirection:'column',minWidth:0,gap:0/);
  assert.doesNotMatch(rake, /marginBottom:14/, 'the main column gap now owns card separation');
  assert.doesNotMatch(rake, /marginTop:14/, 'the main column gap now owns card separation');
  assert.doesNotMatch(rake, /marginTop:40/, 'the 40px footer outlier must sit on the shared rhythm');
});

test('the PM Yard panel header keeps the panel rounded at the top', async () => {
  const theme = await read('theme.css');
  const pmYard = await read('PM-Yard.html');

  // The panel does NOT clip its children, so an opaque first child paints over
  // the panel's own rounded corners. Assert both halves of that chain so the
  // fix cannot be "simplified" away one side at a time.
  assert.match(
    pmYard,
    /\.panel\s*\{[^}]*overflow:\s*visible\s*!important/,
    'the panel must stay overflow:visible so the collapse toggle can overhang',
  );
  assert.match(
    theme,
    /body:is\([^)]*\.page-pm[^)]*\)[\s\S]*?\.panel:not\(\.app-header\)[\s\S]*?border-radius:\s*var\(--component-radius\)\s*!important/,
    'the shared surface contract must still round .panel',
  );
  // The header band carries the shared surface, so it must carry the radius too.
  assert.match(
    theme,
    /body:is\([^)]*\.page-pm[^)]*\)\s*:is\(\s*\.panel-head[^}]*?background:\s*var\(--component-surface\)\s*!important/,
    'the panel header still receives an opaque shared surface',
  );
  assert.match(
    theme,
    /body\.page-pm\s+\.panel-head\s*\{\s*border-radius:\s*var\(--component-radius\)\s+var\(--component-radius\)\s+0\s+0\s*!important/,
    'the PM Yard panel header must round its own top corners to match the panel',
  );
  // And it must not round the bottom, or the join to the body would break.
  const band = theme.slice(theme.indexOf('body.page-pm .panel-head'));
  assert.doesNotMatch(
    band.slice(0, band.indexOf('}')),
    /var\(--component-radius\)\s+var\(--component-radius\)\s+var\(--component-radius\)/,
    'the header must not round its bottom corners — the body continues below it',
  );
});

test('the shared content gutter is a single three-step scale', async () => {
  const theme = await read('theme.css');
  assert.match(theme, /--page-gutter:\s*24px/, 'desktop gutter must be 24px');
  // The tablet step is the one that was missing: pages previously kept the
  // desktop gutter all the way down to the mobile breakpoint.
  assert.match(theme, /@media\s*\(max-width:\s*1024px\)\s*\{\s*:root\s*\{\s*--page-gutter:\s*20px;?\s*\}\s*\}/, 'tablet (<=1024px) gutter must be 20px');
  assert.match(theme, /@media\s*\(max-width:\s*640px\)\s*\{\s*:root\s*\{\s*--page-gutter:\s*16px;?\s*\}\s*\}/, 'mobile (<=640px) gutter must be 16px');
  assert.match(theme, /--page-side:\s*var\(--page-gutter\)/, 'the legacy alias must resolve to the shared token');

  // The floating header must track the same scale, or the bar sits inboard of
  // the content it is supposed to span (it used to be pinned at 12px).
  const shell = theme.slice(theme.indexOf('.app-header-shell{'), theme.indexOf('.app-header-shell>.app-header'));
  assert.match(shell, /--header-shell-gutter/);
  assert.doesNotMatch(theme, /--header-shell-gutter:\s*\d/, '--header-shell-gutter must be derived, never a literal');
});

test('every dashboard resolves its page gutter from the shared token', async () => {
  for (const page of pages) {
    const html = await read(page);
    if (page === 'PM-Yard.html') {
      // The yard canvas is full-bleed and its floating HUD is inset by its own
      // token; the page gutter does not apply. Guarded separately.
      assert.match(html, /--pm-hud-inset/, `${page} must keep its own HUD inset token`);
      continue;
    }
    assert.match(
      html,
      /var\(--page-gutter\)|var\(--page-side\)/,
      `${page} must take its content gutter from the shared token`,
    );
  }
});

test('pages do not hardcode a page-level content gutter', async () => {
  // A literal inset on a page-level wrapper is exactly how these dashboards
  // drifted apart (10/12/20/24px). Scoped to the wrappers that actually set the
  // page inset — a blanket "no literal padding" rule would flag every card's
  // internal padding, which is a different concern.
  const wrappers = [
    '.wrap', '.app-shell', '.main-container', '.stage', '.top-wrapper',
    '.hdr-wrapper', '.sticky-wrapper', '.header-fixed', '.alert-banner', 'footer',
  ];
  const selector = `(?:main\\s*)?(?:${wrappers.map((w) => w.replace('.', '\\.')).join('|')})`;
  const rulePattern = new RegExp(`(${selector})\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'g');
  for (const page of pages) {
    if (page === 'PM-Yard.html') continue; // full-bleed canvas, own HUD token
    const html = await read(page);
    for (const [, name, body] of html.matchAll(rulePattern)) {
      const padding = /\bpadding:\s*([^;}]+)/.exec(body)?.[1]?.trim();
      if (!padding) continue;
      const usesToken = /var\(--page-gutter\)|var\(--page-side\)/.test(padding);
      // A purely vertical padding (e.g. "8px 0 0") sets no horizontal inset.
      const verticalOnly = /^\d+(?:\.\d+)?px(?:\s+0(?:\s+0)?)?\s*$/.test(padding);
      assert.ok(
        usesToken || verticalOnly,
        `${page}: ${name} hardcodes a page gutter (padding: ${padding}) — use var(--page-gutter)`,
      );
    }
  }
  // React pages set the inset as an inline style on their content wrapper.
  // Assert those specific wrappers resolve the token rather than restating a
  // literal — a blanket "no literal padding" match would flag every inner panel.
  const reactWrappers = [
    ["Order-Status-Report.html", /padding:'0 var\(--page-gutter\) 60px'/, 2],
    ["Rake-Planner.html", /padding:`0 var\(--page-gutter\) 28px`/, 1],
  ];
  for (const [page, pattern, count] of reactWrappers) {
    const html = await read(page);
    const found = html.match(new RegExp(pattern.source, 'g')) || [];
    assert.equal(found.length, count, `${page} must set its content wrapper gutter from the token`);
  }
  const rake = await read('Rake-Planner.html');
  assert.doesNotMatch(rake, /padding:`0 \$\{mob\?12:24\}px 28px`/, 'Rake must not branch its page gutter on a literal');
  const osr = await read('Order-Status-Report.html');
  assert.doesNotMatch(osr, /padding:mob\?'0 12px 60px'/, 'Order Status must not branch its page gutter on a literal');
});

test('the Rake side menus are rounded surfaces', async () => {
  const theme = await read('theme.css');
  const rake = await read('Rake-Planner.html');
  // The desktop sidebar opts into the shared card-surface contract, so it
  // inherits the app card radius instead of being a bare square-edged column.
  assert.match(rake, /className="app-side-panel"/, 'the desktop sidebar must use .app-side-panel');
  assert.match(theme, /\.app-side-panel/, '.app-side-panel must be part of the shared surface contract');
  // The drawer is edge-anchored: the card contract pins a full 20px radius with
  // !important, which would round the corners flush against the viewport and
  // visibly detach the panel, so it gets its own rule instead.
  assert.match(rake, /className="app-side-drawer"/, 'the mobile drawer must use .app-side-drawer');
  const drawer = theme.slice(theme.indexOf('.app-side-drawer{'));
  assert.match(drawer, /border-radius:0 var\(--component-radius\)/, 'the drawer rounds only its outward corners');
  assert.doesNotMatch(theme, /\.app-side-drawer\s*\{[^}]*!important/, 'the drawer must stay out of the !important card contract');
});

test('the Order Status map re-measures itself and uses keyless tiles', async () => {
  const osr = await read('Order-Status-Report.html');
  assert.doesNotMatch(
    osr,
    /basemaps\.cartocdn\.com/,
    'CARTO basemaps now require an API key and render "API KEY REQUIRED" watermark tiles',
  );
  assert.match(osr, /tile\.openstreetmap\.org/, 'the map must use the keyless OSM tile provider');
  // Leaflet caches its size at init, so the map needs an explicit re-measure
  // after the responsive grid collapses it.
  assert.match(osr, /ResizeObserver/, 'the map must observe its own box for resizes');
  assert.match(osr, /invalidateSize/, 'the map must invalidate its size after layout changes');
});

test('sticky header shells are not displaced by the fixed-position centring', async () => {
  const theme = await read('theme.css');
  // The desktop rule centres the shell with left:50% + translateX(-50%), which
  // only applies while it is position:fixed. The mobile block flips the shell to
  // position:sticky, so it must clear those offsets — otherwise the in-flow
  // header is pushed half a viewport off-canvas while scrollWidth stays equal
  // to clientWidth (leftward overflow is unreachable in an LTR document).
  const mobileShells = mediaBlocks(theme, '@media (max-width:768px)');
  assert.ok(mobileShells.length, 'the 768px media block must exist');
  const mobileShell = mobileShells.find((block) => block.includes('.app-header-shell'));
  assert.ok(mobileShell, 'a 768px media block must carry the .app-header-shell overrides');
  for (const [label, pattern] of [
    ['position', /position:sticky!important/],
    ['left', /left:auto!important/],
    ['right', /right:auto!important/],
    ['transform', /transform:none!important/],
  ]) {
    assert.match(mobileShell, pattern, `mobile shell must reset ${label}`);
  }

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

test('the shared card-surface contract does not claim flat PM Yard KPI groups', async () => {
  const theme = await read('theme.css');
  // The card-surface rule paints a radius + shadow + filled surface with
  // !important, so anything listed in it is a card whether or not it wants to
  // be. A KPI group is a plain text group: listing it turned the PM Yard header
  // into a row of rounded, shadowed buttons that also clipped their own labels.
  // Anchor on the first entry rather than a newline-terminated string, so this
  // does not depend on the file's line endings.
  const start = theme.indexOf('.panel:not(.app-header)');
  assert.ok(start > -1, 'shared card-surface rule must still exist');
  const cardRule = theme.slice(start, theme.indexOf('){', start));
  assert.doesNotMatch(cardRule, /\.kpi-group\b/);

  const pmYard = await read('PM-Yard.html');
  const group = pmYard.slice(
    pmYard.indexOf('.kpi-group {'),
    pmYard.indexOf('.kpi-group-title'),
  );
  // Flat: no surface, no border, no shadow, no radius, and a hover state that
  // cannot read as a button chrome.
  assert.match(group, /\.kpi-group\s*\{[\s\S]*?border-radius:\s*0/);
  assert.match(group, /\.kpi-group\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(group, /\.kpi-group\s*\{[\s\S]*?box-shadow:\s*none/);
  assert.doesNotMatch(group, /:hover\s*\{[^}]*background/);
  assert.doesNotMatch(group, /:hover\s*\{[^}]*box-shadow/);
  assert.doesNotMatch(group, /:hover\s*\{[^}]*transform/);
  // Non-shrinking, so a title is never clipped and the strip scrolls instead.
  for (const sel of ['.kpi-group', '.kpi-pill', '.kpi-stat', '.kpi-divider']) {
    const rule = pmYard.slice(pmYard.indexOf(`${sel} {`));
    assert.match(
      rule.slice(0, rule.indexOf('}')),
      /flex-shrink:\s*0/,
      `${sel} must not shrink`,
    );
  }
});

test('the PM Yard side panels keep the shared card radius', async () => {
  const pmYard = await read('PM-Yard.html');
  // Both PM Yard panels float inside --pm-hud-inset on every side, so neither is
  // flush with the viewport edge. theme.css's card-surface contract already
  // supplies a 20px radius to every .panel with !important, and the page must
  // leave it alone: the previous override zeroed the aside to read it as a HUD
  // surface, which required id-scoping to (1,2,2) just to beat the contract's
  // (0,3,1). Neither panel may pin its radius to square.
  assert.doesNotMatch(
    pmYard,
    /aside[^{]*\{[^}]*border-radius:\s*0\s*!important/,
    'the left filter menu must keep the shared card radius',
  );
  // The right inspector is a separate transient panel and stays rounded too.
  assert.doesNotMatch(pmYard, /\.inspector[^{]*\{[^}]*border-radius:\s*0\s*!important/);
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

test('the PM Yard KPI strip stays left-aligned so its first group is reachable', async () => {
  const pmYard = await read('PM-Yard.html');
  const strip = pmYard.slice(pmYard.indexOf('.kpi-dashboard {'), pmYard.indexOf('.kpi-pill {'));
  // Centred flex content overflows on BOTH sides, and the left half can never be
  // reached (scrollLeft cannot go below 0 in an LTR document) — that is what cut
  // the first KPI group off and made it impossible to scroll back to. flex-start
  // moves all of the overflow to the right, where scrolling reveals it.
  assert.ok(strip.includes('justify-content: flex-start'), 'the KPI strip must be left-aligned');
  assert.ok(!strip.includes('justify-content: center'), 'a centred strip strands its first group');
  // min-width:0 keeps the scroller from imposing its content width on the header
  // row, so the excess is scrolled inside the strip instead of widening the bar.
  assert.ok(strip.includes('min-width: 0'), 'the strip must be allowed to shrink below its content');
  assert.ok(strip.includes('overflow-x: auto'), 'the overflow must stay on the strip, not the document');
});

test('the PM Yard header bar spans the same inset as its side panels', async () => {
  const theme = await read('theme.css');
  // theme.css owns this header's box with !important (position/left/right), so a
  // page-level `left` can never align it. The panels and the header therefore all
  // resolve one shared token (--pm-hud-inset, owned by PM-Yard) rather than
  // repeating a literal — repeating it is exactly how they drifted apart before.
  // The rule body is bounded by the next PM Yard header rule rather than the next
  // `}`, so a comment inside the rule cannot truncate the slice.
  const start = theme.indexOf('.page-pm>header.app-header{');
  const pmHeader = theme.slice(start, theme.indexOf('.page-pm>header.app-header::before', start));
  assert.ok(start > -1, 'the PM Yard header box must be owned by the shared theme');
  assert.ok(pmHeader.includes('left:max(var(--pm-hud-inset),var(--safe-left))!important'), 'header left edge must track the HUD inset');
  assert.ok(pmHeader.includes('right:max(var(--pm-hud-inset),var(--safe-right))!important'), 'header right edge must track the HUD inset');

  // The responsive step must move the header with the panels, not restate a literal.
  const mobileHeader = theme.slice(
    theme.indexOf('.page-pm>header.app-header{', start + 1),
    theme.indexOf('}', theme.indexOf('.page-pm>header.app-header{', start + 1)),
  );
  assert.ok(mobileHeader.length, 'a responsive PM Yard header rule must exist');
  assert.ok(
    mobileHeader.includes('left:max(var(--pm-hud-inset),var(--safe-left))!important'),
    'the mobile header inset must track the HUD inset rather than a literal',
  );

  const pmYard = await read('PM-Yard.html');
  assert.match(pmYard, /--pm-hud-inset:\s*16px/, 'the HUD inset is defined once for desktop');
  assert.match(pmYard, /@media\s*\(max-width:\s*768px\)\s*\{\s*:root\s*\{\s*--pm-hud-inset:\s*12px;\s*\}\s*\}/, 'and steps down to 12px at <=768px');
  assert.ok(pmYard.includes('aside { left: var(--pm-hud-inset);'), 'the left panel must use the shared HUD inset');
  assert.ok(pmYard.includes('.inspector { right: var(--pm-hud-inset);'), 'the right panel must use the shared HUD inset');
  assert.doesNotMatch(pmYard, /aside \{ left: 16px;/, 'the panel inset must not be restated as a literal');
});

test('the PM Yard control tab strip keeps its panel card edge', async () => {
  const theme = await read('theme.css');
  // Only tab bars that sit flush at the top of their own card inherit the card's
  // top corners. PM Yard's .ctrl-tabs renders under a .dd-head band, so the
  // shared rounding drew a second, floating rounded box inside the panel.
  const start = theme.indexOf('.page-sms-daily .tab-bar,');
  const topRounded = theme.slice(start, theme.indexOf('}', start));
  assert.ok(!topRounded.includes('.ctrl-tabs'), 'the PM Yard control tab strip must not be rounded');
  assert.ok(
    topRounded.includes('border-radius:var(--component-radius) var(--component-radius) 0 0!important'),
    'the SMS tab bars still continue their card edge',
  );
});

test('header view tabs keep their hover highlight inside the pill', async () => {
  const theme = await read('theme.css');
  // The Daily/Monthly switcher is a pill inside a pill with 4px of padding, and
  // the shared hover lift (translateY(-2px) scale(1.03)) grew the tab 3% past
  // that slot so the highlight broke through the container's rounded edge. The
  // tabs keep the colour cue and drop the geometry change.
  const start = theme.indexOf('.app-header .view-tabs button:hover:not(:disabled){');
  assert.ok(start > -1, 'the contained tab hover rule must exist');
  const tabHover = theme.slice(start, theme.indexOf('}', start));
  assert.ok(tabHover.includes('transform:none!important'), 'hover must not scale the tab out of its slot');
  assert.ok(tabHover.includes('box-shadow:none!important'), 'hover must not bleed a shadow past the pill');
  // The colour hover cue itself has to survive the containment.
  const sharedHover = theme.slice(theme.indexOf('.app-header .view-tabs button:hover,'));
  assert.ok(sharedHover.slice(0, 400).includes('background:var(--input-hover)!important'), 'tabs keep their hover background cue');
});

test('the Rake KPI strip reserves the header height it actually needs', async () => {
  const rake = await read('Rake-Planner.html');
  // Between roughly 780 and 1100px the fixed header wraps to two rows (measured
  // 126-144px) and a hardcoded 100px spacer left the first KPI card row under the
  // bar. The spacer now consumes a measured clearance republished by a
  // ResizeObserver, so the strip always lands just below the bar.
  assert.ok(rake.includes('new ResizeObserver'), 'a ResizeObserver must watch the header shell');
  assert.ok(rake.includes('observer.observe(el)'), 'the observer must be attached to the measured shell');
  assert.ok(rake.includes("--rake-header-clearance',"), 'the observer must publish the measured clearance');
  assert.ok(
    rake.includes("height:mob?0:'var(--rake-header-clearance, 100px)',flexShrink:0}}/>"),
    'the KPI spacer height must come from the measured clearance',
  );
});

test('VDO keeps the Live EBTP status block left of the header buttons', async () => {
  const vdo = await read('VDO-Generator.html');
  // Order Status Report's header is the reference order: title, status block,
  // then the controls. The upload action moved into .hdr-r so the badge is no
  // longer stranded past the buttons.
  const badge = vdo.indexOf('class="file-badge" id="fileBadge"');
  const upload = vdo.indexOf('id="uploadBtn"');
  const hub = vdo.indexOf('id="hubFrameHeaderSlot"');
  assert.ok(badge > -1 && upload > -1 && hub > -1, 'header landmark elements must exist');
  assert.ok(badge < upload, 'the file badge must precede the header buttons');
  assert.ok(upload < hub, 'the upload button belongs to the same group as the hub controls');
  // Exactly one upload control and one file input may exist after the move.
  assert.equal(vdo.split('id="uploadBtn"').length - 1, 1, 'one upload button only');
  assert.equal(vdo.split('id="file"').length - 1, 1, 'one file input only');
  // The auto margin that used to push it to the end of .top-l must be gone, or
  // the centred mobile button group would be dragged apart.
  assert.ok(vdo.includes('margin-left:0;flex-shrink:0}'), 'the upload button must not claim a free-space margin');
});

test('the Order Status row count lives in the header status block', async () => {
  const osr = await read('Order-Status-Report.html');
  // The filtered/total count describes the loaded dataset, not a filter, so it
  // belongs with the fileName / EBTP-loaded group — on both headers.
  const rowCount = '{fmt(filtered.length,0)} / {fmt(rows.length,0)} rows';
  const at = [];
  let found = osr.indexOf(rowCount);
  while (found > -1) {
    at.push(found);
    found = osr.indexOf(rowCount, found + 1);
  }
  assert.equal(at.length, 2, 'the desktop and mobile header status blocks both render the row count');
  for (const index of at) {
    const before = osr.slice(Math.max(0, index - 400), index);
    assert.ok(before.includes('EBTP loaded:'), 'the row count must sit directly under the EBTP status line');
  }
  // ...and it must be gone from the filter bar it was squeezed into.
  const filterStart = osr.indexOf('DateTreeSelect label="SO Date"');
  const filterBar = osr.slice(filterStart, filterStart + 800);
  assert.ok(!filterBar.includes(rowCount), 'the filter bar no longer renders the row count');
});

test('Order Status table headers stay a flat band instead of popover cards', async () => {
  const osr = await read('Order-Status-Report.html');
  // theme.css's card-surface contract paints every .m3-popover as a 20px-rounded
  // card with a large drop shadow, with !important at specificity (0,3,1) —
  // :is() takes its most specific argument, so a plain `thead th .m3-popover`
  // override can never win. GlassTh/GlassTotalTd used that class as their
  // per-cell frost layer, which turned every sticky header cell into its own
  // rounded blob with a gap to its neighbour (and bled a card shadow over the
  // rows below). They now paint their own flat, square layer instead.
  assert.ok(osr.includes('.th-frost{'), 'the flat header frost layer must be defined');
  const frost = osr.slice(osr.indexOf('.th-frost{'), osr.indexOf('.th-frost{') + 220);
  assert.ok(frost.includes('border-radius:0'), 'the header frost layer must be square');
  assert.ok(frost.includes('backdrop-filter:blur(40px)'), 'the second blur layer must survive');
  // Header cells and frozen total cells both use it...
  assert.equal(osr.split('className="th-frost"').length - 1, 2, 'header and total cells both use the flat layer');
  // ...and .m3-popover is left to the one place that really is a popover.
  const cells = osr.slice(osr.indexOf('function GlassTh'), osr.indexOf('function KpiDrillPanel'));
  assert.ok(!cells.includes('m3-popover'), 'header/total cells must not paint the popover surface');
});
