# Dashboard One

Industrial planning, yard management and logistics dashboards for Jindal Steel Angul (Plate Mill).

## Environments and branches

| Environment | URL | Branch |
| --- | --- | --- |
| Production | https://pmppc.vercel.app | `main` |
| Development | https://pmppc-dev.vercel.app | `dev` |

Commit day-to-day work to `dev`. Review the development deployment before promoting it to production. Promote changes by merging `dev` into `main`; do not force-push or rewrite shared history. Pushing a connected branch triggers its configured Vercel deployment.

## Dashboards

| Page | Purpose |
| --- | --- |
| `index.html` | Hub, authentication, shared theme controls and sheet synchronization |
| `PM-Yard.html` | Yard visualization, inventory summaries and management controls |
| `Rake-Planner.html` | Rake prediction, order details, planning and wagon loading |
| `Truck-Dashboard.html` | Truck logistics and order tracking |
| `Plate-Tracker.html` | Plate tracking and workbook-based stock views |
| `Plate-Tagging-Tool.html` | Plate tagging and order/grade matching |
| `Order-Status-Report.html` | Order status reporting |
| `Grade-Clubbing-Matrix.html` | Grade compatibility and clubbing |
| `SMS-Heat-Planner.html` | SMS heat planning |
| `SMS Heat Planner Daily.html` | Daily heat planning |
| `SMS Heat Planner Monthly.html` | Monthly heat planning |
| `VDO-Generator.html` | VDO generation |
| `admin.html` | Access administration |

## Latest interface updates

- Refreshing an open dashboard targets its configured sheet dependencies instead of refreshing every source.
- Shared edge overscroll stretches the scrollable content and returns it to rest.
- Rake Predictor separates regions into their own sections, with adaptive siding-card columns and larger rake names.
- Plan, AI, Map and Excel share one segmented pill with dividers.
- Order details uses an integrated card footer with a matching separator and visible keyboard focus.
- Classic and Neomorph use IBM Plex Sans with monospaced technical figures, quiet surfaces and consistent controls. Modern retains its product-sans styling.
- Dashboard labels use text instead of decorative emojis. Cursor glow, card tilt and the hub startup animation have been removed.
- PM Yard inventory readouts remain flat instead of receiving generic card glow/tilt. Classic and Neomorph menus use opaque surfaces and theme-specific controls.
- PM Yard's Modern (Glassmorphism) menus retain translucent backgrounds and backdrop blur; opaque overrides are scoped to Classic and Neomorph.

Theme styling is shared through `theme.css` and initialized by `theme-boot.js`. Edge overscroll lives in `edge-stretch.js`. See `DESIGN-CONTEXT.md` and the theme-specific design documents before changing presentation.

## Architecture

The frontend consists of standalone HTML pages and shared JavaScript/CSS. Some pages, including Rake Planner, use browser-loaded React and Babel; there is no frontend build step.

Server-side routes live in `api/`, with Google OAuth and session handling in `api/auth/` and `api/_session.js`. `middleware.js` protects routes, while the hub checks the session to show its sign-in/user menu. Access policies also depend on the configured domain and application permissions.

`package.json` requires Node.js 18 or newer and declares `@vercel/functions`. It currently defines no npm scripts.

## Configuration

Set secrets in the deployment environment or an ignored local environment file. Never commit credentials.

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Session-cookie signing |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `ALLOWED_DOMAIN` | Allowed Google Workspace domains |
| `SHEETS_SA_CLIENT_EMAIL`, `SHEETS_SA_PRIVATE_KEY` | Google Sheets service-account access |
| `ADMIN_EMAILS` | Access administrators |
| `BLOB_READ_WRITE_TOKEN` | Access-registry storage |
| `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GOOGLE_SA_IMPERSONATE` | Directory integration, when enabled |

AI routes have additional `OMNIROUTE_*` settings; configure them only when using that integration. See the relevant files in `api/` for feature-specific settings.

## Local development

For a fresh checkout:

```sh
git clone https://github.com/abhinandan-ppc/dashboard-one.git
cd dashboard-one
npm install
npx vercel dev
```

Configure the required environment variables before testing authentication or live data. Static preview alone cannot serve API routes.

This working environment also supports VS Code Live Preview at `http://127.0.0.1:3000` with the local API helper on port `3100`. If the ignored helper and its credentials have been provisioned locally, start it with:

```sh
node local-auth.mjs
```

`dashboard-api-url.js` routes localhost API requests to `http://127.0.0.1:3100`. Verify data loading through the Live Preview page, not just the API endpoint. The helper is not included in a fresh clone; use Vercel local development or obtain the approved local tooling. There is no `npm run dev` script.

## Verification and repository scope

Before release, check all three themes in light and dark modes at mobile and desktop widths. Exercise sheet refresh, Rake Predictor region layout, details search/close, combine selection, keyboard focus and PM Yard menus.

Local diagnostics and fixtures are intentionally ignored and are not shipped with this repository. The current checkout has no tracked CI workflow or npm test script; do not assume an automated deployment gate exists. The latest local Rake Predictor run passed 12 theme/viewport combinations. The broader responsive suite passed 65 of 66 checks, with an unresolved PM Yard KPI styling assertion.

The repository tracks application runtime, API code, this README, the design-context documents and the skills lockfile. Keep `.env*`, service-account keys, production workbooks, local tools and screenshot artifacts out of commits. `skills-lock.json` records agent-skill sources; the installed `.agents/` directory remains local.
