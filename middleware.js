import { verifySession, readCookie } from './api/_session.js';
import { resolveAccess, DEV_HOSTS, CHILD_PAGE_PARENTS, KNOWN_PAGES } from './api/_acl.js';

// The root page and index.html render unauthenticated too — they show their
// own login box and call /api/auth/me client-side. Every other page (the
// actual tools, admin.html, and the admin API) stays gated by this middleware.
export const config = {
  matcher: ['/((?!api/auth|favicon.ico|favicon.png|theme.css|index.html|$).*)'],
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
}

function denyPage(title, message, status) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: 'DM Sans', system-ui, -apple-system, Segoe UI, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; }
  .card { max-width: 420px; width: 100%; background: rgba(30,41,59,0.75); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 22px; padding: 36px 32px; text-align: center; box-shadow: 0 10px 40px rgba(2,6,23,0.4); }
  h1 { font-size: 19px; margin: 0 0 12px; color: #f87171; }
  p { font-size: 13.5px; color: #94a3b8; line-height: 1.6; margin: 0 0 10px; }
  a { display: inline-block; margin-top: 18px; padding: 10px 20px; border-radius: 999px; background: #8dcdff;
    color: #00344f; font-weight: 700; font-size: 13px; text-decoration: none; }
</style></head>
<body>
  <div class="card">
    <h1>${esc(title)}</h1>
    <p>${esc(message)}</p>
    <a href="/">Back to hub</a>
  </div>
</body></html>`;
  return new Response(html, { status: status || 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export default async function middleware(req) {
  try {
    const token = readCookie(req, 'session');
    const session = await verifySession(token);
    const url = new URL(req.url);

    if (!session) {
      const loginUrl = new URL('/api/auth/login', url);
      loginUrl.searchParams.set('next', url.pathname + url.search);
      return Response.redirect(loginUrl.toString(), 302);
    }

    const email = session.email;
    let path = url.pathname.replace(/^\//, '');
    try { path = decodeURIComponent(path); } catch { /* keep raw path if malformed */ }
    const isAdminArea = path === 'admin.html' || path.startsWith('api/admin/');

    let admin = false, user = null;
    try {
      ({ admin, user } = await resolveAccess(email));
    } catch {
      admin = false; user = null;
    }

    if (admin) return; // admins (env-configured or promoted) have full access everywhere, including dev previews

    if (path === 'api/ebtp-proxy') {
      // Shared live-data proxy used by Rake-Planner, Order-Status-Report and
      // VDO-Generator. Any authenticated user may call it — the page-level
      // ACL below already gates access to those tools themselves.
      return;
    }

    if (path.startsWith('api/ai/')) {
      // AI chat and endpoint routes have their own auth + admin checks
      // inside chat.js / endpoint.js. Let authenticated users through so
      // the handler can return proper JSON errors instead of HTML deny pages.
      return;
    }

    if (isAdminArea) {
      return denyPage('Admins only', "This area is restricted to administrators.");
    }

    if (DEV_HOSTS.includes(url.hostname)) {
      const devOk = !!(user && user.status === 'approved' && user.devAccess);
      if (!devOk) {
        return denyPage('Preview access restricted', "You don't have access to this preview deployment yet. Ask the administrator to grant dev access.");
      }
    }

    const grantPath = CHILD_PAGE_PARENTS[path] || path;
    const knownPage = KNOWN_PAGES.includes(grantPath);
    const allowed = !!(user && user.status === 'approved' && knownPage && (user.allPages || (user.pages || []).includes(grantPath)));
    if (!allowed) {
      return denyPage('Access pending', "Your account is registered but doesn't have access to this page yet. Ask the administrator to approve it.");
    }
  } catch (e) {
    return denyPage('Something went wrong', 'Unexpected error while checking access: ' + (e && e.message ? e.message : String(e)), 500);
  }
}
