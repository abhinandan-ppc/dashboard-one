// Registry cache + version-checked write behaviour for api/_acl.js.
//
// Everything is driven through a fake global fetch, so the tests exercise the
// real read/write/ETag code paths without touching Blob.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_storestoreid_secret';
process.env.ADMIN_EMAILS = 'root@example.com';

const acl = await import('../api/_acl.js');

let realFetch = null;
let etagCounter = 0;

// In-memory stand-in for the single registry object in Blob.
let store = { users: {} };
let currentEtag = null;

function bumpEtag() {
  currentEtag = '"etag-' + (++etagCounter) + '"';
  return currentEtag;
}

// Returns a call log, and accepts `conflictTimes` to make that many conditional
// writes fail with 412 the way a concurrent writer would.
function installFetch(overrides = {}) {
  const calls = { reads: 0, writes: [], conflicting: 0, readUrls: [], readEtags: [] };

  globalThis.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers || {});

    if (init.method === 'PUT') {
      calls.writes.push({
        body: JSON.parse(init.body),
        ifMatch: headers.get('x-if-match'),
        allowOverwrite: headers.get('x-allow-overwrite'),
        maxAge: headers.get('x-cache-control-max-age'),
      });

      // Another writer committed since the caller's read: reject the write.
      if (headers.get('x-if-match') && overrides.conflictTimes > 0) {
        overrides.conflictTimes--;
        calls.conflicting++;
        store = JSON.parse(JSON.stringify(store)); // their change lands
        bumpEtag();
        return new Response(JSON.stringify({ error: { code: 'precondition_failed' } }), { status: 412 });
      }

      store = JSON.parse(init.body);
      const etag = bumpEtag();
      return new Response(JSON.stringify({ etag, pathname: 'acl/registry.json' }), { status: 200 });
    }

    calls.reads++;
    calls.readUrls.push(String(url));
    if (!store.users) store.users = {};
    const etag = currentEtag || bumpEtag();
    calls.readEtags.push(etag);
    return new Response(JSON.stringify(store), {
      status: 200,
      headers: new Headers({ etag }),
    });
  };

  return calls;
}

beforeEach(() => {
  realFetch = globalThis.fetch;
  store = { users: {} };
  currentEtag = null;
  etagCounter = 0;
  acl.__resetCache();
  acl.__setCacheTtl(5000);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  acl.__resetCache();
});

test('getRegistry reads Blob once and serves later calls from cache', async () => {
  const calls = installFetch();
  store = { users: { 'a@example.com': { status: 'pending' } } };

  const first = await acl.getRegistry();
  const second = await acl.getRegistry();

  assert.equal(calls.reads, 1, 'second read should be served from the in-memory cache');
  assert.deepEqual(first.users, second.users);
});

test('getRegistry hands out copies, so a caller mutating the result cannot poison the cache', async () => {
  const calls = installFetch();
  store = { users: { 'a@example.com': { status: 'pending', pages: [] } } };

  const first = await acl.getRegistry();
  first.users['a@example.com'].status = 'blocked';
  first.users['injected@example.com'] = { status: 'approved' };

  const second = await acl.getRegistry();
  assert.equal(second.users['a@example.com'].status, 'pending', 'cache must be unaffected by caller mutation');
  assert.equal(second.users['injected@example.com'], undefined);
  assert.equal(calls.reads, 1);
});

test('a write is visible to this instance immediately, without waiting out the TTL', async () => {
  const calls = installFetch();
  store = { users: {} };

  await acl.updateRegistry(r => { r.users['new@example.com'] = { status: 'approved' }; });

  const after = await acl.getRegistry();
  assert.ok(after.users['new@example.com']);
  assert.equal(calls.reads, 1, 'the write refreshed the local copy, so no extra read');
});

test('updateRegistry sends the ETag it read, alongside x-allow-overwrite', async () => {
  const calls = installFetch();
  store = { users: { 'a@example.com': { status: 'pending' } } };

  await acl.updateRegistry(r => { r.users['a@example.com'].status = 'approved'; });

  assert.equal(calls.writes.length, 1);
  assert.equal(
    calls.writes[0].ifMatch,
    calls.readEtags[calls.readEtags.length - 1],
    'the write must be conditional on exactly the version updateRegistry read'
  );
  assert.equal(calls.writes[0].allowOverwrite, '1', 'x-if-match is only valid with x-allow-overwrite');
  assert.equal(calls.writes[0].maxAge, '0', 'writes must not leave a CDN copy to go stale');
});

