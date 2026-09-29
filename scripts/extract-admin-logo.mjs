// One-off: pull the base64 JSPL badge out of admin.html into a real .png file
// so the browser can cache it instead of re-parsing ~75 KB of base64 on every
// page load. Rewrites the <img src> in place.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const FILE = 'admin.html';
const html = readFileSync(FILE, 'utf8');
const re = /src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/;

const m = html.match(re);
if (!m) {
  console.error('no base64 png found in admin.html — nothing to do');
  process.exit(1);
}

const b64 = m[1];
const buf = Buffer.from(b64, 'base64');

// PNG magic number sanity check so we never write a corrupt asset.
const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 &&
  buf[2] === 0x4e && buf[3] === 0x47;
if (!isPng) {
  console.error('decoded bytes are not a PNG — aborting');
  process.exit(1);
}

writeFileSync('jspl-logo.png', buf);
writeFileSync(FILE, html.replace(re, 'src="jspl-logo.png"'));

console.log('wrote jspl-logo.png:', buf.length, 'bytes (was', b64.length, 'base64 chars)');
