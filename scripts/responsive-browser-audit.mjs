import { createServer } from 'node:http';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

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
const viewports = [
  { name: 'mobile', width: 320, height: 800 },
  { name: 'mobileLg', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
];
const cli = process.env.PLAYWRIGHT_CLI || 'playwright-cli';
const defaultCliJs = process.platform === 'win32' && process.env.APPDATA
  ? join(process.env.APPDATA, 'npm', 'node_modules', '@playwright', 'cli', 'playwright-cli.js')
  : '';
const cliJs = process.env.PLAYWRIGHT_CLI_JS || defaultCliJs;
const session = `responsive-audit-${process.pid}`;
const rootPath = normalize(root);

function runCli(args) {
  return new Promise((resolve) => {
    const command = cliJs ? process.execPath : cli;
    const commandArgs = cliJs ? [cliJs, ...args] : args;
    const child = spawn(command, commandArgs, {
      cwd: root,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, error: new Error('playwright-cli timed out') });
    }, 120_000);
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish({ code: null, error }));
    child.on('close', (code) => finish({ code }));
  });
}

const cliVersion = await runCli(['--version']);
if (cliVersion.error || cliVersion.code !== 0) {
  console.log('Browser audit skipped: playwright-cli is not available.');
  process.exit(0);
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const requested = pathname === '/' ? '/index.html' : pathname;
    const filePath = normalize(join(root, requested));
    const relation = relative(rootPath, filePath);
    if (relation.startsWith('..') || relation.includes(`..${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

const port = await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const auditItems = pages.map((name) => ({
  name,
  url: `http://127.0.0.1:${port}/${encodeURIComponent(name)}`,
}));
const codePath = join(tmpdir(), `responsive-browser-audit-${process.pid}.js`);
const auditCode = `async page => {
  const pages = ${JSON.stringify(auditItems)};
  const viewports = ${JSON.stringify(viewports)};
  const results = [];
  for (const item of pages) {
    try {
      await page.goto(item.url, { waitUntil: 'domcontentloaded' });
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForTimeout(100);
        const metrics = await page.evaluate(() => {
          const edges = el => {
            if (!el) return null;
            const box = el.getBoundingClientRect();
            return { left: box.left, right: box.right };
          };
          return {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            // The shared header chrome's own edges. A header displaced by a stale
            // fixed-position offset is invisible to scrollWidth — leftward
            // overflow is not reachable in an LTR document, so scrollWidth stays
            // equal to clientWidth while half the header sits off-canvas.
            headerShell: edges(document.querySelector('.app-header-shell')),
            header: edges(document.querySelector('.app-header')),
          };
        });
        results.push({ page: item.name, viewport: viewport.name, ...metrics });
      }
    } catch (error) {
      results.push({ page: item.name, error: String(error) });
    }
  }
  return 'AUDIT_RESULT:' + JSON.stringify(results);
}`;
await writeFile(codePath, auditCode, 'utf8');

const failures = [];
try {
  const opened = await runCli(['-s=' + session, 'open', auditItems[0].url]);
  if (opened.error || opened.code !== 0) {
    failures.push('browser could not open the local audit session');
  } else {
    const audited = await runCli(['-s=' + session, '--raw', 'run-code', '--filename=' + codePath]);
    let output = String(audited.stdout || '').trim();
    try {
      const decoded = JSON.parse(output);
      if (typeof decoded === 'string') output = decoded;
    } catch {}
    const marker = 'AUDIT_RESULT:';
    const markerIndex = output.indexOf(marker);
    if (audited.error || audited.code !== 0 || markerIndex < 0) {
      const detail = String(audited.stdout || audited.stderr || '').trim().slice(-500);
      failures.push(`browser audit did not return metrics${detail ? `: ${detail}` : ''}`);
    } else {
      let results;
      try {
        results = JSON.parse(output.slice(markerIndex + marker.length));
      } catch (error) {
        failures.push(`browser audit returned malformed metrics: ${error.message}`);
        results = [];
      }
      for (const result of results) {
        if (result.error) {
          failures.push(`${result.page}: ${result.error}`);
        } else if (!Number.isFinite(result.scrollWidth) || !Number.isFinite(result.clientWidth)) {
          failures.push(`${result.page} @ ${result.viewport}: metrics unavailable`);
        } else if (result.scrollWidth > result.clientWidth) {
          failures.push(`${result.page} @ ${result.viewport}: document overflow ${result.scrollWidth}px > ${result.clientWidth}px`);
        } else {
          const bleed = [];
          for (const [label, rect] of [['header shell', result.headerShell], ['header', result.header]]) {
            if (!rect) continue;
            if (rect.left < -0.5) bleed.push(`${label} starts ${Math.round(-rect.left)}px off-canvas`);
            if (rect.right > result.clientWidth + 0.5) {
              bleed.push(`${label} extends ${Math.round(rect.right - result.clientWidth)}px past the viewport`);
            }
          }
          if (bleed.length) {
            failures.push(`${result.page} @ ${result.viewport}: ${bleed.join('; ')}`);
          }
        }
      }
    }
  }
} finally {
  await runCli(['-s=' + session, 'close']);
  await unlink(codePath).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}

if (failures.length) {
  console.error('Responsive browser audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Responsive browser audit passed for ${pages.length} pages at ${viewports.length} widths.`);
}