test('a conflicting write is retried against the newer version instead of clobbering it', async () => {
  const calls = installFetch({ conflictTimes: 1 });
  store = { users: { 'a@example.com': { status: 'pending' } } };

  // Stand in for another writer landing a change first.
  const other = JSON.parse(JSON.stringify(store));
  other.users['b@example.com'] = { status: 'approved' };
  store = other;

  await acl.updateRegistry(r => { r.users['a@example.com'].status = 'approved'; });

  assert.equal(calls.conflicting, 1, 'the first conditional write should have been rejected');
  assert.equal(calls.writes.length, 2, 'and then retried');
  assert.ok(store.users['b@example.com'], 'the concurrent write must not be lost');
  assert.equal(store.users['a@example.com'].status, 'approved', 'our change is re-applied on top');
});

test('updateRegistry gives up after the attempt limit rather than looping forever', async () => {
  const calls = installFetch({ conflictTimes: 99 });
  store = { users: { 'a@example.com': { status: 'pending' } } };

  await assert.rejects(
    () => acl.updateRegistry(r => { r.users['a@example.com'].status = 'approved'; }),
    /Blob write failed \(412\)/
  );
  assert.equal(calls.writes.length, 3, 'exactly MAX_WRITE_ATTEMPTS attempts');
});

test('a failure inside the mutate function writes nothing', async () => {
  const calls = installFetch();
  store = { users: {} };

  await assert.rejects(
    () => acl.updateRegistry(() => { throw new Error('user not found'); }),
    /user not found/
  );
  assert.equal(calls.writes.length, 0, 'a rejected action must not reach Blob');
  assert.deepEqual(store.users, {});
});

test('recordLogin uses the version-checked write path', async () => {
  const calls = installFetch();
  store = { users: {} };

  await acl.recordLogin({ email: 'a@example.com', name: 'A', domain: 'example.com' });

  assert.ok(store.users['a@example.com']);
  assert.equal(store.users['a@example.com'].status, 'pending', 'a first-time login starts pending');
  assert.ok(calls.writes[0].ifMatch, 'the login write is version-checked too');
});

test('recordLogin keeps an existing approval when it refreshes lastLogin', async () => {
  installFetch();
  store = { users: { 'a@example.com': { status: 'approved', pages: ['PM-Yard.html'], firstLogin: 1, lastLogin: 1 } } };

  await acl.recordLogin({ email: 'a@example.com', name: 'A' });

  assert.equal(store.users['a@example.com'].status, 'approved', 'approval survives a login write');
  assert.deepEqual(store.users['a@example.com'].pages, ['PM-Yard.html'], 'grants survive a login write');
  assert.ok(store.users['a@example.com'].lastLogin > 1);
});

test('a cache TTL of 0 disables the cache entirely', async () => {
  const calls = installFetch();
  store = { users: {} };
  acl.__setCacheTtl(0);

  await acl.getRegistry();
  await acl.getRegistry();

  assert.equal(calls.reads, 2, 'with caching off every call must hit Blob');
});

test('reads carry a cache-busting nonce so a stale CDN copy cannot be served', async () => {
  const calls = installFetch();
  store = { users: {} };

  await acl.getRegistry();

  assert.equal(calls.readUrls.length, 1);
  assert.match(calls.readUrls[0], /\?v=/, 'read URL must carry a cache-busting nonce');
});

// The middleware matcher is the other half of the fix: it used to run the
// access check on api/admin/*, on theme-boot.js and on static assets, which
// cost a Blob read apiece and (for theme-boot.js) served an HTML "Access
// pending" page in place of the script, breaking theme loading for every
// non-admin. This pins both halves of that behaviour.
test('middleware gates the tool pages but not theme-boot.js, static assets or api/admin', async () => {
  const { config } = await import('../middleware.js');
  const source = config.matcher[0].replace(/^\//, '').replace(/\/$/, '');
  // Vercel anchors matcher patterns to the whole path; mirror that here.
  const re = new RegExp('^(?:' + source + ')$');

  const mustGate = [
    'admin.html',
    'PM-Yard.html',
    'Rake-Planner.html',
    'Grade-Clubbing-Matrix.html',
    'VDO-Generator.html',
    'Order-Status-Report.html',
    'Plate-Tagging-Tool.html',
    'SMS-Heat-Planner.html',
    'api/ebtp-proxy',
  ];
  const mustPass = [
    'theme-boot.js',
    'theme.css',
    'jspl-logo.png',
    'favicon.ico',
    'index.html',
    'api/auth/me',
    'api/auth/login',
    'api/admin/users',
    'api/admin/directory',
    '',
  ];

  for (const p of mustGate) {
    assert.ok(re.test(p), `${p} must stay behind the access check`);
  }
  for (const p of mustPass) {
    assert.ok(!re.test(p), `${p} must not go through the access check`);
  }
});

