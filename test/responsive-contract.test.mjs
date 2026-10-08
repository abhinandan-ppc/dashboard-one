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

test('the Plate header spans the same inset as its content on narrow screens', async () => {
  const [plate, theme] = await Promise.all([read('Plate-Tagging-Tool.html'), read('theme.css')]);

  // .wrap already applies the page gutter, and the header shell is nested
  // INSIDE it. Under 768px the shared theme flips .app-header-shell to
  // position:sticky, which puts the shell back in flow — so the shell's own
  // --header-shell-gutter padding became a second gutter and the header card
  // rendered 16px narrower than every content block below it (measured: header
  // left 32px vs slot left 16px at 390px). The page cancels that token so .wrap
  // is the single source of the inset.
  assert.match(
    plate,
    /\.page-plate \.header-fixed\{--header-shell-gutter:0px\}/,
    'Plate must cancel the header shell gutter while nested inside the gated .wrap',
  );
  // The token is the only lever available: the shared rule sets the padding with
  // !important, so a plain padding override would silently lose.
  assert.doesNotMatch(
    plate,
    /\.page-plate \.header-fixed\{[^}]*padding-left/,
    'Plate must override the gutter token, not the !important padding',
  );
  // The cancellation is scoped to the mobile step where the shell goes sticky;
  // on desktop the shell is position:fixed and its padding IS the page inset,
  // so it must be left alone.
  assert.match(
    plate,
    /@media\(max-width:768px\)\{\s*\.page-plate \.header-fixed\{--header-shell-gutter:0px\}\s*\}/,
    'the gutter cancellation must be scoped to the mobile step',
  );

  // Vertical rhythm: .step is display:none under 640px, so on phones the
  // header's only separation from the first card was the shell's 8px bottom
  // padding (measured 8px against 51px on desktop) and the two looked welded
  // together. One shared stack step restores the same rhythm.
  assert.match(
    plate,
    /\.header-fixed\{margin-bottom:var\(--space-stack\)!important\}/,
    'the mobile header must keep a stack step of breathing room below it',
  );
  // !important is required: the shared .app-header-shell rule sets
  // `margin:0 auto!important`, which would otherwise reset this to 0.
  assert.match(
    theme,
    /\.app-header-shell\{[\s\S]{0,400}?margin:0 auto!important/,
    'the shared shell rule is expected to reset margin (guards the !important above)',
  );
});

// Every page that nests its header shell inside the already-gated wrapper has the
// same double-inset defect, and each must cancel the shell's gutter token rather
// than its padding. Plate Tagging (measured 32 vs 16 at 390px), VDO Generator
// (measured 32 vs 16 at 320/390px, 40 vs 20 at 720/768px) and Order Status
// (measured 32 vs 16 at 390px) were all affected.
const nestedShellPages = [
  { file: 'Plate-Tagging-Tool.html', pageClass: 'page-plate', shellClass: 'header-fixed' },
  { file: 'VDO-Generator.html', pageClass: 'page-vdo', shellClass: 'top-wrapper' },
  { file: 'Order-Status-Report.html', pageClass: 'page-order', shellClass: 'app-header-shell' },
];

for (const { file, pageClass, shellClass } of nestedShellPages) {
  const selector = `.${pageClass} .${shellClass}`;

  test(`${file} cancels its nested header shell's duplicate gutter on narrow screens`, async () => {
    const html = await read(file);

    // .wrap applies the page gutter and the shell is nested INSIDE it, so under
    // 768px (where the shared theme makes the shell position:sticky and back in
    // flow) the shell's own --header-shell-gutter became a SECOND gutter and the
    // header card rendered narrower than every content block below it. Cancelling
    // the token lets .wrap be the single source of the inset.
    assert.match(
      html,
      new RegExp(`${selector.replace(/\./g, '\\.')}\\{--header-shell-gutter:0px\\}`),
      `${file} must cancel the header shell gutter while nested inside the gated .wrap`,
    );
    // The token is the only lever available: the shared rule sets padding-left and
    // padding-right with !important, so a plain padding override silently loses.
    assert.doesNotMatch(
      html,
      new RegExp(`${selector.replace(/\./g, '\\.')}\\{[^}]*padding-left`),
      `${file} must override the gutter token, not the !important padding`,
    );
    // Scoped to the mobile step only: on desktop the shell is position:fixed and
    // its padding IS the page inset, so it must be left alone.
    assert.match(
      html,
      new RegExp(
        `@media\\s*\\(max-width:768px\\)\\s*\\{\\s*${selector.replace(/\./g, '\\.')}\\{--header-shell-gutter:0px\\}\\s*\\}`,
      ),
      `${file} must scope the gutter cancellation to the mobile step`,
    );
  });
}

test('the Order Status mobile stack shares one spacing step from the header down', async () => {
  const osr = await read('Order-Status-Report.html');

  // Once the shell is sticky it sits IN flow, so the gap under the header bar is
  // whatever the shell and the first panel each contribute. That used to be an
  // 8px shell padding with a zeroed spacer and nothing else, against 18px
  // between the sections and 12px (--space-mobile) on the .glass-card ones —
  // three different rhythms on one page. The shell and every top-level section
  // now resolve to a single step.
  assert.match(
    osr,
    /\.page-order \.app-header-shell\{margin-bottom:var\(--osr-stack\)!important\}/,
    'the sticky header must keep a stack step of its own below it',
  );
  assert.match(
    osr,
    /\.osr-stack\{margin-bottom:var\(--osr-stack\)!important\}/,
    'every top-level section must resolve its mobile gap to the same step',
  );
  // The step itself must be a token, and it must be the one the page already
  // used for its cards — not a fourth value.
  assert.match(osr, /--osr-stack:14px/, 'the mobile step must be a single declared value');
  // !important is load-bearing, not stylistic: the shared shell rule sets
  // `margin:0 auto!important`, and the section margins are inline style props.
  const theme = await read('theme.css');
  assert.match(
    theme,
    /\.app-header-shell\{[\s\S]{0,400}?margin:0 auto!important/,
    'the shared shell rule is expected to reset margin (guards the !important above)',
  );

  // The clearance spacer is sized by CSS, not by the page's `mob` JS flag. The
  // two disagree between 640px and 768px: the theme flips the shell to sticky at
  // 768px, but mob only turns true below 640px — so an inline mob?0:100 spacer
  // stayed 100px tall under a header that was already back in flow, opening a
  // 100px hole above the first panel on every 640-768px screen.
  assert.doesNotMatch(
    osr,
    /height:mob\?0:100/,
    'the header spacer must be sized by CSS so it tracks the sticky breakpoint',
  );
  assert.match(osr, /className="header-spacer"/, 'the dashboard spacer must carry the shared spacer class');
  assert.match(
    osr,
    /\.page-order \.header-spacer\{height:100px\}/,
    'the desktop clearance must be declared in the stylesheet',
  );
  // The theme zeroes .app-header-shell + .header-spacer under 768px with
  // !important, which is what makes one declaration cover both sides of the flip.
  assert.match(
    theme,
    /\.app-header-shell\+\.header-spacer\{height:0!important\}/,
    'the theme must zero the spacer next to the sticky shell',
  );

  // Every top-level section is tagged, so none of them keeps its own 18px.
  // Split on the tag boundary so each chunk is one opening <div ...>: a section
  // that still sets marginBottom:18 without carrying the hook is exactly the
  // thing that would drift back to a second rhythm.
  const openTags = osr.split('<div').slice(1);
  const unhooked = openTags.filter(
    (tag) => tag.includes('marginBottom:18') && !tag.slice(0, tag.indexOf('>')).includes('osr-stack'),
  );
  assert.equal(
    unhooked.length,
    0,
    `every section setting marginBottom:18 must carry the osr-stack hook; found ${unhooked.length} unhooked`,
  );
  const hooked = osr.split('osr-stack').length - 1;
  assert.ok(hooked >= 10, `expected the osr-stack hook on every section, found ${hooked - 2} uses`);
});

test('the VDO Generator header gap tracks its own panel rhythm on mobile', async () => {
  const vdo = await read('VDO-Generator.html');

  // The header's old gap was a flat 32px while .panel uses 18px (14px under
  // 560px) — a third number that made the header read as a separate band. It now
  // resolves to exactly the panel step.
  assert.match(
    vdo,
    /@media\s*\(max-width:768px\)\s*\{\s*\.page-vdo \.top-wrapper\{margin-bottom:18px!important\}\s*\}/,
    'the mobile header gap must match the 18px panel step',
  );
  assert.match(
    vdo,
    /@media\s*\(max-width:560px\)\s*\{[\s\S]*?\.page-vdo \.top-wrapper\{margin-bottom:14px!important\}/,
    'the gap must step down to 14px alongside .panel',
  );
  // The !important is load-bearing and the browser proves it: the shared theme
  // sets the shell via the `margin:0 auto!important` shorthand, so a plain
  // margin-bottom here is overridden and the gap measures 0px. Assert the cause
  // too, so the pair can't drift apart.
  const theme = await read('theme.css');
  assert.match(
    theme,
    /\.app-header-shell\{[\s\S]{0,400}?margin:0 auto!important/,
    'the shared shell rule is expected to reset margin via shorthand (guards the !important above)',
  );
  assert.doesNotMatch(vdo, /margin-bottom:32px/, 'the ad-hoc 32px header gap must be gone');
  // The margin has to be anchored to 768px, not this page's 720px step: the
  // shared theme flips the shell to position:sticky at 768px, so across
  // 721-768px the header was already back in flow with no margin at all and the
  // gap silently disappeared.
  const mobile = mediaBlocks(vdo, '@media (max-width:768px)').join('\n');
  assert.match(mobile, /\.page-vdo \.top-wrapper\{margin-bottom:18px!important\}/, 'the gap must start at the sticky flip');
  const at720 = mediaBlocks(vdo, '@media (max-width:720px)').join('\n');
  assert.doesNotMatch(
    at720,
    /\.page-vdo \.top-wrapper\{[^}]*margin-bottom/,
    'the 720px block must not own a competing header margin',
  );
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

test('the Rake Planner header clearance is only written when it changes', async () => {
  // The desktop clearance ResizeObserver measures the header shell and publishes
  // the height as --rake-header-clearance, which sizes the spacer below it. An
  // unconditional write mutates layout from inside a ResizeObserver callback,
  // which can reschedule the observer indefinitely; an identical write is also
  // a no-op repaint that reads as the header refreshing itself. Guard on change.
  const rake = await read('Rake-Planner.html');
  const start = rake.indexOf('--rake-header-clearance');
  assert.ok(start > -1, 'the page must publish the header clearance at all');

  const guard = rake.indexOf("getPropertyValue('--rake-header-clearance')");
  assert.ok(guard > -1,
    'the clearance must be compared against its current value before writing');
  // The read must guard the write in the same callback, not appear later.
  assert.ok(guard < rake.indexOf("setProperty('--rake-header-clearance'", guard),
    'the change check must come BEFORE the write it protects');
  assert.ok(/height<=0\)\s*return/.test(rake),
    'a zero measurement must be ignored rather than collapsing the spacer');
});

// ── Performance contracts ──────────────────────────────────────────────────
// These are cheap, fast checks that keep the load-path wins from being undone.
// The numbers they defend came from measuring every page's first paint in a real
// browser (see the commit message); the slowest page, PM Yard, went from a
// 4112ms first paint to 716ms once its two render-blocking CDN scripts had their
// origin preconnected.

const PAGES_WITH_CDN_SCRIPTS = [
  // [page, origins the page loads a render-blocking script from]
  ['PM-Yard.html', ['https://cdnjs.cloudflare.com']],
  ['Plate-Tagging-Tool.html', ['https://cdnjs.cloudflare.com']],
  ['Order-Status-Report.html', ['https://unpkg.com', 'https://cdnjs.cloudflare.com']],
  ['Rake-Planner.html', ['https://unpkg.com', 'https://cdnjs.cloudflare.com']],
];

test('every render-blocking third-party script origin is preconnected', async () => {
  for (const [page, origins] of PAGES_WITH_CDN_SCRIPTS) {
    const src = await read(page);
    for (const origin of origins) {
      // The page must actually load a script from this origin...
      const host = new URL(origin).host;
      assert.ok(
        src.includes(`src="https://${host}/`),
        `${page} loads a script from ${host}, so it needs a preconnect`,
      );
      // ...and must open that connection earlier in the document than the script
      // it is warming up for. A preconnect placed after a render-blocking script
      // fires too late to help it, and that ordering is easy to reintroduce.
      const pre = src.indexOf(`rel="preconnect" href="${origin}`);
      const script = src.indexOf(`src="https://${host}/`);
      assert.ok(pre > -1, `${page} must preconnect to ${host}`);
      assert.ok(pre < script,
        `${page}: the ${host} preconnect must come before the script tag, not after it`);
    }
  }
});

test('no page loads a page-critical script from a third party without preconnect', async () => {
  // Guards the general case, not just the four pages above: any origin serving a
  // <script src> in <head> must be preconnected first, so a page added later
  // cannot quietly reintroduce a blocking handshake.
  for (const name of pages) {
    const src = await read(name);
    // Scan the whole document, not just <head>: several pages load their React
    // and Leaflet <script> tags in the body, and a preconnect above them in
    // <head> is still correct and still valuable.
    const origins = new Set();
    for (const m of src.matchAll(/<script\s+src="(https:\/\/[^/]+)\//g)) origins.add(m[1]);
    for (const origin of origins) {
      if (origin.includes('127.0.0.1') || origin.includes('localhost')) continue;
      const pre = src.indexOf(`rel="preconnect" href="${origin}`);
      const first = src.indexOf(`src="${origin}/`);
      assert.ok(pre > -1 && pre < first,
        `${name}: third-party origin ${origin} is used by a script but is not `
        + 'preconnected ahead of it, which puts a TCP+TLS round-trip on the critical path');
    }
  }
});

test('the reduced-transparency escape hatch exists but changes nothing by default', async () => {
  // backdrop-filter is the most expensive thing in the shared surface contract.
  // The opt-out has to be available on every page that draws glass, and — this is
  // the part that matters — it must be inert unless asked for, so no existing
  // visitor sees a design change.
  const theme = await read('theme.css');
  assert.match(theme, /html\[data-reduce-transparency="1"\]/,
    'the solid-surface fallback must be keyed off an explicit opt-in attribute');
  assert.match(theme, /html\[data-reduce-transparency="1"\][^{]*\{[^}]*backdrop-filter\s*:\s*none/,
    'the opt-out must actually drop the backdrop filter');
  // Inert by default: nothing may key the fallback off a selector that is
  // always true (html, *, body). It must require the explicit attribute.
  assert.doesNotMatch(theme, /^\s*html\s*\{[^}]*data-reduce-transparency/m,
    'the fallback must never apply without the opt-in attribute');

  // The preference has to be readable, and defaults to OFF when the OS has not
  // asked for reduced transparency and nothing is stored.
  const boot = await read('theme-boot.js');
  assert.match(boot, /jsplTransparency/,
    'theme-boot.js must expose the preference so pages can read and set it');
  assert.match(boot, /prefers-reduced-transparency/,
    'the OS-level signal must be honoured');
  assert.match(boot, /jspl-reduce-transparency/,
    'the choice must persist under a key shared with the hub');
  // "off" unless the OS asked for it or the visitor explicitly turned it on.
  assert.match(boot, /stored === "1"/,
    'an unset key must fall through to the OS signal, never default to on');
});

test('the hub honours the same reduced-transparency key as theme-boot.js', async () => {
  // index.html owns its own theme state and does not load theme-boot.js, so it
  // needs its own copy of the preference — and it has to use the SAME storage key,
  // or a visitor who turns it on would get it on some pages and not others.
  const hub = await read('index.html');
  assert.match(hub, /jspl-reduce-transparency/,
    'the hub must read/write the same key theme-boot.js uses');
  assert.match(hub, /window\.jsplTransparency/,
    'the hub must expose the same API shape as theme-boot.js');
  // The hub pushes the theme into the frame document; the preference rides along
  // so an embedded page matches the hub.
  assert.match(hub, /function applyThemeToDocument/);
  const fn = hub.slice(hub.indexOf('function applyThemeToDocument'));
  const end = fn.indexOf('\n}');
  assert.match(fn.slice(0, end), /data-reduce-transparency/,
    'the hub must mirror the transparency choice into the frame document');
});

test('no infinite animation moves a layout property inside a backdrop-filter panel', async () => {
  // The EBTP indeterminate bar used to animate `left`, which forces a layout
  // pass every frame. Because .fetch-status carries backdrop-filter:blur(20px),
  // each pass also re-sampled the blurred backdrop, so the page jittered for the
  // whole fetch — and the fetch is long, since it falls through nine proxy
  // strategies in turn. Animating a layout property from a keyframe is the
  // defect; the bar must move on transform instead. Covers every keyframe in
  // the shared sheet, not just loader-slide.
  const theme = await read('theme.css');
  // Match each @keyframes block by brace balance. A non-greedy `[\s\S]*?` to the
  // first newline-`}` over-captures whenever a keyframe body has no closing
  // brace on its own line, which would sweep in unrelated later rules and
  // report properties the animation never had.
  const keyframes = [];
  for (const m of theme.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    let depth = 1, i = m.index + m[0].length;
    while (i < theme.length && depth > 0) {
      if (theme[i] === '{') depth++;
      else if (theme[i] === '}') depth--;
      i++;
    }
    keyframes.push([m[1], theme.slice(m.index + m[0].length, i - 1)]);
  }
  assert.ok(keyframes.length, 'the shared sheet should still define keyframes');

  // Properties that force layout when animated. `left` is the one that was
  // actually wrong; the rest are here so the same class of bug cannot return
  // through a different property.
  const layoutProps = ['left', 'right', 'top', 'bottom', 'width', 'height',
    'margin', 'padding', 'font-size', 'line-height'];
  for (const [name, body] of keyframes) {
    for (const prop of layoutProps) {
      // Only the animated side of a declaration; a bare `left:` in a
      // from/to block is exactly the shape we are banning.
      assert.ok(
        !new RegExp(`(^|[;{\\s])${prop}\\s*:`).test(body),
        `@keyframes ${name} animates \`${prop}\`, which forces layout every frame; `
        + 'use transform/opacity instead',
      );
    }
  }

  // And the bar specifically must be transform-driven, so the fix cannot be
  // undone by simply removing the animation.
  const slide = keyframes.find(([n]) => n === 'loader-slide');
  assert.ok(slide, 'the indeterminate bar must keep its loader-slide keyframes');
  assert.match(slide[1], /transform\s*:\s*translateX/,
    'loader-slide must move the bar with translateX, not `left`');
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

test('the Rake KPI strip is as far from the content below as from the header', async () => {
  const rake = await read('Rake-Planner.html');

  // On desktop the fixed header is out of flow, so a spacer of
  // --rake-header-clearance stands in for it. That token already carries 12px of
  // breathing room (the ResizeObserver publishes shellHeight + 12), and the KPI
  // strip adds its own 12px top padding on top of it — so the gap above the
  // cards is 24px, and the bottom padding must match or the strip reads as
  // welded to the tables below it.
  assert.match(
    rake,
    /`\$\{Math\.round\(height\+12\)\}px`/,
    'the header clearance must keep its 12px of breathing room',
  );

  // The bottom value carries its own unit. Inside this template string React
  // serialises the value verbatim and does NOT append "px" the way it does for
  // a numeric style value, so a bare `12` made the whole padding declaration
  // invalid — the browser dropped it and the strip rendered with no padding at
  // all on mobile (measured: computed padding 0px, strip height == card height).
  assert.match(
    rake,
    /className="kpi-strip"[^}]*padding:`12px var\(--page-gutter\) \$\{mob\?'12px':'var\(--space-stack\)'\}`/,
    'the KPI strip bottom padding must match the effective gap above the cards, with an explicit unit',
  );

  // The strip is a full-width page band, so its horizontal inset has to come
  // from the same token as the tables below it. It used to branch on a 12/24
  // literal, which put the cards 8px outboard of every other block on phones
  // (24px here vs a 16px --page-gutter) — the same class of drift the gutter
  // contract exists to prevent. As the scroll container's end padding, the
  // token also keeps the last card off the edge when scrolled fully right.
  assert.doesNotMatch(
    rake,
    /padding:`12px \$\{mob\?12:24\}px/,
    'the KPI strip must not branch its page gutter on a literal',
  );
  // A sideways-scrolling strip needs the affordance that makes it read as
  // scrollable: no themed scrollbar bar under the cards, and a snap point per
  // card so a swipe rests on a whole number instead of slicing it.
  assert.match(rake, /\.page-rake \.kpi-strip\{scroll-snap-type:x proximity;scroll-padding-inline:var\(--page-gutter\)\}/);
  assert.match(rake, /\.page-rake \.kpi-strip>div\{scroll-snap-align:start\}/);
  assert.match(rake, /\.page-rake \.kpi-strip\{scrollbar-width:none/);
  assert.match(rake, /\.page-rake \.kpi-strip::\-webkit-scrollbar\{height:0/);

  // The strip takes its column gap from the shared .kpi-strip contract, so no
  // inline gap literal may creep back in (which would also leave wrapped rows
  // on a different axis spacing from columns).
  const strip = rake.slice(rake.indexOf('className="kpi-strip"'), rake.indexOf('<KCard'));
  assert.doesNotMatch(strip, /\bgap:\s*\d/, 'the strip must not restate its gap inline');
  assert.doesNotMatch(strip, /rowGap:/, 'a rowGap override would unbalance wrapped rows');
});

test('the SMS Daily KPI strip is balanced and on the shared rhythm', async () => {
  const daily = await read('SMS Heat Planner Daily.html');

  // The strip's top padding is the gap from the alert banner above it and its
  // bottom padding is the gap down to .main-container. Both are the same
  // stack step, so neither axis can drift on its own, and the horizontal inset
  // is the shared page gutter so the cards line up with everything below them.
  assert.match(
    daily,
    /\.kpi-strip\s*\{[^}]*padding:\s*var\(--space-stack\)\s+var\(--page-gutter\)/,
    'the Daily KPI strip must take both axes from the shared scale',
  );
  // A one-sided literal is what left it reading as welded to the tables below.
  assert.doesNotMatch(
    daily,
    /\.kpi-strip\s*\{[^}]*padding:\s*16px\s+24px/,
    'the strip must not restate an asymmetric top/bottom padding',
  );
  // --page-gutter already steps 24/20/16 per breakpoint, so a per-breakpoint
  // literal here pulled the cards outboard of every other block on small phones.
  for (const block of mediaBlocks(daily, '@media')) {
    assert.doesNotMatch(
      block,
      /\.kpi-strip\s*\{[^}]*padding/,
      'no breakpoint may restate the KPI strip padding',
    );
  }

  // .main-container gap-stacks its sections, so a margin on one of its children
  // adds a second, invisible rhythm (24+16=40px) that no other page has.
  assert.doesNotMatch(
    daily,
    /\.tabs-container\s*\{\s*margin-top/,
    'the tab strip must rely on .main-container gap for its separation',
  );
  assert.doesNotMatch(
    daily,
    /\.main-container\s*\{[^}]*margin:\s*0 auto 40px/,
    'the 40px footer outlier must sit on the shared rhythm',
  );
  assert.doesNotMatch(
    daily,
    /class="card" style="margin-bottom: 24px;"/,
    'tab pane children must not carry a per-child spacing literal',
  );
  assert.match(
    daily,
    /\.alert-banner\s*\{[^}]*margin:\s*var\(--space-section\) auto 0/,
    'the header clearance above the alert must come from the shared token',
  );

  // A tab pane is a block, not a flex stack, so it cannot take the shared
  // container gap. Its children carry the same step as a margin instead, and
  // that step has to drop with the container gap at the mobile breakpoint.
  assert.match(
    daily,
    /\.tab-pane > \* \+ \* \{ margin-top: var\(--space-stack\); \}/,
    'tab pane contents must sit on the desktop stack step',
  );
  assert.match(
    daily,
    /\.tab-pane > \* \+ \* \{ margin-top: var\(--space-stack-sm\); \}/,
    'tab pane contents must step down with the container gap on mobile',
  );
});

test('the SMS Monthly page does not stack margins on its gap-stacked columns', async () => {
  const monthly = await read('SMS Heat Planner Monthly.html');

  // .app-shell gap-stacks the KPI row and the main layout, so the row's own
  // margin-bottom used to add 4px on top of the 24px gap — 28px to a role that
  // is 24px everywhere else.
  assert.doesNotMatch(
    monthly,
    /\.kpi-row\s*\{[^}]*margin-bottom/,
    'the KPI row must rely on the .app-shell gap for its separation',
  );
  // .pm-grid is gap-stacked too, and the product-mix cards added another 16px,
  // so those cards sat 40px apart on both axes.
  assert.doesNotMatch(
    monthly,
    /\.pm-card\s*\{[^}]*margin-bottom:\s*(?!0\s*;)[1-9]\d*px/,
    'a product-mix card must not add a non-zero margin to the .pm-grid gap',
  );
  // At <=768px .main-layout is display:contents, which promotes #main-content to
  // a direct child of the gap-stacked shell, so its margin doubled the gap.
  assert.doesNotMatch(
    monthly,
    /#main-content\s*\{[^}]*margin-bottom/,
    'the content column must rely on the .app-shell gap for its separation',
  );
  // The sidebar's trailing 20px was off-rhythm dead space, and the button's
  // margin-top:8px turned a 16px group gap into 24px mid-list.
  assert.doesNotMatch(monthly, /\.controls-sidebar\s*\{[^}]*padding-bottom/, 'the sidebar must not add an off-rhythm trailing inset');
  assert.doesNotMatch(monthly, /\.btn-pu\s*\{[^}]*margin-top/, 'the action button must rely on its group gap');

  // The wrapped sidebar basis has to account for the gap it sits in, or the row
  // does not fill: two items plus one --space-stack gap must equal 100%.
  assert.match(
    monthly,
    /flex:\s*1 1 calc\(50% - var\(--space-stack\) \/ 2\)/,
    'the sidebar wrap basis must be derived from the shared gap',
  );
  assert.doesNotMatch(monthly, /calc\(50% - 16px\)/, 'the wrap basis must not assume a 16px gap');

  // Shell padding: clear the header, gutter the sides, one stack step below.
  assert.match(
    monthly,
    /\.app-shell\s*\{[^}]*padding:\s*var\(--space-section\)\s+var\(--page-gutter\)\s+var\(--space-stack\)/,
    'the shell must take its padding from the shared scale',
  );
  // .alert sat above a box with a 24px bottom inset, so 20px read as a seam.
  assert.doesNotMatch(monthly, /\.alert\s*\{[^}]*margin-bottom:\s*20px/, 'the alert must sit on the stack step like its sibling');
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

test('every Rake overlay stacks above the shared sticky header', async () => {
  const theme = await read('theme.css');
  const rake = await read('Rake-Planner.html');

  // The shared theme pins the header shell to 320 !important, and on mobile
  // that shell is position:sticky — so on narrow screens it is a plain sibling
  // of the page's own overlays in one stacking context. Any overlay numbered
  // below 320 therefore paints UNDER the header bar. That is what put the bar
  // across the top of the open filter drawer (it was 200/201), leaving the
  // drawer's own header and close button unreachable, and did the same to the
  // rake map dialog (300).
  const headerZ = Number(theme.match(/\.app-header-shell\{[^}]*z-index:(\d+)!important/)?.[1]);
  assert.equal(headerZ, 320, 'the shared header shell z-index moved; re-derive the overlay floors below');

  // (scrim, drawer) — the drawer must also clear the scrim it is dismissed by.
  assert.match(rake, /setSideOpen\(false\)\}\s*style=\{\{[^}]*zIndex:340/s, 'the drawer scrim must clear the header');
  assert.match(rake, /className="app-side-drawer" style=\{\{[^}]*zIndex:341/s, 'the drawer must clear both the header and its scrim');

  // Every full-screen overlay the page can raise must clear the header too.
  // Bottom-anchored layers (fetch-status at 250, the combine-selection bar) are
  // excluded: they sit at the bottom of the viewport and can never overlap the
  // top header, so numbering them below 320 is harmless.
  const overlays = [...rake.matchAll(/position:'fixed',inset:0,zIndex:(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(overlays.length >= 4, `expected the full-screen dialogs, found ${overlays.length}`);
  for (const z of overlays) {
    assert.ok(z > headerZ, `full-screen overlay at z-index ${z} would paint under the header bar (${headerZ})`);
  }

  // A drill-down panel is opened from INSIDE the map dialogs, so it has to
  // paint above every full-screen overlay on the page — not just one of them.
  // Asserting against the max is what caught the rake map (520) and the
  // overview map (600) disagreeing, which a single hardcoded number missed.
  const drillPanels = [...rake.matchAll(/position:'fixed',bottom:0,left:0,right:0,zIndex:(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(drillPanels.length === 2, `expected both drill panels, found ${drillPanels.length}`);
  for (const d of drillPanels) {
    assert.ok(d > Math.max(...overlays), `drill panel at ${d} must paint above every dialog (max ${Math.max(...overlays)})`);
  }

  // And the drawer must stay below those panels so it can never bury a dialog.
  assert.ok(341 < Math.min(...drillPanels), 'the filter drawer must not cover an open drill panel');
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

// The Grade Clubbing intro reads as one box. It has now regressed three
// times, always the same way: an `!important` in the shared surface contract
// re-decorated a pane that the page had flattened, so the outer corners were
// cut twice. The third regression was subtler -- the flatten rule existed and
// carried `!important`, but at (0,3,0) while the contract sits at (0,3,1), so
// it lost on specificity and the panes came back rounded anyway.
//
// These assertions therefore pin the SELECTORS, not just the presence of a
// zero radius: a bare `.page-grade .hero>.panel` reads as correct and is not.
test('the Grade Clubbing intro is one container with a single divider', async () => {
  const theme = await read('theme.css');
  const grade = await read('Grade-Clubbing-Matrix.html');

  // The shared contract resolves to (0,3,1):
  //   body:is(.page-grade,...)      -> (0,1,1)
  //   :is(.panel:not(.app-header))  -> (0,2,0)
  // The flatten rule must clear that. `body.` plus `:not(.app-header)` takes
  // it to (0,4,1) and it wins outright.
  assert.match(
    theme,
    /body\.page-grade \.hero>\.panel:not\(.app-header\)\{[^}]*border-radius:0!important/,
    'shared theme must flatten Grade Clubbing hero panes at a specificity that outranks the surface contract',
  );
  assert.doesNotMatch(
    theme,
    /(?<!:not\(.app-header\))\.page-grade \.hero>\.panel\{/,
    'the flatten rule must not drop the :not(.app-header) bump, or the contract wins on specificity',
  );
  // The flattening rule above legitimately carries a zero radius, so this
  // only rejects a rule that re-rounds a pane with a NON-zero radius.
  assert.doesNotMatch(
    theme,
    /\.page-grade \.hero>[^{,]*\{[^}]*border-radius:(?!0!important)[^;}]*!important/,
    'no shared rule may re-round an individual Grade Clubbing hero pane',
  );

  assert.match(
    grade,
    /\.page-grade \.hero \{[^}]*overflow: hidden/,
    'the hero must clip its own corners',
  );
  assert.match(
    grade,
    /\.page-grade \.hero > \.panel \{[^}]*border-radius: 0/,
    'hero panes must not carry their own radius',
  );
  // The seam rides a pseudo-element. As a background on the pane it sat at
  // (0,3,0) against the contract's (0,3,1) !important background and was
  // discarded, so the divider silently never rendered.
  assert.match(
    grade,
    /\.page-grade \.hero > \.stats\.cad-panel::before \{[^}]*linear-gradient\(180deg/,
    'the seam between the panes must be an immune pseudo-element, not a pane background',
  );
  assert.match(
    grade,
    /\.page-grade \.hero > \.stats\.cad-panel \{[^}]*position: relative/,
    'the seam pseudo-element needs a positioned ancestor',
  );
  // Stacked layout must rotate the same pseudo-element, not reintroduce a
  // competing background on the pane.
  const stacked = mediaBlocks(grade, '@media (max-width: 1100px)').join('\n');
  assert.match(
    stacked,
    /\.page-grade \.hero > \.stats\.cad-panel::before \{[^}]*linear-gradient\(90deg/,
    'the stacked seam must rotate to horizontal on the same pseudo-element',
  );

  // The page must not reintroduce a per-pane box with !important, which
  // would outrank the shared contract in either direction.
  assert.doesNotMatch(
    grade,
    /\.hero-copy[^{]*\{[^}]*!important/,
    'hero panes must not use !important to fight the shared surface contract',
  );
  // The legacy rule that rounded the seam-side corners outright.
  assert.doesNotMatch(
    grade,
    /\.stats\.cad-panel \{[^}]*border-radius/,
    'no unscoped per-pane radius may return',
  );
});

// The Admin page's gap under the header and its gaps between blocks must be
// the same value. This regressed because the page set a flat 108px spacer while
// theme.css pinned that same element to 88px with !important, so the page's
// number never applied and the real gap drifted to ~12px against 18-24px between
// blocks. These assertions pin the shared token and the runtime measurement so
// the two cannot silently diverge again.
test('the Admin page header clearance matches its container spacing', async () => {
  const admin = await read('admin.html');
  const theme = await read('theme.css');

  // The rhythm derives from the shared tokens rather than being redeclared.
  assert.match(admin, /--admin-block-gap:\s*var\(--space-stack\)/);
  assert.match(admin, /--admin-list-gap:\s*var\(--space-section\)/);

  // Every top-level block reads that one token. A hardcoded px margin here is
  // exactly what let the two tiers drift apart in the first place.
  for (const selector of ['.banner', '.panel', '.stat-row']) {
    assert.match(
      admin,
      new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]*margin-bottom:\\s*var\\(--admin-block-gap\\)`),
      `${selector} must separate blocks with --admin-block-gap`,
    );
  }
  assert.match(admin, /\.users\s*\{[^}]*gap:\s*var\(--admin-list-gap\)/);

  // The gap under the header IS the block gap, measured rather than guessed.
  assert.match(
    admin,
    /getBoundingClientRect\(\)\.height\)\s*\+\s*gap\(\)/,
    'the header spacer must be the measured bar height plus the block gap',
  );
  assert.match(
    admin,
    /ResizeObserver[\s\S]*?schedule/,
    'the spacer must react to the bar changing height as its contents wrap',
  );
  // theme.css zeroes the spacer under 768px because the shell is sticky and
  // occupies flow space; the page must hand control back at that width.
  assert.match(theme, /\.app-header-shell\+\.header-spacer\{height:0!important\}/);
  assert.match(admin, /desktop\.matches/);

  // The small-screen step moves the token rather than re-hardcoding a value.
  assert.doesNotMatch(
    admin,
    /\.panel\s*\{[^}]*margin-bottom:\s*\d+px/,
    'small-screen spacing must step the token rather than re-hardcode a pixel value',
  );
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

// ── Theme: the hub is the single source of truth, and it reaches every page ──
// The hub's 44px tap-target rule must keep excluding range inputs — that
// exclusion is what lets the theme panel use compact sliders instead of the
// buttons that had to be re-pinned with !important overrides.
function css_rangeExcluded(css) {
  return /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\)/.test(css);
}

test('the theme panel is driven by range sliders, not a tap-target-stretched button', async () => {
  const hub = await read('index.html');
  // The controls used to be <button>s, which theme.css's
  // `.page-hub button{min-height:44px!important}` stretched into broken pills
  // that then had to be re-pinned with !important overrides. theme.css's rule
  // explicitly excludes [type=range], so range inputs are the fix rather than
  // another pile of !important re-pinning.
  assert.ok(css_rangeExcluded(await read('theme.css')), 'theme.css must still exclude range inputs from the tap-target rule');
  for (const id of ['themeDarkness', 'accentHue', 'accentSat', 'accentLight']) {
    assert.ok(hub.includes(`id="${id}"`), `the panel must offer the ${id} slider`);
    assert.ok(new RegExp(`id="${id}"[\\s\\S]{0,120}type="range"|type="range"[\\s\\S]{0,120}id="${id}"`).test(hub),
      `${id} must be a range input`);
  }
  // One slider per dimension, and each writes a distinct custom property.
  assert.ok(/--theme-d/.test(hub) && /--ah/.test(hub) && /--as/.test(hub) && /--al/.test(hub),
    'the hub must write the four continuous custom properties');
  // Keyboard support (arrows, Home/End) is the platform's job for a range
  // input, so the control must not have taken that away by making the track
  // a non-focusable element.
  assert.ok(!/tabindex="-1"/.test(hub.slice(hub.indexOf('id="themeDarkness"'), hub.indexOf('id="accentHue"'))),
    'the sliders must stay keyboard-focusable');
});

test('every theme token is blended from the continuous slider, not a static pair', async () => {
  const css = await read('theme.css');
  // The whole point of the slider: a theme at 50 must be a genuine blend, not
  // a snap to whichever of two static blocks fell on the other side. Every
  // surface/text token has to be a color-mix against --td.
  assert.ok(css.includes('--theme-d: 100'), 'the ramp must have a default position');
  // --tds is the steepened ramp the surfaces actually use. Its exact numbers
  // are pinned by scripts/theme-contrast-check.mjs, which searches them for
  // the best worst-case body contrast; this only asserts the shape.
  assert.ok(/--tds:\s*clamp\(0%,\s*calc\(var\(--theme-d\)[^;]*?\),\s*100%\)/.test(css),
    'the surface ramp must be a clamped, steepened function of the slider');
  assert.ok(/--td:\s*var\(--tds\)/.test(css), 'the color-mix percentage must come from the steepened ramp');
  for (const token of ['--bg', '--bdr', '--glass', '--s0']) {
    const line = css.split('\n').find(l => l.trim().startsWith(token + ':'));
    assert.ok(line, `theme.css must still define ${token}`);
    assert.ok(/color-mix\(in srgb/.test(line), `${token} must be a color-mix, not a static value`);
    assert.ok(line.includes('var(--td)'), `${token} must be blended against the slider position`);
  }
  // The text roles must NOT ramp. Cross-fading --bg and --text together lands
  // both on the same mid luminance halfway along, and the text disappears into
  // the background — which is exactly what rendering at darkness 50 showed.
  for (const token of ['--text', '--text-hi', '--dim', '--mute']) {
    const decl = css.slice(css.indexOf(token + ':'), css.indexOf(';', css.indexOf(token + ':')));
    assert.ok(!/color-mix/.test(decl), `${token} must step, not ramp — a cross-fade loses contrast at the midpoint`);
  }
  // Both sides of the step have to exist, and they have to be the extremes:
  // off-black and off-white leave no window where both clear 4.5:1 against a
  // mid-grey surface, which caps the ramp at 4.28:1.
  assert.ok(/\[data-theme="light"\]\{[^}]*--text:#000000/s.test(css), 'light text must be pure black');
  assert.ok(/--text:#ffffff/.test(css), 'dark text must be pure white');
  // The accent is a colour, not a name — so --primary must derive from the HSL
  // inputs rather than a fixed literal. Its declaration wraps over two lines,
  // so read the whole declaration, not just its first line.
  const primary = css.slice(css.indexOf('--primary:'), css.indexOf(';', css.indexOf('--primary:')));
  assert.ok(/hsl\(var\(--ah\)/.test(primary), '--primary must derive from the hue/sat/lightness inputs');
  assert.ok(/var\(--td\)/.test(primary), '--primary must be blended against the slider position');
  // No per-accent or per-theme override blocks may creep back in: each would
  // be a value the slider cannot reach.
  assert.ok(!/\[data-accent=/.test(css), 'there must be no per-accent blocks — the accent is continuous now');
  assert.ok(!/\[data-theme="contrast"\]/.test(css), 'the contrast preset is gone; the ramp replaces it');
  // The derived attribute is the contract the pages still branch on, so it
  // must be exactly light or dark and nothing else.
  assert.ok(/\[data-theme="light"\]\{[^}]*color-scheme:light/s.test(css), 'color-scheme must still follow the derived theme');
  assert.ok(/\[data-theme="dark"\]\{ color-scheme:dark; \}/.test(css), 'color-scheme must still follow the derived theme');
});

test('the hub maps every stored value forward instead of reverting an old one', async () => {
  const hub = await read('index.html');
  const boot = await read('theme-boot.js');
  for (const src of [hub, boot]) {
    assert.ok(src.includes('LEGACY_THEME_VALUES'), 'a stored theme NAME from an older build must be mapped');
    assert.ok(/light:\s*0/.test(src) && /dark:\s*100/.test(src), 'light/dark names must map to the ramp ends');
    assert.ok(src.includes('LEGACY_ACCENTS'), 'a named accent from an older build must be mapped');
  }
  // An unreadable value must fall back, never land mid-ramp as NaN.
  for (const src of [hub, boot]) {
    assert.ok(/isFinite/.test(src), 'stored values must be validated before they reach the slider');
  }
});

test('the hub pushes theme and accent to every page over all three channels', async () => {
  const hub = await read('index.html');
  // postMessage carries the theme AND the accent together, as one continuous
  // payload, plus a legacy named message alongside it.
  assert.ok(hub.includes('type: "theme-vars"'), 'the continuous theme payload must be pushed to pages');
  assert.ok(/type: "theme-vars", darkness: currentDarkness, accent: currentAccent/.test(hub),
    'the pushed payload must carry both the darkness and the accent');
  assert.ok(hub.includes('type: "theme"'), 'theme must be pushed to pages');
  // A `storage` listener is the only way to see a change made in another tab.
  assert.ok(hub.includes("addEventListener('storage'"), 'the hub must listen for cross-tab storage changes');
  // The frame load path must go through the shared push (it previously sent
  // theme only, and read the raw localStorage key rather than the live value).
  const load = hub.slice(hub.indexOf('function handleFrameLoad'), hub.indexOf("pageFrame.addEventListener('load'"));
  assert.ok(load.includes('pushThemeToPages()'), 'frame load must push the full theme, not just data-theme');
  assert.ok(!load.includes('jspl-hub-theme'), 'frame load must not re-read the raw storage key');
});

test('a page that changes its own theme pushes it back to the hub', async () => {
  const hub = await read('index.html');
  // Without this the hub's switch can read "dark" while the open dashboard is
  // light, and the next page opened flips back to the hub's stale value.
  const msg = hub.slice(hub.indexOf("window.addEventListener('message'"), hub.indexOf("addEventListener('storage'"));
  assert.ok(/e\.data\.type === 'theme'/.test(msg), 'the hub must accept a theme message from a page');
  assert.ok(/e\.source === pageFrame\.contentWindow/.test(msg), 'that message must be scoped to the embedded frame');
  assert.ok(msg.includes('setTheme('), 'the hub must adopt the page-sent theme');
});

test('logging out forgets the stored theme and accent', async () => {
  const hub = await read('index.html');
  // Persistence is per device, so it must be cleared on logout or a shared
  // machine hands the previous user's theme to the next person.
  assert.ok(hub.includes('function clearStoredTheme'), 'a theme-clearing helper must exist');
  const clear = hub.slice(hub.indexOf('function clearStoredTheme'), hub.indexOf('function bindLogoutThemeReset'));
  assert.ok(clear.includes('removeItem(THEME_KEY)'), 'the theme key must be removed');
  assert.ok(clear.includes('removeItem(ACCENT_KEY)'), 'the accent key must be removed');
  // Bound to submit so it also runs when the logout request itself fails.
  assert.ok(hub.includes('indexOf("/api/auth/logout")'), 'clearing must be bound to the logout form');
});

test('every page boots on the hub theme and accent before it first paints', async () => {
  const boot = await read('theme-boot.js');
  assert.ok(boot.includes('jspl-hub-theme') && boot.includes('jspl-hub-accent'),
    'the boot script must read both stored preferences');
  assert.ok(boot.includes('addEventListener("message"'), 'the boot script must accept a live push');
  assert.ok(boot.includes('addEventListener("storage"'), 'the boot script must react to other tabs');
  for (const page of pages) {
    if (page === 'index.html') continue;
    const src = await read(page);
    assert.ok(src.includes('theme-boot.js'), `${page} must load theme-boot.js`);
    // Loaded in <head> before the body renders, so the attributes are set on
    // <html> before first paint rather than flipping a frame later.
    const at = src.indexOf('theme-boot.js');
    assert.ok(at < src.indexOf('</head>'), `${page} must load theme-boot.js in <head>`);
  }
});

test('the darkness ramp keeps body text above the WCAG AA floor at every position', async () => {
  // The ramp is not just "does it look right at the two ends". Rendering at
  // darkness 50 produced light grey text on a mid grey page, because a
  // cross-fade drives --bg and --text onto the same luminance halfway along.
  //
  // This runs the real search rather than a hand-written expectation, so the
  // slope/offset/threshold baked into theme.css and the script cannot drift
  // apart: the script prints the best configuration it can find, and this
  // asserts the shipped one is that one and clears 4.5:1.
  const { execFileSync } = await import('node:child_process');
  let out = '';
  try {
    out = execFileSync(process.execPath, ['scripts/theme-contrast-check.mjs'], { encoding: 'utf8' });
  } catch (e) {
    // The check exits non-zero when it cannot clear the floor; surface its
    // reasoning rather than a bare failure.
    const report = (e.stdout || '') + (e.stderr || '');
    assert.fail('the darkness ramp fails the contrast floor:\n' + report.trim());
  }
  const m = out.match(/best ramp: --tds: (.+)/);
  assert.ok(m, 'the check must report the ramp it recommends');
  const recommended = m[1].trim();
  const t = out.match(/DARK_THRESHOLD = (\d+)/);
  assert.ok(t, 'the check must report the threshold it recommends');

  const css = await read('theme.css');
  // The whole clamp(...) expression, not just up to the first closing paren —
  // the inner calc() closes before the outer clamp does.
  const shipped = css.match(/--tds:\s*(clamp\(0%,\s*calc\(var\(--theme-d\)[^;]*?\),\s*100%\))/);
  assert.ok(shipped, 'theme.css must declare the steepened ramp');
  // Compared as normalised text, not as parsed numbers: the script already
  // prints the exact CSS form, so this pins theme.css to the searched optimum.
  const norm = s => s.replace(/\s+/g, ' ').replace(/\s*([%*()])\s*/g, '$1').trim();
  assert.equal(norm(shipped[1]), norm(recommended),
    'theme.css must ship exactly the ramp the contrast search recommends');

  for (const [name, src] of [['theme-boot.js', await read('theme-boot.js')], ['index.html', await read('index.html')]]) {
    const th = src.match(/DARK_THRESHOLD\s*=\s*(\d+)/);
    assert.ok(th, `${name} must declare DARK_THRESHOLD`);
    assert.equal(Number(th[1]), Number(t[1]), `${name} and the contrast check must agree on DARK_THRESHOLD`);
  }
  assert.ok(/OK: body text stays at or above 4\.5:1/.test(out),
    'the shipped ramp must clear 4.5:1 across its whole range');
});

test('the derived data-theme is always light or dark, never a third value', async () => {
  // The ramp is continuous, but twelve pages still branch on data-theme, so the
  // hub has to reduce it to the one contract they all understand. If a third
  // value ever escaped that reduction, every one of those pages would fall
  // through its own `=== 'light' ? ... : 'dark'` and repaint dark, which is the
  // exact silent desync the hub's single-source-of-truth design prevents.
  const hub = await read('index.html');
  const boot = await read('theme-boot.js');
  for (const [name, src] of [['index.html', hub], ['theme-boot.js', boot]]) {
    const derived = src.match(/d\s*<\s*DARK_THRESHOLD\s*\?\s*["']light["']\s*:\s*["']dark["']/);
    assert.ok(derived, `${name} must derive data-theme from DARK_THRESHOLD`);
    // Nothing may write a raw theme name onto the attribute any more.
    for (const w of src.matchAll(/setAttribute\(\s*["']data-theme["']\s*,\s*([^)]+)\)/g)) {
      assert.ok(!/contrast/.test(w[1]), `${name} must not write "contrast" onto data-theme`);
    }
  }
});

test('no page reads or writes the shared theme key directly', async () => {
  // The invariant that keeps every page in sync. The shared store is a
  // continuous darkness (0..100), and each page used to keep its own copy of
  // "apply the theme and remember it". Every one of those copies read the
  // stored value, failed to match it against a 'light'/'dark' name, fell back
  // to dark, and wrote 'dark' back — so opening ONE page standalone reset the
  // theme for all of them. jsplTheme (theme-boot.js) is the only thing allowed
  // to touch the key.
  const boot = await read('theme-boot.js');
  assert.ok(/window\.jsplTheme\s*=/.test(boot), 'theme-boot.js must expose the jsplTheme API');
  for (const fn of ['read', 'normalize', 'derived', 'apply', 'set']) {
    assert.ok(boot.includes(`${fn}:`), `jsplTheme must expose ${fn}()`);
  }

  for (const page of pages) {
    if (page === 'index.html') continue; // the hub owns the key
    const src = await read(page);
    for (const m of src.matchAll(/localStorage\.(?:get|set)Item\(\s*['"]jspl-hub-theme['"]/g)) {
      assert.fail(`${page} touches jspl-hub-theme directly (${m[0]}) — use jsplTheme instead`);
    }
    // A page must not narrow the value by matching it against names either.
    assert.ok(!/===\s*['"]light['"]\s*\?\s*['"]light['"]\s*:\s*['"]dark['"]/.test(src),
      `${page} narrows the theme with a light/dark ternary, which discards the ramp`);
  }
  // And the two pages with their own theme managers must go through it.
  for (const page of ['Rake-Planner.html', 'Order-Status-Report.html']) {
    const src = await read(page);
    assert.ok(src.includes('jsplTheme'), `${page} must route its theme through jsplTheme`);
  }
});

test('the pages with their own theme managers let the boot script drive them', async () => {
  // Rake Planner and Order Status Report re-assert their own React state right
  // after mount, which would stomp the attribute theme-boot.js just set. They
  // opt in so their state settles on the hub's theme instead.
  for (const page of ['Rake-Planner.html', 'Order-Status-Report.html']) {
    const src = await read(page);
    assert.ok(src.includes('__hub_apply_theme'), `${page} must expose __hub_apply_theme to theme-boot.js`);
  }
});

test('the hub re-pushes the theme a bounded number of times, not forever', async () => {
  const hub = await read('index.html');
  // pushThemeToPages() used to end in `setTimeout(pushThemeToPages, 400)` on
  // every pass, which re-armed itself unconditionally: the hub posted
  // {theme-vars} + {theme} to the page every 400ms for the whole session. Every
  // page that paints its canvas from those messages therefore repainted
  // continuously, and on the pages that remount on a theme message the entire
  // React tree was rebuilt several times a second — the "page keeps refreshing
  // and the contents flicker" symptom. A push is an event, so the retry chain
  // must terminate.
  assert.ok(/var\s+THEME_PUSH_RETRIES\s*=/.test(hub), 'the retry budget must be a named, finite constant');
  assert.ok(/var\s+THEME_PUSH_RETRY_MS\s*=/.test(hub), 'the retry interval must be a named constant');

  // The re-arm must be conditional on budget remaining, and must pass the
  // decremented count down rather than restarting from the top.
  assert.ok(/if\s*\(\s*left\s*<=\s*0\s*\)\s*return;/.test(hub),
    'pushThemeToPages must stop once its retry budget is spent, or the chain never ends');
  assert.ok(/pushThemeToPages\(\s*left\s*-\s*1\s*\)/.test(hub),
    'the retry must consume one unit of budget, not restart the chain at full length');
  // And it must never schedule itself with no argument again — that is the
  // exact shape of the original unbounded loop.
  assert.ok(!/setTimeout\(\s*pushThemeToPages\s*,/.test(hub),
    'pushThemeToPages must not re-arm itself unconditionally (that was the unbounded poll)');
});

test('a page only remounts for a theme message that actually changes the canvas', async () => {
  // These two pages bump a `key` on their app root so the module-level canvas
  // palette (C) is re-read during render. That key makes React discard and
  // rebuild the ENTIRE subtree, so bumping it for a message that resolves to the
  // palette already on screen is a full teardown/rebuild that reads as the page
  // refreshing. Both pages receive a redundant push for a single user action
  // anyway: __hub_handle_theme calls setPref AND jsplTheme.apply(), and apply()
  // invokes __hub_apply_theme as its callback.
  for (const page of ['Rake-Planner.html', 'Order-Status-Report.html']) {
    const src = await read(page);
    // The applied darkness must be remembered and compared before doing work.
    assert.ok(/lastCanvasDark\s*=\s*useRef\(/.test(src),
      `${page} must remember the last applied darkness so a no-op push can be skipped`);
    assert.ok(/if\s*\(\s*lastCanvasDark\.current\s*===\s*d\s*\)\s*return;/.test(src),
      `${page} must skip the remount when the resolved darkness has not changed`);
    // The bump must happen inside the guarded setter, and nowhere else. Ordering
    // matters: the guard has to come BEFORE the key bump, otherwise the skip is
    // useless. Checking "no direct bump" alone would also reject the guarded
    // setter itself, so the function body is compared positionally instead.
    const start = src.indexOf('const applyCanvasDarkness');
    assert.ok(start > -1, `${page} must funnel its remount through applyCanvasDarkness`);
    const body = src.slice(start, src.indexOf('},[]);', start));
    const guardAt = body.indexOf('lastCanvasDark.current===d');
    const bumpAt = body.indexOf('setThemeKey(');
    assert.ok(guardAt > -1, `${page}: applyCanvasDarkness must compare the applied darkness`);
    assert.ok(bumpAt > guardAt,
      `${page}: applyCanvasDarkness must return on a no-op BEFORE bumping the remount key`);

    // Exactly one call site, so no other path can remount behind the guard's back.
    const bumps = src.match(/setThemeKey\(\s*k\s*=>\s*k\s*\+\s*1\s*\)/g) || [];
    assert.equal(bumps.length, 1,
      `${page} must bump the remount key from exactly one place, the guarded setter`);
  }
});

test('the pages that remount on a theme push actually declare the state they bump', async () => {
  // Order-Status-Report called setThemeKey from __hub_apply_theme without ever
  // declaring it anywhere in the file, so every hub theme push threw a
  // ReferenceError. theme-boot.js wraps its callback in try/catch, so it failed
  // silently and the page's canvas simply never repainted. A declared-but-unused
  // or undeclared setter is invisible to every other check here, so assert the
  // binding exists and is initialised.
  for (const page of ['Rake-Planner.html', 'Order-Status-Report.html']) {
    const src = await read(page);
    if (src.includes('setThemeKey')) {
      assert.ok(/const\s*\[\s*themeKey\s*,\s*setThemeKey\s*\]\s*=\s*useState\(/.test(src),
        `${page} calls setThemeKey, so it must declare that state — otherwise every `
        + 'theme push throws a ReferenceError that theme-boot.js silently swallows');
    }
  }
});

test('the SMS planner no longer overrides the hub theme on load', async () => {
  const sms = await read('SMS-Heat-Planner.html');
  // This page kept its own smsPlannerTheme key and applied it unconditionally
  // at the end of its script, so it always reverted to its own default and
  // ignored the hub — the one page that visibly refused the chosen theme.
  assert.ok(!/setTheme\(localStorage\.getItem\('smsPlannerTheme'\) \|\| 'dark'\);/.test(sms),
    'the page must not unconditionally re-apply its legacy key at load');
  // The hub key is no longer read directly here: reading it by hand is exactly
  // what broke, because the value is a continuous number and matching it
  // against 'light'/'dark' silently fell back to dark. It now goes through
  // jsplTheme, which owns the format.
  assert.ok(/window\.jsplTheme\.normalize\(window\.jsplTheme\.read\(\)\)/.test(sms),
    'it must adopt the hub theme through jsplTheme, not by matching the raw key');
  assert.ok(!/localStorage\.getItem\('jspl-hub-theme'\)/.test(sms),
    'this page must not read the shared key directly');
});
