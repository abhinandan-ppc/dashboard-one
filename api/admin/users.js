import { readCookie, verifySession } from '../../lib/_session.js';
import { isPrimaryAdmin, resolveAccess, getRegistry, saveRegistry, KNOWN_PAGES, ADMIN_EMAILS } from '../../lib/_acl.js';

export const config = { runtime: 'edge' };

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function requireAdmin(req) {
  const session = await verifySession(readCookie(req, 'session'));
  if (!session) return null;
  const { admin } = await resolveAccess(session.email);
  return admin ? session : null;
}

export default async function handler(req) {
  const session = await requireAdmin(req);
  if (!session) return json({ error: 'forbidden' }, 403);

  if (req.method === 'GET') {
    try {
      const registry = await getRegistry();
      return json({ users: registry.users, knownPages: KNOWN_PAGES, adminEmails: ADMIN_EMAILS });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }

    const { action } = body;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email) return json({ error: 'email is required' }, 400);
    if (isPrimaryAdmin(email)) return json({ error: 'this account is a primary admin (set via ADMIN_EMAILS) and manages itself — nothing to change' }, 400);

    try {
      const registry = await getRegistry();
      let user = registry.users[email];

      if (action === 'delete') {
        delete registry.users[email];
        await saveRegistry(registry);
        return json({ ok: true });
      }

      if (action === 'add') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'not a valid email address' }, 400);
        if (!user) {
          user = registry.users[email] = {
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
        await saveRegistry(registry);
        return json({ ok: true, user: registry.users[email] });
      }

      if (!user) return json({ error: 'user not found' }, 404);

      switch (action) {
        case 'approve':
          user.status = 'approved';
          break;
        case 'block':
          user.status = 'blocked';
          break;
        case 'pending':
          user.status = 'pending';
          break;
        case 'setPages':
          if (!Array.isArray(body.pages)) return json({ error: 'pages must be an array' }, 400);
          user.pages = [...new Set(body.pages.filter(p => typeof p === 'string' && p.trim()).map(p => p.trim()))];
          break;
        case 'setAllPages':
          user.allPages = !!body.allPages;
          break;
        case 'setDevAccess':
          user.devAccess = !!body.devAccess;
          break;
        case 'updateAccess':
          // One atomic write for the whole permissions panel (pages + allPages +
          // devAccess), so rapid-fire checkbox toggles can't race each other into
          // clobbering one another's save — the UI batches them into one call.
          if (!Array.isArray(body.pages)) return json({ error: 'pages must be an array' }, 400);
          user.pages = [...new Set(body.pages.filter(p => typeof p === 'string' && p.trim()).map(p => p.trim()))];
          user.allPages = !!body.allPages;
          user.devAccess = !!body.devAccess;
          break;
        case 'makeAdmin':
          user.role = 'admin';
          break;
        case 'removeAdmin':
          delete user.role;
          break;
        default:
          return json({ error: 'unknown action' }, 400);
      }

      await saveRegistry(registry);
      return json({ ok: true, user: registry.users[email] });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({ error: 'method not allowed' }, 405);
}
