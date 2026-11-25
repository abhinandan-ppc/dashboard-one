# Auto BTR / BTP online deployment

## Components

- `Auto-BTP.html` and `auto-btp.js`: standalone dashboard, live activity, history,
  local output downloads, enrollment, encrypted account changes and scheduling.
- `api/automation.js`: existing Google-session/explicit page-grant authorization;
  administrator checks for PC, credential, setup and schedule management.
- `worker.mjs`: Cloudflare SQLite Durable Object, outbound agent WebSockets,
  expiring browser tickets, global run reservation and durable command delivery.
- `D:\Auto BTP_VBS\online-agent`: Windows agent, installer and local tests.

Files/full logs are stored only on execution PCs. The relay forwards requested
chunks in memory. Run metadata and encrypted pending account updates are persisted
in Cloudflare. The page requires the originating PC online for logs/downloads.

## Deploy to your free Cloudflare account

For the existing `dashboard-one-automation-dev` relay, deploy with its dedicated
configuration (PowerShell):

    $env:NODE_USE_SYSTEM_CA='1'
    npx wrangler deploy --config wrangler.dev.jsonc

This preserves `POOL_NAME=development`, which selects the existing enrolled-PC
state. Using only `--name dashboard-one-automation-dev` with the default config
omits that variable and opens a different, empty pool. Do not re-enroll hosts to
repair a pool-name mismatch. The system CA setting enables the Windows trust
store without disabling TLS certificate verification.

From this directory:

    npx wrangler login
    npx wrangler secret put RELAY_SECRET
    npx wrangler deploy

Use a randomly generated secret of at least 32 bytes. Configure the same value as
`AUTOMATION_RELAY_SECRET` in the Dashboard-One Vercel project; set
`AUTOMATION_RELAY_URL` to the Worker HTTPS URL. Never put the secret in frontend
JavaScript, a tracked file, or a PC enrollment command.

Use distinct Worker names/pool names and device enrollments for development and
production. Never enroll the same workflow folder in two pools. The default
configuration names the production pool; for the first pilot change the Worker
name and set `POOL_NAME=development` in the development deployment configuration.

Deploy the Dashboard-One `dev` branch first. Grant the new Auto-BTP.html page
explicitly to approved operators. Administrators have access automatically;
generic all-pages grants alone do not authorize API operations. Validate before
promoting to main. No paid services are required or automatically enabled.

## Enroll PCs

Use Enroll PC on the dashboard and run the local `online-agent/install.ps1` with
the Worker URL and one-time enrollment code. Codes expire after ten minutes.
The agent is automatically started at Windows logon. Its device secret/private
key are encrypted for that Windows account. Never copy agent data between PCs.

Run readiness requires an unlocked interactive desktop, no personal SAP/Excel
processes, required local files, compatible script version, the chosen account,
and no pending maintenance/account update. The least-recently-used ready PC is
selected. Requests fail immediately if none is ready; there is no manual queue.

## Recovery and operations

- Closing a browser does not cancel execution. Network loss retains the run
  reservation; the local journal reconciles on reconnection.
- Stop is delivered to the owning PC. Do not assume a disconnected PC stopped.
  Admin resolution requires explicit confirmation that execution has stopped.
- Resume stays on the original PC. Starting fresh requires an explicit choice
  when the previous run has a checkpoint.
- Account updates are encrypted in the browser for every PC. A PC is excluded
  until its update is acknowledged. Passwords are never read back.
- Daily scheduling uses IST. If no PC is ready, record a missed run without
  catch-up. Disable the old per-PC Windows workflow schedules during enrollment.
- For an ordered daily schedule, a failed run waits five minutes before
  starting the entire workflow fresh on the same PC. It has up to three such
  retries per PC; after the third retry fails, it waits five minutes before
  moving to the next listed PC. A disconnected host still fails over after
  its existing five-minute connection timeout and may still be running. A
  manual run started during a retry wait is never stopped or replaced.
- Old single schedules keep their original behavior until an administrator
  opens Daily schedules and saves a PC priority list.
- Local snapshots expire after seven days. Normal working outputs are preserved.
- Keep within Workers Free quotas. Quota exhaustion is an outage, not permission
  to start a second workflow elsewhere or automatically upgrade the account.

## Verification performed locally

    node --test automation-relay/coordinator.test.mjs automation-relay/worker.test.mjs
    npx wrangler deploy --dry-run

Ten coordinator/relay tests cover duplicate delivery, simultaneous claims,
disconnects, pending credential changes, unauthorized access and checkpoint
ownership. Six Windows-agent tests cover DPAPI, journaling, file allowlists,
expiry, traversal prevention and simulated execution/output collection. Browser
checks cover 18 stages, desktop/mobile overflow and client errors.

The Cloudflare bundle passes dry-run validation. Cloudflare authentication,
Vercel environment setup, real network WebSocket connectivity, enrollment on
other PCs, and an observed SAP/Excel run remain deployment acceptance checks.
Do not interpret simulated process tests as verification of SAP/Excel behavior.
