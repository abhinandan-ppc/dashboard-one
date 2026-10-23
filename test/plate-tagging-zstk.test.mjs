// The Plate Tagging Tool's Free Plate Stock slot must fill itself from the
// hub's cached ZSTK on open, the way the Order Book slot already does for
// EBTP. These are source-level contracts: the page is a single static HTML
// file with no build step, so a regression that drops the auto-load or the
// broadcast listener is a silent one the user only notices as an empty slot.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = await readFile(join(root, 'Plate-Tagging-Tool.html'), 'utf8');

const bootBlock = html.slice(
  html.indexOf("window.addEventListener('DOMContentLoaded'"),
  html.indexOf("window.addEventListener('message'"),
);
const messageListener = html.slice(html.indexOf("window.addEventListener('message'"));
const applyZstk = html.slice(
  html.indexOf('function applyOnlineZstkValues'),
  html.indexOf('/* True while a ZSTK load is in flight'),
);
const fetchZstk = html.slice(
  html.indexOf('/* True while a ZSTK load is in flight'),
  html.indexOf('/* ---------- file handling ---------- */'),
);
const readFileFn = html.slice(
  html.indexOf('function readFile('),
  html.indexOf('function closeMapPanel('),
);

test('the Free Plate Stock slot auto-loads ZSTK on open, like the Order Book slot does', () => {
  assert.match(
    bootBlock,
    /if\(!FILES\.ebtp\) fetchOnlineEbtp\(\);/,
    'the Order Book slot must keep auto-loading EBTP on open',
  );
  assert.match(
    bootBlock,
    /if\(!FILES\.por\) fetchOnlineZstk\(\);/,
    'the Free Plate Stock slot must auto-load ZSTK on open instead of waiting for a click',
  );
});

test('a hub ZSTK sync that lands after open refreshes the slot', () => {
  assert.match(
    messageListener,
    /msg\.type==='zstk-cache-updated'/,
    "the page must listen for the hub's zstk-cache-updated broadcast (index.html sends it after every sync)",
  );
  assert.match(
    messageListener,
    /zstk-cache-updated' && POR_SOURCE!=='file'/,
    'a user-uploaded .xlsx must never be overwritten by a hub broadcast',
  );
});

test('the auto-load on open and the broadcast cannot run concurrently', () => {
  // Both paths fire at the same moment on a cold open: the page asks the hub to
  // fetch, and the hub's answer is the broadcast this page also listens for.
  // Two overlapping runs each re-render the slot and each clear the button's
  // disabled state, so the guard is what keeps them to one pass.
  assert.match(fetchZstk, /let ZSTK_FETCHING=false;/, 'an in-flight flag must exist');
  assert.match(fetchZstk, /if\(ZSTK_FETCHING\) return;/, 'a second call must bail out while one is running');
  assert.match(
    fetchZstk,
    /finally\{[\s\S]*?btn\.disabled=false;[\s\S]*?ZSTK_FETCHING=false;/,
    'the flag must be released in a finally, so an early return cannot strand it true',
  );
});

test('the slot remembers whether it holds cached ZSTK or a user file', () => {
  assert.match(applyZstk, /POR_SOURCE='zstk'/, 'rows served from the hub cache or proxy must be tagged zstk');
  assert.match(applyZstk, /FILES\.por=null;POR_SOURCE=null;/, 'a failed ZSTK parse must clear the source tag');
  assert.match(readFileFn, /POR_SOURCE='file';/, 'a dropped-in .xlsx must be tagged file');
});
