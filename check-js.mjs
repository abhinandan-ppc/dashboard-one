// Quick structural check for the Plate Tracker JS — run with `node check-js.mjs`.
//
// The controller is assembled from many edits, and the failure mode that bit
// during development was subtle: a function left unterminated, so everything
// after it became nested inside it. That PARSES fine (Node reports only
// "document is not defined") but at runtime the nested declarations are not
// hoisted, so they read as "not defined". This walks the brace depth with a
// scanner that understands strings, template literals, comments AND regex
// literals — a regex like /'/g otherwise derails a naive scan.
import { readFileSync } from 'node:fs';

const files = ['Plate-Tracker.js', 'plate-tracker-core.mjs', 'plate-tracker-worker.js'];
let bad = 0;

function scan(src) {
  let depth = 0, line = 1, i = 0;
  const top = [];
  let prev = ''; // last significant char, for regex-vs-division
  const canBeRegex = () => prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev);
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { line += 1; i += 1; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line += 1; i += 1; }
      i += 2; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i += 1; break; }
        if (src[i] === '\n') line += 1;
        i += 1;
      }
      prev = 'x';
      continue;
    }
    if (ch === '/' && canBeRegex()) {
      // regex literal: consume to the closing /, honouring escapes and classes
      i += 1;
      let inClass = false;
      while (i < src.length) {
        const c = src[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { i += 1; break; }
        else if (c === '\n') { line += 1; break; }
        i += 1;
      }
      while (i < src.length && /[a-z]/.test(src[i])) i += 1; // flags
      prev = 'x';
      continue;
    }
    if (depth === 0) {
      const m = src.slice(i, i + 16).match(/^(?:export\s+)?(?:async\s+)?function\s*(\w*)/);
      if (m && (i === 0 || /[\s;}]/.test(src[i - 1]))) top.push(`${m[1] || 'anon'}@${line}`);
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (!/\s/.test(ch)) prev = ch;
    i += 1;
  }
  return { depth, top };
}

for (const file of files) {
  const { depth, top } = scan(readFileSync(file, 'utf8'));
  const ok = depth === 0 && top.length > 0;
  if (!ok) bad += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${file} — depth ${depth}, ${top.length} top-level declarations`);
  if (process.env.CHECK_JS_VERBOSE) console.log('     ' + top.join(', '));
}

console.log(bad ? `\n${bad} problem(s)` : '\njs structure OK');
process.exit(bad ? 1 : 0);
