// Renders a page in a real browser and screenshots it, so theme and spacing can
// be checked rather than reasoned about. The pages are normally gated behind
// auth + middleware, so this serves them over a throwaway static server and
// drives the real markup/CSS in a real cascade — the only reliable way to catch
// a shared-rule override or a custom-property that does not resolve.
//
//   node scripts/shoot-page.mjs                      -> page.png (index.html)
//   PAGE=admin.html node scripts/shoot-page.mjs
//   THEME=55 ACCENT=280,80,50 node scripts/shoot-page.mjs
//   WIDTH=320 node scripts/shoot-page.mjs
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const page = process.env.PAGE || 'index.html';
const width = Number(process.env.WIDTH || 1440);
const height = Number(process.env.HEIGHT || 1000);
const theme = process.env.THEME || '100';
const accent = process.env.ACCENT || '199,90,52';
const out = process.env.OUT || join(root, 'page.png');

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
  // Seeded as a real <script> rather than passed to `eval`, because the CLI's
  // arguments travel through cmd.exe and a multi-line function body does not
  // survive that quoting intact.
  if (path === '/__seed.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    return res.end(`
      localStorage.setItem('jspl-hub-theme', ${JSON.stringify(theme)});
      localStorage.setItem('jspl-hub-accent', ${JSON.stringify(accent)});
      // The hub gates the dashboard behind an authenticated frame, so reveal
      // the page itself rather than screenshotting a login box.
      document.addEventListener('DOMContentLoaded', function () {
        var stage = document.getElementById('frameStage');
        if (stage) stage.style.display = '';
        var wrap = document.querySelector('.login-wrap');
        if (wrap) wrap.style.display = 'none';
      });
      // This block runs while the document is still parsing, so body may not
      // exist yet. Everything that needs body waits for DOMContentLoaded —
      // without the guard the seed throws here and every later step silently
      // reports no diagnostics.
      var measure = function () {
        var cs = getComputedStyle(document.documentElement);
      var lum = function (str) {
        if (!str) return null;
        // color-mix() resolves to color(srgb r g b) with 0..1 components, while
        // a literal resolves to rgb(r, g, b) with 0..255. Both forms have to be
        // handled or a blended theme silently measures as null.
        // (No backticks in these comments — this whole block lives inside a
        // template literal, and one would terminate it early.)
        // Backslashes are DOUBLED throughout this block on purpose. The seed is
        // emitted as a template literal, where \d, \s and \( are not recognised
        // escapes and collapse to d, s and a bare ( — which turns these colour
        // regexes into unbalanced groups and makes the whole seed a syntax
        // error. That surfaces only as "no diagnostics at all", not as an error.
        var srgb = str.match(/color\\(srgb\\s+([\\d.eE+-]+)\\s+([\\d.eE+-]+)\\s+([\\d.eE+-]+)/);
        var rgb = str.match(/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)/);
        var m = srgb || rgb;
        if (!m) return null;
        var scale = srgb ? 255 : 1;
        var f = function (v) { v = parseFloat(v) * scale / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(m[1]) + 0.7152 * f(m[2]) + 0.0722 * f(m[3]);
      };
      var bgL = lum(getComputedStyle(document.body).backgroundColor);
      // Read the resolved text colour off a real rendered element rather than
      // the custom property, which may still be an unevaluated color-mix().
      var probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;color:var(--text)';
      document.body.appendChild(probe);
      var txL = lum(getComputedStyle(probe).color);
      probe.remove();
      var ratio = (txL === null || bgL === null) ? null :
        (Math.max(txL, bgL) + 0.05) / (Math.min(txL, bgL) + 0.05);
      // What the page ACTUALLY ended up with after its own script ran. This is
      // the number that matters: a page whose script reads the shared key by
      // hand and fails to match it silently lands on 'dark' here, while the
      // requested darkness was something else entirely.
      window.__diag = {
        themeD: cs.getPropertyValue('--theme-d').trim(),
        derived: document.documentElement.getAttribute('data-theme'),
        primaryRgb: cs.getPropertyValue('--primary-rgb').trim(),
        contrast: ratio === null ? null : Math.round(ratio * 100) / 100,
        storedAfter: (function () { try { return localStorage.getItem('jspl-hub-theme'); } catch (e) { return null; } })(),
        bgRaw: getComputedStyle(document.body).backgroundColor,
        textRaw: getComputedStyle(probe).color
      };
      };
      var runMeasure = function () {
        // Surfaced rather than swallowed: a throw in here used to leave
        // window.__diag undefined, which read downstream as "the page is fine"
        // when in fact nothing had been measured at all.
        try { measure(); } catch (e) { window.__diag = { error: String(e && e.message || e) }; }
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runMeasure);
      } else {
        runMeasure();
      }
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
// A fresh session per run. A reused one keeps its HTTP cache and browser
// profile between runs, so a re-render silently shows the PREVIOUS CSS —
// which reads as "my change did nothing" rather than as a stale cache.
const session = process.env.PW_SESSION || `shoot-${process.pid}`;

function run(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cliJs, `-s=${session}`, ...args],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.on('error', e => resolve({ code: 1, err: String(e) }));
    child.on('exit', code => resolve({ code, err: out }));
  });
}

const inject = `() => { var s = document.createElement('script'); s.src = '/__seed.js'; document.head.appendChild(s); return 'ok'; }`;

await run(['open', `${base}/${encodeURIComponent(page)}`]);
await run(['resize', String(width), String(height)]);
await run(['eval', inject]);
await new Promise(r => setTimeout(r, 600));
// Reload so theme-boot.js — which runs in <head> and read the values BEFORE the
// seed was injected — now sees the seeded localStorage. Without this the
// diagnostics below report the defaults, and the screenshot shows the default
// theme regardless of what was asked for.
await run(['goto', `${base}/${encodeURIComponent(page)}`]);
await new Promise(r => setTimeout(r, 1200));
// The DOMContentLoaded reveal above has to be re-run for the same reason.
await run(['eval', inject]);
await new Promise(r => setTimeout(r, 800));
// The diagnostics ride back on document.title, which the CLI prints in its
// page banner — no second eval round-trip, so nothing depends on the shell
// surviving a multi-line argument.
const info = await run(['eval', '() => JSON.stringify(window.__diag || null)']);
// The CLI echoes a string result quoted AND escaped, so the object arrives as
// {\"a\":1}. Unescape before writing, or every consumer has to re-do this.
const diag = (info.err.match(/\{[\s\S]*?\}/) || ['null'])[0].replace(/\\(["\\])/g, '$1');
console.error('DIAG ' + diag);
// Written out too, so a caller sweeping many slider positions can parse the
// numbers without scraping this process's stderr.
if (process.env.DIAG_OUT) {
  await writeFile(process.env.DIAG_OUT, diag, 'utf8');
}
const shot = await run(['screenshot', '--filename', out]);
await run(['close']);
server.close();

if (shot.code !== 0) {
  console.error('screenshot failed:', shot.err.split('\n').filter(l => l && !/Update available|npm install/.test(l)).join('\n').slice(0, 500));
  process.exit(1);
}
console.log('wrote', out);
