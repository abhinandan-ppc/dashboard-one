import { readCookie, verifySession } from '../_session.js';
import { isPrimaryAdmin, resolveAccess, updateRegistry, KNOWN_PAGES, ADMIN_EMAILS } from '../_acl.js';

export const config = { runtime: 'edge' };

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
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
  return { session, registry };
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

export default async function handler(req) {
  const auth = await requireAdmin(req);
  if (!auth) return json({ error: 'forbidden' }, 403);
  const { session } = auth;

  if (req.method === 'GET') {
    // auth.registry is null only for a primary admin (ADMIN_EMAILS), who is
    // never stored in the registry at all.
    const users = auth.registry ? auth.registry.users : {};
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
            existing.pages = [...new Set(body.pages.filter(p => KNOWN_PAGES.includes(p)).map(p => p.trim()))];
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
            existing.pages = [...new Set(body.pages.filter(p => KNOWN_PAGES.includes(p)).map(p => p.trim()))];
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
