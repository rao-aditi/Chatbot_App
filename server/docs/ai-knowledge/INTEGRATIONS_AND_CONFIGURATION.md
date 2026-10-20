# Integrations and Configuration

> Only environment-variable **names** are listed — never values. Source of names: `backend/.env.example` (all documented there) plus a code search of `process.env.*` / `import.meta.env.*`.
> Related: [BACKEND_DOCUMENTATION.md](BACKEND_DOCUMENTATION.md), [AUTHENTICATION_AND_PERMISSIONS.md](AUTHENTICATION_AND_PERMISSIONS.md), [ERROR_HANDLING_AND_TROUBLESHOOTING.md](ERROR_HANDLING_AND_TROUBLESHOOTING.md).

## 1. Backend environment variables (`backend/.env`, template `backend/.env.example`)

| Variable | Used in | Purpose / default |
|---|---|---|
| `PORT` | `server.js` | listen port; host-assigned on cPanel/Passenger; local fallback **5001** |
| `NODE_ENV` | many | `production` → secure refresh cookie; `development` → error `stack` in responses; password-reset link printed to console only when not production |
| `CORS_ORIGINS` | `server.js` | comma-separated allowed origins (no trailing slash). Unset → built-in dev list (localhost 5173/5174, dev tunnels, Vercel URL, `outstripinfotech.com`). Applies to REST **and** Socket.IO |
| `DATABASE_URL` | `shared/prisma.js`, `prisma.config.js` | PostgreSQL connection string. `connection_limit` is appended (default 5, `PRISMA_CONNECTION_LIMIT`) unless already present |
| `PRISMA_CONNECTION_LIMIT` | `shared/prisma.js` | per-process pool cap (default 5; shared Supabase pooler ≈15 connections total) |
| `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES_IN` | `jwt.utils.js` | staff access token (default expiry `2d`) |
| `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN` | `jwt.utils.js` | staff refresh token (default `7d`) |
| `JWT_CLIENT_ACCESS_SECRET`, `JWT_CLIENT_ACCESS_EXPIRES_IN` | `jwt.utils.js` | Client Portal access (default `1d`) |
| `JWT_CLIENT_REFRESH_SECRET`, `JWT_CLIENT_REFRESH_EXPIRES_IN` | `jwt.utils.js` | Client Portal refresh (default `7d`) |
| `GST_STANDALONE_ACCESS_SECRET`, `GST_STANDALONE_ACCESS_EXPIRES_IN` | `jwt.utils.js` | standalone GST access (default `2d`) |
| `GST_STANDALONE_REFRESH_SECRET`, `GST_STANDALONE_REFRESH_EXPIRES_IN` | `jwt.utils.js` | standalone GST refresh (default `7d`) |
| `BCRYPT_SALT_ROUNDS` | auth/user services | default **12** |
| `FRONTEND_URL` | `passwordReset.service.js`, `GoogleDrive/googleDrive.controller.js` | bare origin used to build e-mail links (`/reset-password`, GST reset path) and OAuth redirects (`/profile?driveConnected=true`, `/appointments?calendarConnected=true`); default `http://localhost:5173` |
| `CLIENT_PORTAL_LOGIN_URL` | `Client/clientPortal.service.js`, templates | full client-portal login URL used in the credentials e-mail; default `http://localhost:5173/client-portal/login` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `auth.service.js`, `googleDrive.service.js`, `googleMeet.service.js` | Google OAuth app |
| `GOOGLE_REDIRECT_URI` | Drive OAuth | must point at `/api/google-drive/callback` on the backend |
| `GOOGLE_CALENDAR_REDIRECT_URI` | `googleMeet.service.js` | falls back to `GOOGLE_REDIRECT_URI` (same callback, distinguished by JWT `purpose`) |
| `VONAGE_APPLICATION_ID`, `VONAGE_PRIVATE_KEY_PATH`, `VONAGE_WHATSAPP_FROM`, `VONAGE_API_BASE_URL` | `whatsapp.service.js` | WhatsApp via Vonage Messages API; private key is read from a file path (key file is `.gitignore`d as `private.key`); base URL default `https://api.nexmo.com` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | `mailer.service.js` | SMTP; port default 587; `SMTP_SECURE="true"` for TLS. `SMTP_FROM_NAME` (not in `.env.example`) sets the display name (default "Office Management"). Missing host/user/pass → e-mails skipped with a one-time warning |
| `X_API_KEY` | `gst/accounting/*` | sent as header `x-api-key` to the external accounting-software API |
| `PRIVATE_UPLOAD_DIR` | `TaskWorkflow/taskFiles.js` | absolute path for private task files (default `backend/private_uploads`) |
| `GST_IMPORT_CONCURRENCY` | `gst/utils/importRunner.js` | concurrent row inserts during imports (default 4); **not** in `.env.example` |
| `GST_SOFTWARE_LAUNCH_URL`, `TDS_SOFTWARE_LAUNCH_URL`, `ROC_SOFTWARE_LAUNCH_URL`, `DSC_SOFTWARE_LAUNCH_URL` | `prisma/seed-marketplace.js` only | optional `Software.launchUrl` at seed time; not in `.env.example` |

Notes:
- `.env` is gitignored; if a JWT secret is missing the code falls back to a built-in dev secret and logs an INSECURE warning.
- A bare `JWT_SECRET` is not read anywhere.
- cPanel: set variables in "Setup Node.js App → Environment Variables"; `trust proxy` is on (`app.set("trust proxy", 1)`).

