# Service Account Integration (ZSTK / AutoBTR / EBTP)

Context dump of the Google service-account integration added to pull live
ZSTK, AutoBTR, and EBTP data from private Google Sheets/Drive — for whoever
picks this up next.

## The service account

- Email: `dbone-327@sonic-harbor-448010-j8.iam.gserviceaccount.com`
- GCP project: `sonic-harbor-448010-j8`
- Key file: `service-account.json` (local only — gitignored, never committed;
  see `.gitignore`: `service-account.json` and `*service-account*.json`)
- Deliberately **separate** from the pre-existing `GOOGLE_SA_CLIENT_EMAIL` /
  `GOOGLE_SA_PRIVATE_KEY` service account used by `api/_directory.js` (which
  has domain-wide-delegated Admin Directory access for the people-search
  feature). This one has no delegation — it only has whatever it's been
  directly shared on (specific sheets/Drive files/folders). Keep them
  separate so a bug or leak in one scope can't touch the other's privileges.
- Required GCP APIs (must be enabled on the project, or every call fails with
  a "Service disabled" error): **Google Sheets API**, **Google Drive API**.
- Sharing: the service account email must be added as Viewer (or better) on
  each sheet/file it needs to read. It was added to all three sources below.

## Data sources

| Source  | Type               | ID / sheet name |
|---------|--------------------|------------------|
| ZSTK    | Google Sheet       | Spreadsheet `1KP7GV1jcbKFrXUH5_ZjraQM5231nhs7yrkJyuJ2Dq5I`, tab `ZSTK_LIVE_TEMP` |
| AutoBTR | Drive `.xlsx` file (not a native Sheet) | File `1mY8UlWqgTSZku0GYcrDRDzPb5XL7tf-v` |
| EBTP    | Google Sheet (private; replaced an old publish-to-web CSV) | Spreadsheet `1mIoA3R9LCUozGBLx4okQoQYWHjZD4tDf-OFM9m6OsQU`, tab `LIVE` |

## Required Vercel env vars

Set in Vercel project settings (Production + Preview/Development), as plain
values — the helper unescapes `\n` in the private key itself:

- `SHEETS_SA_CLIENT_EMAIL` = the service account's `client_email`
- `SHEETS_SA_PRIVATE_KEY` = the service account's `private_key` (full PEM,
  `\n`-escaped is fine)

## Auth helper: `api/_sheets-sa.js`

