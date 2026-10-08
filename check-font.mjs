import { readFile } from 'node:fs/promises';
const c = await readFile('theme.css', 'utf8');
const checks = {
  'product var defined': /--font-product:'Product Sans'/.test(c),
  'body var -> product': /--font-body:var\(--font-product\)/.test(c),
  'display var -> product': /--font-display:var\(--font-product\)/.test(c),
  'brand override !important': /\.jspl-brand-l1\{font-family:var\(--font-product\)!important\}/.test(c),
  'import has Plus Jakarta': /Plus\+Jakarta\+Sans:wght@400/.test(c),
  'NO leftover Manrope body': !/--font-body:'Manrope'/.test(c),
  'NO leftover Space Grotesk display': !/--font-display:'Space Grotesk'/.test(c),
  'canonical body rule present': /body\{font-family:var\(--font-body\)!important\}/.test(c),
  'h1-h3 display rule present': /h1,h2,h3\{font-family:var\(--font-display\)!important/.test(c),
};
let ok = true;
for (const [k, v] of Object.entries(checks)) { if (!v) ok = false; console.log((v ? 'PASS ' : 'FAIL ') + k); }
console.log(ok ? '\nALL GOOD' : '\nSOME FAILED');
process.exit(ok ? 0 : 1);
