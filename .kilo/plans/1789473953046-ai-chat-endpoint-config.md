# AI-Chat Endpoint Configuration Plan

## Goal
Configure the AI-Chat feature to work by setting up the required environment variables in Vercel for the OmniRoute API endpoints.

## Root Cause
The AI-Chat is not working because the required environment variables for the OmniRoute API are missing:
- `OMNIROUTE_KEY` - API key for OmniRoute
- `OMNIROUTE_URL_CLOUDFLARE` - Cloudflare tunnel endpoint
- `OMNIROUTE_URL_NGROK` - Ngrok tunnel endpoint
- `OMNIROUTE_URL_INTRANET` - Local/intranet endpoint
- `SESSION_SECRET` - For JWT session signing
- `BLOB_READ_WRITE_TOKEN` - For user registry (Vercel Blob)

## Endpoint Mapping
| Code Endpoint | URL |
|--------------|-----|
| `cloudflare` | `https://madonna-bowl-greatest-code.trycloudflare.com/v1` |
| `ngrok` | `https://traffic-appetite-relay.ngrok-free.dev/v1` |
| `intranet` | `http://localhost:20128/v1` (mapped from "Local") |

## Implementation Steps

### 1. Generate SESSION_SECRET
Create a cryptographically secure 32-character random string:
```bash
# PowerShell
[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

### 2. Create Vercel Blob Store
1. Go to Vercel Dashboard → Storage → Create Database → Blob
2. Name it (e.g., `jspl-hub-blob`)
3. Copy the `BLOB_READ_WRITE_TOKEN`

### 3. Configure Environment Variables in Vercel
Go to Vercel Dashboard → Project Settings → Environment Variables and add:

| Variable | Value | Environment |
|----------|-------|-------------|
| `OMNIROUTE_KEY` | `sk-61be4b16598dca09-9b9c27-5ae47255` | Production, Preview, Development |
| `OMNIROUTE_URL_CLOUDFLARE` | `https://madonna-bowl-greatest-code.trycloudflare.com/v1` | All |
| `OMNIROUTE_URL_NGROK` | `https://traffic-appetite-relay.ngrok-free.dev/v1` | All |
| `OMNIROUTE_URL_INTRANET` | `http://localhost:20128/v1` | Development only (won't work in production) |
| `SESSION_SECRET` | `<generated-32-char-string>` | All |
| `BLOB_READ_WRITE_TOKEN` | `<from-vercel-blob>` | All |

### 4. Redeploy
Trigger a new deployment after adding environment variables:
- Push a commit, or
- Use Vercel CLI: `vercel --prod`

## Validation Steps

1. **Verify env vars loaded**: Check Vercel function logs show no "AI gateway is not configured" errors
2. **Test connection status**: Open AI-Chat.html - connection indicator should show "Connected" (green dot)
3. **Test model loading**: Model selector should populate with categories
4. **Test chat**: Send a message and verify streaming response works

## Expected Behavior After Fix

- Connection status indicator: Green "Connected" when any endpoint responds
- Endpoint selector (hover on status): Shows Intranet, Ngrok, Cloudflare options
- Model selector: Loads categories from `/api/ai/models?endpoint=cloudflare`
- Chat: Streams responses via SSE from OmniRoute `/chat/completions`

## Notes

- `OMNIROUTE_URL_INTRANET` only works locally; in production it will fail but the fallback logic in `chat.js:145` tries other endpoints
- Admin access required: The chat API is restricted to admins (`api/_acl.js:79` includes `AI-Chat.html`)
- Default admin email: `abhinandan.mandal@jindalsteel.in` (from `ADMIN_EMAILS` env var)

## Additional Fix: CSS Leak Prevention

The inline `<style>` block in `AI-Chat.html` (lines 175-188) contains a rule `#hubFrameHeaderSlot button` that targets buttons in the parent hub's header slot. This rule uses `!important` to override inline styles and affects **all embedded pages** that use `#hubFrameHeaderSlot`, not just AI-Chat. In production, this causes random model/category text on other pages to be silently hidden.

**Fix**: Wrap the entire block in `@media (max-width: 0) { ... }` (never matches) to disable it in AI-Chat, OR move the rule to the parent hub's CSS where it belongs. Since the hub is a separate deployment, the safest immediate fix is to comment out or disable the block in AI-Chat.html and note that the hub should own this styling.

```html
<!-- AI-Chat.html lines 175-188: DISABLED — belongs in hub CSS, not embedded page -->
<!--
.hdr-r button {
  transform: translateY(0) scale(1);
  ...
}
#hubFrameHeaderSlot button {
  width: 40px !important; height: 40px !important; ...
}
#hubFrameHeaderSlot button img {
  width: 100% !important; height: 100% !important; ...
}
.hdr-r button svg { ... }
-->
```

This prevents the embedded page from leaking styles into its parent frame.