Edge-Function-compatible (no Node-only deps, so no `googleapis` SDK — that
pulls in Node APIs Edge Functions can't bundle). Signs its own JWT with Web
Crypto (`crypto.subtle`) and exchanges it for an access token at Google's
token endpoint.

Key pieces:
- `getSheetsAccessToken(scope)` — returns a cached token if still valid
  (60s safety margin), otherwise requests a fresh one. Retries up to 3x on
  failure (150/300/450ms backoff) — see "Diagnosed issues" below for why.
- `invalidateSheetsToken(scope)` — drops a cached token; call this after a
  401 so the next request is forced to mint a fresh one.
- `fetchWithSheetsAuth(scope, url, init)` — fetches with a Bearer token,
  and if the response is 401, invalidates the cache and retries once with a
  forced-fresh token. This is the one proxies should call, not
  `getSheetsAccessToken` + `fetch` directly.
- `valuesToCsv(values)` — minimal CSV serializer for a Sheets API
  `values.get()` array-of-arrays response (used by the EBTP proxy to keep
  its CSV-shaped output contract with existing downstream code).
- Token cache is an in-memory `Map`, scoped per Edge isolate — cold starts
  get an empty cache, so this is a best-effort optimization, not a
  guarantee. Don't rely on it for correctness, only for reduced latency.

## Proxies (`api/*.js`, all `export const config = { runtime: 'edge' }`)

- **`api/zstk-proxy.js`** — Sheets API `values.get` on `ZSTK_LIVE_TEMP`,
  `valueRenderOption=UNFORMATTED_VALUE`. Returns `{ values: [[...], ...] }`
  JSON (header row + data rows, same shape `parseZSTKData()` in
  PM-Yard.html already expects). One retry on a transient 5xx/network error.
- **`api/autobtr-proxy.js`** — Drive API `files/{id}?alt=media` (binary
  download, since this is a plain `.xlsx` in Drive, not a native Sheet).
  Returns the raw bytes with an xlsx content-type. One retry on transient
  failure, same pattern as ZSTK.
- **`api/ebtp-proxy.js`** — Sheets API `values.get` on the `LIVE` tab,
  converted to CSV via `valuesToCsv()` so the existing CSV-based cache/parse
  pipeline in `index.html` (`fetchAndCacheEBTP`) needed zero changes. This
  replaced the previous implementation, which just proxied a
  publish-to-web CSV export URL — that sheet is now private, so the old
  public-CSV approach stopped being an option.

## Hub-level caching architecture (index.html)

All three sources now follow one model, piggybacking on the IndexedDB cache
EBTP already had:

- Shared IndexedDB: `jspl-ebtp-shared-db`, object store `cache`.
- Keys: `'latest'` (EBTP, pre-existing), `'segment'` (pre-existing,
  different sheet/tab), `'zstk'` and `'autobtr'` (new).
- Generic `writeDbCache(key, payload, rowCount, localStorageFlagKey?)` /
  `readDbCache(key)` helpers (pre-existing, just reused with new keys) —
  `payload` can be anything structured-cloneable: a CSV string, a
  `values` array-of-arrays (ZSTK), or a raw `ArrayBuffer` (AutoBTR).
- The hub is the **only** thing that calls the three proxies. Three status
  chips in the hub header (before the Home/Refresh/Theme/Account buttons),
  one per source, each: shows a status dot (greyed/amber-pulsing/green/red),
  does the fetch via the matching proxy, writes the result into the shared
  cache, and broadcasts `{ type: '<src>-cache-updated', fetchedAt, rowCount? }`
  to every open dashboard iframe via the existing `broadcastToFrame()`.
- `window.__hubSyncSheet` exposes the chips' internal `syncSheet(src, force)`
  function globally so the hub's cross-frame message listener can trigger it
  (a dashboard iframe can ask the hub to do a fetch — see below).
- On hub load, all three sources get one quiet status check, **staggered**
  (zstk at 300ms, autobtr at 900ms, ebtp at 1500ms) rather than firing
  together — see "Diagnosed issues" for why that mattered.
- Bottom-of-screen fetch/parse popup (`#fetchStatus`, originally EBTP-only)
  was generalized to support multiple concurrent sources: `fetchStatusShow`/
  `fetchStatusLog` take an optional `source` label (defaults to `'EBTP'` for
  backward compat), and `fetchStatusHide(source)` only actually hides the
  panel once every active source has called hide — so ZSTK/AutoBTR/EBTP
  popups can overlap in time without stomping each other.

## Dashboard side (PM-Yard.html)

PM-Yard has its own local copy of the IndexedDB reader (same DB/store name —
browsers share IndexedDB per-origin, not per-frame, so any same-origin page
can read it directly without asking the hub):

- `openHubCacheDb()` / `readHubCache(key)` / `readHubZstkCache()` /
  `readHubAutoBtrCache()` — read-only access to the hub's cache.
- `ingestZstkCacheRecord(rec)` — feeds a cached `values` array into the
  existing `parseZSTKData()` and updates the upload-card UI.
- `ingestAutoBtrCacheRecord(rec)` — wraps a cached `ArrayBuffer` in a `Blob`
  and feeds it into the existing `loadBTRFile()` (which already accepted any
  `Blob`, not just a `File`, so no change needed there).
- `requestHubSync(src, force, timeoutMs=8000)` — posts
  `{ type: 'request-<src>-fetch', force }` to `window.parent` and resolves
  once the matching `<src>-cache-updated` broadcast lands (tracked via
  module-level `_pendingZstkResolve` / `_pendingAutoBtrResolve`, resolved
  from the page's own `handleHubMessage` listener), or resolves `false`
  after the timeout so the caller can fall back to fetching the proxy
  directly.
- `syncZSTKLive(force)` / `syncAutoBTRLive(force)`:
  - Not embedded in the hub (`window.parent === window`) → always fetches
    the proxy directly (old behavior, unchanged).
  - Embedded, `force=false` (page load / dropdown auto-open) → read hub
    cache first; if present, ingest with **zero network calls**; if absent,
    ask the hub to fetch (`requestHubSync`), then re-read cache; if the hub
    never answers, fall back to a direct proxy fetch.
  - Embedded, `force=true` ("Sync Live" button clicked) → always asks the
    hub for a fresh pull first (shares the hub's retry/backoff + status
    popup), falling back to a direct fetch only if the hub doesn't respond.
- The hub-message listener (`handleHubMessage`) now handles
  `zstk-cache-updated` / `autobtr-cache-updated` (replacing the earlier,
  simpler `sync-zstk` / `sync-autobtr` message types): if this page has a
  pending `requestHubSync` call out, resolve it; otherwise (an unsolicited
  broadcast — e.g. another tab's hub chip was clicked) just read the cache
  and ingest directly.

## Diagnosed issues (and fixes) along the way

1. **"Service disabled" errors** — the Sheets/Drive APIs weren't enabled on
   the GCP project yet. Fixed by enabling both in Cloud Console. Not a code
   bug, just a one-time setup step.
2. **Intermittent "invalid token" + chips flickering yellow→red** — ZSTK and
   AutoBTR had only a single attempt at token+fetch, unlike EBTP (which has
   a 9-strategy fallback chain from before this integration existed), so any
   transient blip (cold-start token fetch, borderline clock-skew JWT
   rejection across Edge regions, a Google 5xx) surfaced immediately as a
   hard failure. Fixed with layered retries:
   - `_sheets-sa.js` retries token acquisition up to 3x and backdates `iat`
     by 30s to tolerate Edge-isolate clock drift.
   - A 401 invalidates the cached token and retries once with a fresh one
     (`fetchWithSheetsAuth`).
   - Each proxy retries once on a transient 5xx/network error.
   - The hub's `syncSheet()` retries once more (700ms backoff) before
     flipping a chip red.
   - The three auto-checks on hub load are staggered instead of firing in
     a burst, reducing simultaneous cold-start token requests.
3. **ZSTK header row assumption** — `parseZSTKData()` assumed row 0 was
   always the header row (true for the manually-uploaded workbook). The
   live `ZSTK_LIVE_TEMP` sheet can carry a title/filter row above the real
   header, so the parser now scans the first 5 rows for the one actually
   containing `"batch storage bin"` and parses from there. Confirmed column
   mapping: **Batch Storage Bin** = Bin, **Batch Layer** = Layer (both
   already matched first/exactly in `parseZSTKData`'s key lists).
4. **Redundant fetching** — originally PM-Yard called the proxies directly
   itself, duplicating whatever the hub was already doing. Resolved by the
   hub-cache-sharing architecture described above: the hub fetches once,
   every dashboard reads the shared cache.

## If you need to add a 4th live source

Follow the same shape: (1) share the sheet/file with the service account,
(2) add a proxy in `api/` using `fetchWithSheetsAuth`, with its own retry
loop, (3) add a status chip + `pingOnce` branch + `writeXCache` in
`index.html`'s sync-chip IIFE, (4) add a `request-<src>-fetch` handler in the
hub's cross-frame message listener, (5) on the consuming page, add a local
`readHubCache('<key>')` call and an `ingestXCacheRecord()` that feeds your
existing parser, mirroring PM-Yard's ZSTK/AutoBTR implementation.
