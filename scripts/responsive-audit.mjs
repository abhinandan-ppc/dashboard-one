import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const htmlFiles = (await readdir(root)).filter((file) => file.endsWith('.html')).sort();
const viewportPattern = /<meta\s+name=["']viewport["']\s+content=["']([^"']+)["']/i;
const requiredPages = new Set([
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
]);

const failures = [];
for (const file of htmlFiles) {
  const source = await readFile(join(root, file), 'utf8');
  const viewport = source.match(viewportPattern)?.[1] || '';
  if (!/width=device-width/i.test(viewport)) failures.push(`${file}: missing width=device-width`);
  if (!/initial-scale=1/i.test(viewport)) failures.push(`${file}: missing initial-scale=1`);
  if (!/viewport-fit=cover/i.test(viewport)) failures.push(`${file}: missing viewport-fit=cover`);
  if (file !== 'index.html' && !source.includes('theme.css')) {
    failures.push(`${file}: does not load the shared theme.css`);
  }
}

for (const file of requiredPages) {
  if (!htmlFiles.includes(file)) failures.push(`${file}: expected first-party page is missing`);
}

if (failures.length) {
  console.error('Responsive source audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Responsive source audit passed for ${htmlFiles.length} HTML pages.`);
}
