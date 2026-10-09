// Parses every inline <script> block of a static page with the JS engine, so a
// hand-edited HTML file can be syntax-checked without a browser. Exits non-zero
// on the first bad block.
import { readFile } from 'node:fs/promises';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/syntax-check-page.mjs <page.html>');
  process.exit(2);
}

const html = await readFile(file, 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (!blocks.length) {
  console.error('no inline <script> blocks found in ' + file);
  process.exit(2);
}

let failed = false;
blocks.forEach((match, i) => {
  const src = match[1];
  try {
    new Function(src); // compile only — never runs the block
    console.log(`script #${i + 1}: syntax OK (${src.length} chars)`);
  } catch (err) {
    failed = true;
    console.log(`script #${i + 1}: SYNTAX ERROR -> ${err.message}`);
  }
});

console.log(`checked ${blocks.length} inline script block(s) in ${file}`);
process.exit(failed ? 1 : 0);
