import { readCookie, verifySession } from '../_session.js';
import { isPrimaryAdmin, resolveAccess, updateRegistry, getRegistry, KNOWN_PAGES, ADMIN_EMAILS } from '../_acl.js';

export const config = { runtime: 'edge' };

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    // This payload is per-admin, per-request truth straight off the registry
    // (or straight off the write this request just made) — never cacheable.
    // Without this, a browser or an intermediary in front of the Edge Function
    // is free to serve a stale GET for its own heuristic freshness window,
    // which is exactly what makes a just-saved permission change appear to
    // "revert" until that window expires.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function sameOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.get('host'); } catch { return false; }
}

// Returns the session plus the registry copy resolveAccess already had to
// fetch. Handing that copy back is what removes the extra read the GET used to
// do: the access check and the payload come from a single fetch, and the
// cached registry means the middleware's own check usually didn't hit Blob
// either.
async function requireAdmin(req) {
  const session = await verifySession(readCookie(req, 'session'));
  if (!session) return null;
  const { admin, registry } = await resolveAccess(session.email);
  if (!admin) return null;
  // resolveAccess() short-circuits for primary admins (ADMIN_EMAILS): they are
  // never stored in the registry, so it returns registry: null WITHOUT reading
  // it. That null used to be passed straight through to the GET payload, which
  // then shipped `users: {}` — so the one account that owns admin.html (the
  // env-configured primary admin) saw a permanently empty "No one has logged in
  // yet" list while everyone else had signed-in users. Fetch the registry here
  // instead so the payload is complete for every admin, primary or promoted.
  if (registry) return { session, registry };
  try {
    return { session, registry: await getRegistry() };
  } catch {
    return { session, registry: { users: {} } };
  }
}

// Thrown from inside an updateRegistry() mutate function to abort the whole
// operation without writing. updateRegistry re-invokes the mutate function on
// retry, so validation has to fail loudly rather than by returning a value.
class ActionError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 400;
  }
}

// Trims, dedupes and drops blanks — but does NOT filter out paths that aren't
// in KNOWN_PAGES. admin.html's "Add a custom page path" control explicitly
// lets an admin stage an arbitrary path (shown with a pencil mark) and save
// it, so filtering by KNOWN_PAGES here silently discarded it on every save:
// the chip would be checked, "Update permissions" would appear to succeed,
// and the saved record would come back without it — reading exactly like the
// save had reverted. The real allowlist enforcement already lives in
// middleware.js (`KNOWN_PAGES.includes(grantPath)`), so a path recorded here
// that isn't on that list still grants no actual access; this only fixes
// what gets persisted.
function sanitizePages(pages) {
  return [...new Set(pages.map(p => String(p).trim()).filter(Boolean))];
}

export default async function handler(req) {
  const auth = await requireAdmin(req);
  if (!auth) return json({ error: 'forbidden' }, 403);
  const { session } = auth;

  if (req.method === 'GET') {
    // requireAdmin() guarantees a registry for every admin now (it fetches it
    // for primary admins), so this is only a defensive fallback.
    const users = (auth.registry && auth.registry.users) || {};
    // The page used to call /api/auth/me purely to render the "Signed in as"
    // line. It already has an authenticated session here, so the name and
    // email ride along on this response and that extra round-trip disappears.
    return json({
      users,
      knownPages: KNOWN_PAGES,
      adminEmails: ADMIN_EMAILS,
      me: { email: session.email, name: session.name || session.email },
    });
  }

  if (req.method === 'POST') {
    if (!sameOrigin(req)) return json({ error: 'origin check failed' }, 403);
    let body;
    try { body = await req.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }

    const { action } = body;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email) return json({ error: 'email is required' }, 400);
    if (isPrimaryAdmin(email)) return json({ error: 'this account is a primary admin (set via ADMIN_EMAILS) and manages itself — nothing to change' }, 400);

    try {
      // One read + one write, version-checked. If a login or another admin tab
      // wrote in between, updateRegistry re-reads and re-applies this same
      // change on top of the newer version instead of overwriting it.
      const user = await updateRegistry(registry => {
        const existing = registry.users[email];

        if (action === 'delete') {
          delete registry.users[email];
          return null;
        }

        if (action === 'add') {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new ActionError('not a valid email address', 400);
          }
          if (!existing) {
            registry.users[email] = {
              name: (typeof body.name === 'string' && body.name.trim()) || email,
              picture: '',
              domain: email.split('@')[1] || '',
              status: 'approved',
              pages: [],
              allPages: false,
              devAccess: false,
              firstLogin: null,
              lastLogin: null,
              addedManually: true,
            };
          }
          return registry.users[email];
        }

        if (!existing) throw new ActionError('user not found', 404);

        switch (action) {
          case 'approve':
            existing.status = 'approved';
            break;
          case 'block':
            existing.status = 'blocked';
            break;
          case 'pending':
            existing.status = 'pending';
            break;
          case 'setPages':
            if (!Array.isArray(body.pages)) throw new ActionError('pages must be an array', 400);
            existing.pages = sanitizePages(body.pages);
            break;
          case 'setAllPages':
            existing.allPages = !!body.allPages;
            break;
          case 'setDevAccess':
            existing.devAccess = !!body.devAccess;
            break;
          case 'updateAccess':
            // One atomic write for the whole permissions panel (pages + allPages +
            // devAccess), so rapid-fire checkbox toggles can't race each other
            // into clobbering one another's save — the UI batches them into one
            // call, and the version check guards the rest.
            if (!Array.isArray(body.pages)) throw new ActionError('pages must be an array', 400);
            existing.pages = sanitizePages(body.pages);
            existing.allPages = !!body.allPages;
            existing.devAccess = !!body.devAccess;
            break;
          case 'makeAdmin':
            existing.role = 'admin';
            break;
          case 'removeAdmin':
            delete existing.role;
            break;
          default:
            throw new ActionError('unknown action', 400);
        }

        return registry.users[email];
      });
      return user ? json({ ok: true, user }) : json({ ok: true });
    } catch (e) {
      if (e instanceof ActionError) return json({ error: e.message }, e.status);
      return json({ error: 'Unable to update the user registry' }, 500);
    }
  }

  return json({ error: 'method not allowed' }, 405);
}
