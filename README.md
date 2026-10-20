# Chatbot_App
## Admin dashboard access (local development)

The AdminDashboard opens directly, with no login or pasted token. With
`ADMIN_DEV_ACCESS=true` in `server/.env` (and `NODE_ENV` not `production`), the
server serves a 10-minute admin JWT at `GET /api/admin/dev-token` to loopback
requests only (localhost Host and Origin). The dashboard fetches a fresh one on
every (re)connect, and the socket still goes through the normal
`CHAT_AUTH_SECRET` verification. In production the endpoint returns 404; use
`npm run admin-token` there until a real admin login exists.
