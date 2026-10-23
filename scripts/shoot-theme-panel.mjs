// Renders the hub's theme panel in a real browser and screenshots it, so the
// control's spacing, sizing and swatch colours can be checked rather than
// reasoned about. The panel is normally gated behind auth + middleware, so
// this serves the page over a throwaway static server and drives the real
// markup/CSS in a real cascade — the only reliable way to catch a shared-rule
// override like theme.css's
// `body:is(...) button:not(.app-header button)` repainting every swatch grey.
//
// Usage (writes theme-panel.png in the repo root):
//   node scripts/shoot-theme-panel.mjs
//   THEME=light WIDTH=320 node scripts/shoot-theme-panel.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const width = Number(process.env.WIDTH || 1440);
const height = Number(process.env.HEIGHT || 900);
const theme = process.env.THEME || '100';
const accent = process.env.ACCENT || '199,90,52';
const out = process.env.OUT || join(root, 'theme-panel.png');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // The setup is injected as a real <script> rather than passed to `eval`,
  // because the CLI's arguments travel through cmd.exe and a multi-line
  // function body does not survive that quoting intact.
  if (path === '/__theme-setup.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    return res.end(`
      localStorage.setItem('jspl-hub-theme', ${JSON.stringify(theme)});
      localStorage.setItem('jspl-hub-accent', ${JSON.stringify(accent)});
      var panel = document.getElementById('themePanel');
      if (panel && panel.parentElement !== document.body) document.body.appendChild(panel);
      if (panel) {
        panel.classList.add('open');
        panel.style.display = 'flex';
        panel.style.position = 'fixed';
        panel.style.left = '40px';
        panel.style.top = '140px';
        panel.style.right = 'auto';
        panel.style.zIndex = '9999';
      }
      // Blank everything behind the panel. It is glassmorphic, so an element
      // screenshot captures the page showing through it with the backdrop blur
      // not applied, which leaves the panel's own chrome unreadable.
      var bg = document.createElement('div');
      bg.style.cssText = 'position:fixed;inset:0;background:linear-gradient(135deg,#101a2e,#1b2740);z-index:0';
      document.body.appendChild(bg);
      Array.prototype.forEach.call(document.body.children, function(n){ if(n !== bg) n.style.visibility = 'hidden'; });
      if (panel) panel.style.visibility = 'visible';
      // Surface the numbers that matter, so a broken render is diagnosable from
      // the run output and not only from the picture.
      var dEl = document.getElementById('themeDarkness');
      var diag = {
        panel: panel ? Math.round(panel.getBoundingClientRect().width) + 'x' + Math.round(panel.getBoundingClientRect().height) : 'none',
        ranges: document.querySelectorAll('.theme-range').length,
        darkness: getComputedStyle(document.documentElement).getPropertyValue('--theme-d').trim(),
        bg: getComputedStyle(document.body).backgroundColor,
        text: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
        primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
        primaryRgb: getComputedStyle(document.documentElement).getPropertyValue('--primary-rgb').trim(),
        derived: document.documentElement.getAttribute('data-theme'),
        sliderVals: ['themeDarkness','accentHue','accentSat','accentLight'].map(function(id) {
          var e = document.getElementById(id); return e ? e.value : null; })
      };
      document.title = 'DIAG ' + JSON.stringify(diag);
    `);
  }
  const file = join(root, path === '/' ? 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// Call node and the CLI's JS entry directly. Two things rule out the npm .cmd
// shim: Node >=20 refuses to spawn a .cmd without a shell (EINVAL), and
// spawning it WITH a shell routes the args through cmd.exe, which strips the
// quotes around an `eval` function body and sends malformed JavaScript — the
// command then fails in a way that looks like a page bug rather than quoting.
const npmDir = join(process.env.APPDATA || '', 'npm');
const cliJs = process.env.PLAYWRIGHT_CLI
  || join(npmDir, 'node_modules', '@playwright', 'cli', 'playwright-cli.js');
// Every command must name the same session, or each one starts a fresh
// browser and the eval/screenshot never see the page the `open` loaded.
// A fresh session per run. A reused one keeps its HTTP cache and browser
// profile between runs, so a re-render silently shows the PREVIOUS
// theme.css — which reads as "my CSS change did nothing" rather than as a
// stale cache.
const session = process.env.PW_SESSION || `themeshot-${process.pid}`;

function run(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cliJs, `-s=${session}`, ...args],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.on('error', e => resolve({ code: 1, err: String(e) }));
    child.on('exit', code => {
      if (process.env.DEBUG_SHOT) {
        const noise = out.split('\n').filter(l => l && !/Update available|npm install/.test(l));
        console.error('$', args.join(' '), '->', code, '\n' + noise.join('\n').slice(0, 600));
      }
      resolve({ code, err: out });
    });
  });
}

// The panel only exists behind auth, so open it and mark the current theme and
// accent directly on the real nodes — the CSS cascade is what is under test.
const inject = `() => { var s = document.createElement('script'); s.src = '/__theme-setup.js'; document.head.appendChild(s); return 'ok'; }`;
const probe = `() => {
  var p = document.getElementById('themePanel');
  if (!p) return 'NO PANEL';
  var cs = getComputedStyle(p);
  return JSON.stringify({
    display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
    parentDisplay: p.parentElement ? getComputedStyle(p.parentElement).display : null,
    bodyClass: document.body.className,
    rect: p.getBoundingClientRect().width + 'x' + p.getBoundingClientRect().height,
    segW: (document.getElementById('themeSeg') || {}).clientWidth,
    dots: document.querySelectorAll('.accent-dot').length
  });
}`;

await run(['open', base + '/index.html']);
await run(['resize', String(width), String(height)]);
const ev = await run(['eval', inject]);
await new Promise(r => setTimeout(r, 900));
// The diagnostics ride back on document.title, which the CLI prints in its
// page banner — no second eval round-trip, so nothing depends on the shell
// surviving a multi-line argument.
const info = await run(['eval', `() => document.title`]);
const diag = (info.err.split('\n').find(l => l.includes('DIAG')) || 'no diag');
console.error(diag.trim().slice(0, 500));
const shot = await run(['screenshot', process.env.TARGET || '#themePanel', '--filename', out]);
await run(['close']);
server.close();

if (shot.code !== 0) {
  console.error('screenshot failed:', shot.err.split('\n').filter(l => l && !/Update available|npm install/.test(l)).join('\n').slice(0, 600));
  process.exit(1);
}
console.log('wrote', out);