## 2. Frontend environment variables (`frontend/.env`, not tracked)
`VITE_API_URL` (backend base URL; default `http://localhost:5001`), `VITE_GOOGLE_CLIENT_ID` (Google sign-in button). Vite also provides `BASE_URL` and `DEV`.

## 3. External integrations

| Integration | Where | What it does | Config |
|---|---|---|---|
| **PostgreSQL / Supabase pooler** | Prisma | primary datastore | `DATABASE_URL` |
| **Google OAuth sign-in** | `auth.service.googleAuth`, `components/ui/GoogleAuthButton.jsx` | login/signup with Google (code flow, `redirect_uri="postmessage"`) | `GOOGLE_CLIENT_ID/SECRET`, `VITE_GOOGLE_CLIENT_ID` |
| **Google Drive** | `GoogleDrive/googleDrive.service.js`, `Documents.service.js` | per-user OAuth (scope `drive.file`); uploads to root folder **"Office GST Documents"** with sub-folders `Invoice Documents`, `Client Documents`, `Task Documents`, `Other Documents` (selected by `resolveFolderType`: task > invoice > client > default); optional per-record sub-folder; download/delete/list; tokens stored in `User.googleDrive*` | Google vars; connect via `GET /api/google-drive/auth-url` |
| **Google Calendar / Meet** | `Communication/googleMeet.service.js` | per-user OAuth with scopes `calendar.events`, `calendar.readonly`; creates/patches/deletes events on the `primary` calendar with a Meet link when `generateMeetLink` is true; tokens in `User.googleCalendar*` | `GOOGLE_CALENDAR_REDIRECT_URI` |
| **SMTP e-mail** | `shared/services/mailer.service.js` + `templates/*` | task assigned/submitted/decision, due reminders, password reset, client portal credentials, document requests, appointment notices | SMTP vars |
| **WhatsApp (Vonage)** | `shared/services/whatsapp.service.js` | template/text messages (e.g. template `task_assigned_dynamic`); delivery callbacks to `POST /api/whatsapp/status`; inbound webhook `POST /api/whatsapp/inbound` just logs; script `templates/create-whatsapp-template.js` | Vonage vars |
| **Accounting software partner API** | `gst/accounting/*` | list companies, access requests, pull monthly GSTR-1 data (header `x-api-key`) | `X_API_KEY`; **base URLs hard-coded** (ngrok tunnel) in `accountingCompanies.service.js` and `gstr1Import/accountingReportsClient.js` |
| **DSC tool (external web app)** | `softwareAccess.service.launchTargetFor` | launching DSC opens `https://dsc-tool-web.vercel.app/` | hard-coded |
| **Socket.IO** | `server.js` | import progress rooms | CORS list |
| **node-cron** | `TaskRemainder_Scheduler.js`, `accountingRequestScheduler.js` | background jobs | — |
| **Razorpay** | schema defaults only (`SoftwareSubscription.provider "RAZORPAY"`) | **not integrated** | — |

## 4. Deployment & runtime configuration
- Backend scripts: `npm run dev` (nodemon), `npm start`, `postinstall` runs `prisma generate`, `npm run migrate:deploy`, seeds (`seed:permission`, `seed:software`, `seed:admin`, `seed:marketplace`; `seed:rbac` points to a missing file).
- Prisma binary targets: `native` and `debian-openssl-3.0.x` (for Linux hosting). Generated client outputs are gitignored.
- Frontend: `npm run dev` (Vite; `host: true`, allowed ngrok host), `npm run build`, `npm run preview`, `npm run lint`; `frontend/vercel.json` rewrites all paths to `/index.html` (SPA). `frontend/dist/` exists locally but is a build output.
- Health check: `GET /health`.
- Static files: only `/uploads/software`. `backend/uploads/client-portal/**` and `private_uploads/**` are never served statically.
- Rate limiting: `express-rate-limit` (in-memory, per process; `trust proxy` set so client IP comes from the proxy).
- Multi-process hosting caveat: Socket.IO rooms, import-progress store and all TTL caches are per-process (the code documents polling as the fallback).

## 5. Dependency summary (versions from `package.json`)
Backend: express ^5.2.1, @prisma/client/prisma ^6.16.2, jsonwebtoken ^9.0.3, bcryptjs ^3.0.3, zod ^4.4.3, express-validator ^7.3.2, socket.io ^4.8.3, node-cron ^4.2.1, nodemailer ^9.1.1, googleapis ^173.0.0, @vonage/server-sdk ^3.30.0, @vonage/messages ^1.27.0, multer ^2.1.1, xlsx ^0.18.5, axios ^1.19.0, express-rate-limit ^8.5.2, compression, cookie-parser, cors, dotenv ^17.4.2, nodemon (dev).
Frontend: react ^18.3.1, vite ^8.0.12, react-router(-dom) ^7.16.0, @reduxjs/toolkit ^2.12.0, redux-persist ^6.0.0, @tanstack/react-query ^5.101.2, tailwindcss ^4.3.0, @mui/material ^9.0.1, formik ^2.4.6, yup ^1.7.1, axios ^1.16.1, socket.io-client ^4.8.3, recharts ^3.8.1, xlsx ^0.18.5, jspdf ^4.2.1.
