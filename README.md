<div align="center">

  <h1>🏭 Dashboard One</h1>

  <p><b>Dashboard One — a suite of static dashboards for industrial planning, yard management, and logistics tracking at Jindal Steel Angul (Plate Mill).</b></p>

</div>

---

## 🔗 Live Links

| Environment | URL | Branch |
|---|---|---|
| 🟢 Production | [pmppc.vercel.app](https://pmppc.vercel.app) | `main` |
| 🟡 Development / Preview | [pmppc-dev.vercel.app](https://pmppc-dev.vercel.app) | `dev` |

---

## 🌱 Branching Workflow

**Commit to `dev` only.** All day-to-day work — new tools, fixes, admin panel changes — goes to the `dev` branch, which deploys automatically to `pmppc-dev.vercel.app`. Verify it there first.

`main` (→ `pmppc.vercel.app`) only gets updated by explicitly merging/fast-forwarding from `dev` once changes are confirmed working on the dev URL. Don't push directly to `main`.

---

## 📖 About The Project

**Dashboard One** provides a centralized interface for managing complex industrial operations. Instead of relying on a heavy backend framework, this project uses fast, static HTML pages for dedicated planning tools covering Steel Melting Shop (SMS) heat planning, plate/PSFS tagging, PM Yard management, and rake (railway) logistics.

Access is gated behind Google Workspace SSO: a Vercel Edge Middleware protects every tool page, and the landing page (`index.html`, the **Dashboard One** hub) renders its own login/user menu by checking session state client-side.

---

## 📊 Dashboard Modules

<table width="100%">
  <tr>
    <td width="50%">
      <h3>🏠 Dashboard One</h3>
      <code>index.html</code>
      <p>The central landing page connecting all operational planners and views, with sign-in and user menu.</p>
    </td>
    <td width="50%">
      <h3>🏗️ PM Yard</h3>
      <code>PM-Yard.html</code>
      <p>Dedicated interface for industrial yard management and tracking.</p>
    </td>
  </tr>
  <tr>
    <td>
      <h3>🏷️ PSFS Tagging</h3>
      <code>PSFS_Tagging_Dashboard.html</code>
      <p>Dashboard for monitoring and analyzing PSFS tagging metrics.</p>
    </td>
    <td>
      <h3>🪧 Plate Tagging Tool</h3>
      <code>Plate-Tagging-Tool.html</code>
      <p>Tool for tracking and logging industrial plate tags, with cross-order and external-grade fuzzy matching.</p>
    </td>
  </tr>
  <tr>
    <td>
      <h3>🚆 Rake Planner</h3>
      <code>Rake-Planner.html</code>
      <p>Logistics planner for managing railway rakes, scheduling, and wagon loading.</p>
    </td>
    <td>
      <h3>🔥 SMS Heat Planner</h3>
      <code>SMS-Heat-Planner.html</code>
      <p>The core planner for Steel Melting Shop (SMS) heat operations.</p>
    </td>
  </tr>
  <tr>
    <td>
      <h3>📅 SMS Heat (Daily)</h3>
      <code>SMS Heat Planner Daily.html</code>
      <p>Daily granular tracking for Steel Melting Shop heat cycles.</p>
    </td>
    <td>
      <h3>📆 SMS Heat (Monthly)</h3>
      <code>SMS Heat Planner Monthly.html</code>
      <p>High-level monthly overview and forecasting of SMS heat schedules.</p>
    </td>
  </tr>
</table>

---

## 🔐 Authentication

Access is restricted to specific Google Workspace domains via OAuth:

* `middleware.js` — Vercel Edge Middleware that gates every route except `api/auth/*`, favicons, and the root hub page. Unauthenticated requests to any tool page are redirected to `/api/auth/login`.
* `api/auth/login.js` — redirects the user into the Google OAuth consent flow.
* `api/auth/callback.js` — handles the OAuth callback, validates the account's domain against `ALLOWED_DOMAIN`, and issues a signed session cookie.
* `api/auth/me.js` — returns the current session as JSON (used by the hub's client-side login check and user menu).
* `api/auth/logout.js` — clears the session cookie.
* `api/_session.js` — creates/verifies HMAC-signed session tokens using the Web Crypto API.

Users outside the allowed domain(s) are shown an Access Denied page instead of a session.

---

## 🛠️ Tech Stack & Architecture

* ⚡ **Frontend:** Pure HTML / JS / CSS, no build step or framework.
* ⚙️ **Backend:** Vercel Edge Functions (`api/`), written as ES modules (`export const config = { runtime: 'edge' }`).
* 🔐 **Auth:** Google OAuth 2.0 + Vercel Edge Middleware with HMAC-signed session cookies.
* ☁️ **Hosting:** Vercel (zero-config static + edge functions, no `vercel.json` required).

---

## ⚙️ Environment Variables

Configure these in your Vercel project settings (no `.env.example` is committed):

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | Secret key used to sign/verify session cookies (HMAC). |
| `GOOGLE_CLIENT_ID` | OAuth client ID for Google Sign-In. |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret for Google Sign-In. |
| `ALLOWED_DOMAIN` | Comma-separated list of Google Workspace domains permitted to sign in. |

---

## 🚀 Quick Start

This project has no build step or npm dependencies — it's static HTML plus Vercel Edge Functions.

### 💻 Local Development

1. **Clone the repository**
   ```sh
   git clone https://github.com/abhinandan-ppc/dashboard-one.git
   cd dashboard-one
   ```

2. **Set environment variables** (see table above) in a `.env.local` file or your Vercel project settings.

3. **Run with the Vercel CLI** to exercise auth middleware and edge functions locally:
   ```sh
   npm i -g vercel
   vercel dev
   ```

### ☁️ Deployment

Push to the connected branch — Vercel builds and deploys automatically (no CI/CD workflow files needed; the previous GitHub Pages workflow has been removed).
