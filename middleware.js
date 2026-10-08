import { verifySession, readCookie } from './api/_session.js';
import { resolveAccess, DEV_HOSTS, CHILD_PAGE_PARENTS, KNOWN_PAGES } from './api/_acl.js';

// The root page and index.html render unauthenticated too — they show their
// own login box and call /api/auth/me client-side. Every other page (the
// actual tools and admin.html) stays gated by this middleware.
//
// The exclusions all skip the ACL check, not authentication per se, so they
// are deliberately limited to paths that either carry no user data or
// re-check admin status themselves:
//
//   api/admin/*      — every handler runs requireAdmin() first, so a second
//                      check here was pure duplicate Blob traffic.
//   theme-boot.js    — this was a real bug. It is not a "known page", so a
//                      non-admin got the HTML "Access pending" page served in
//                      place of the script, breaking theme loading on every
//                      tool page for ordinary users.
//   static assets    — .js/.css/.png/.svg/.woff2 hold no user data. Gating
//                      them cost a Blob read apiece on every page load and
//                      broke the same way theme-boot.js did.
export const config = {
  matcher: [
    '/((?!api/auth|api/admin/|theme-boot\\.js|favicon\\.|.*\\.(?:js|css|png|svg|woff2)|index\\.html|$).*)',
  ],
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
}

function denyPage(title, message, status) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
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
    const url = new URL(req.url);
    let path = url.pathname.replace(/^\//, '');
    try { path = decodeURIComponent(path); } catch { /* keep raw path if malformed */ }

    // Allow AI API routes through without session check — they do their own auth
    if (path.startsWith('api/ai/')) {
      return;
    }

    const token = readCookie(req, 'session');
    const session = await verifySession(token);

    if (!session) {
      const loginUrl = new URL('/api/auth/login', url);
      loginUrl.searchParams.set('next', url.pathname + url.search);
      return Response.redirect(loginUrl.toString(), 302);
    }

    const email = session.email;
    const isAdminArea = path === 'admin.html' || path.startsWith('api/admin/');

    let admin = false, user = null;
    try {
      ({ admin, user } = await resolveAccess(email));
    } catch {
      admin = false; user = null;
    }

    if (admin) return; // admins (env-configured or promoted) have full access everywhere, including dev previews

    if (path === 'api/ebtp-proxy' || path === 'api/zstk-proxy' || path === 'api/autobtr-proxy') {
      // Shared live-data proxies used by Rake-Planner, Order-Status-Report,
      // VDO-Generator (EBTP) and PM-Yard / Plate-Tagging-Tool (ZSTK, AutoBTR).
      // Any authenticated user may call them — the page-level ACL below
      // already gates access to those tools themselves. Without this, a
      // non-admin gets the HTML "Access pending" deny page here, and the
      // caller's r.json() blows up with "Unexpected token '<' …".
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
