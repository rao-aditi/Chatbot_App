# Chatbot_App
## Support dashboard access (local + production)

The dashboard has no login UI and nothing to paste.

```
browser --GET /api/admin-token--> dashboard host (Vite dev middleware / Vercel function)
                                   | POST /api/admin/session  + x-admin-key: ADMIN_DASHBOARD_KEY
                                   v
                                 chat server --> short-lived signed token (role=admin, aud=dashboard)
browser --Socket.IO auth.token--> chat server (verifies signature with CHAT_AUTH_SECRET)
```

- `ADMIN_DASHBOARD_KEY` lives only on the chat server and on the dashboard host's
  server-side env. It is not `VITE_`-prefixed, so it is never bundled.
- Admin status is granted only by a verified token with `role=admin` **and**
  `aud=dashboard`. `?isAdmin=true` and OfficeGST customer tokens do nothing.
- The browser fetches a fresh token on every (re)connect; retries back off 5s→60s.
- **The dashboard deployment is the access gate**: anyone who can load it can open
  the dashboard. Turn on Vercel Deployment Protection for it (below).

### Environment variables
| Where | Variable | Notes |
|---|---|---|
| Chat server (local `.env` / Render) | `CHAT_AUTH_SECRET` | same value OfficeGST uses |
| | `ADMIN_DASHBOARD_KEY` | 32+ random chars |
| | `CLIENT_ORIGIN` | comma-separated: dashboard origin **and the OfficeGST frontend origin(s)** |
| | `NODE_ENV=production` | enforces CORS allow-list; refuses sockets if no `CHAT_AUTH_SECRET` |
| Dashboard (local `client/.env` / Vercel) | `VITE_SERVER_URL` | `https://<service>.onrender.com` (browser-visible) |
| | `ADMIN_DASHBOARD_KEY` | identical to the server's; server-side only |

Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### Deploy
1. Render (chat server): set the variables above, redeploy, confirm the log shows
   no `[admin]`/`[auth]` warnings and lists the expected `[cors]` origins.
2. Vercel (dashboard project, root = `client`): set `VITE_SERVER_URL` and
   `ADMIN_DASHBOARD_KEY`, enable **Deployment Protection** (Settings → Deployment
   Protection) so only your team can open it, then redeploy.
3. Open the Vercel URL: the status line should read "Dashboard Connected". If not,
   the sidebar shows the reason (missing key, key mismatch, server unreachable).

`npm run admin-token` (server) still mints a dashboard token for manual use.
