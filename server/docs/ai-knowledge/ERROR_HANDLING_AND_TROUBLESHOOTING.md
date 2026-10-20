# Error Handling and Troubleshooting

> All messages below are quoted from source code. Related: [BACKEND_DOCUMENTATION.md](BACKEND_DOCUMENTATION.md) §2, [API_DOCUMENTATION.md](API_DOCUMENTATION.md) §0, [INTEGRATIONS_AND_CONFIGURATION.md](INTEGRATIONS_AND_CONFIGURATION.md).

## 1. How errors are produced and returned
- Services create `new Error(message)` and set `err.statusCode`. Controllers do `errorResponse(res, err.message, err.statusCode || 500)`. Unknown exceptions → HTTP 500 with the raw `err.message`.
- `OfficeManagment/middleware/errorHandler.js` is the Express error handler (logs `[ERROR] <METHOD> <URL> → <message>`; adds `stack` only when `NODE_ENV === "development"`).
- Envelope: Office APIs `{ success:false, message, errors? }`; GST APIs `{ error }`; upload errors `{ success:false, message }` with 400.
- Fire-and-forget side effects (emails, WhatsApp, reminders, activity logs, task sync after GST filing) are wrapped (`runAfterCommit`, `.catch(console.error)`, `recordActivitySafe`) so their failure **never** fails the main action. Look for `[notification.service]`, `[mailer.service]`, `[vonage.service]`, `[taskWorkflow]`, `[gst-return]`, `[Scheduler]` log prefixes.
- Cross-organization access intentionally returns **404** ("not found") rather than 403.
- Frontend: `helpers/apiError.js#getApiErrorMessage` extracts `response.data.message`; `AlertProvider.showAlert` displays it; axios interceptor handles 401/403 specially (see below).

## 2. HTTP status guide (as implemented)
| Code | Typical cause |
|---|---|
| 400 | bad input / business rule (e.g. "Invalid status transition from X to Y.", "Return already filed", "Excel file is required.", "gstClientId is required.", multer upload errors) |
| 401 | missing/expired/invalid token; wrong login; inactive account |
| 403 | missing permission, software access, wrong company, locked return edit, Drive not connected |
| 404 | not found **or** belongs to another organization / inaccessible GST client or return |
| 409 | duplicates & concurrency ("The task changed while you were submitting. Please refresh.", "An account with this email already exists.", "This submission was already reviewed.", "The office structure has already been chosen.", "This return is locked or filed.") |
| 422 | express-validator failure ("Validation failed.") and workflow field errors (submission/review) |
| 429 | rate limiter |
| 502 | accounting partner API failure ("Failed to fetch companies from accounting software") |
| 503 | feature not configured ("Google sign-in is not configured.", "Google Drive is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.") |

## 3. Authentication / session errors
| Message (verbatim) | Where | Meaning / fix |
|---|---|---|
| "Access token is missing or malformed." (401) | `authenticate*` | no `Authorization: Bearer …` header |
| "Access token has expired." / "Invalid access token." (401) | `authenticate*` | refresh via `/api/auth/refresh` (frontend does this automatically) |
| "User not found or inactive." (401) | `authenticate` | account deactivated or deleted |
| "No active Office Management role assigned." (403) | `authenticate` | user has no active role; login self-heals when `User.roleId` points to an active Office role |
| "Invalid email or password." (401) | login | also returned when `userRole` doesn't match the account's office role |
| "Refresh token is required." (400) / "Session expired…" (401) | refresh | cookie/body token missing, revoked, expired |
| "Too many password reset requests. Please try again later." (429) | forgot-password | 5 per 15 min per IP |
| "Access denied. You do not have permission to: <key>" (403) | `checkPermission` | role lacks that permission key |
| "Access denied. Only an Admin can perform this action." (403) | `requireAdmin` | admin-only route |
| "Super Admin access required." (403) | `requireSuperAdmin` | |
| "Access to OFFICE_MANAGEMENT is not granted." (403) | `requireSoftware` | user has no software role |
| "You do not have access to the requested company." (403) | `resolveActiveCompanyId` | stale `X-Company-Id`; frontend clears `activeCompanyId` and reloads |
| "Client Portal access is no longer available." (401) | `authenticateClient` | portalAccess off or client inactive |
| "Standalone GST account required." (403) | `requireStandalone` | office token used on `/api/gst-user/*` |
| "This account is no longer active." (401) | `gstUserAuth` | |
| Session unexpectedly logged out on frontend | `tokenRefresh.js` | the refresh token was rejected/expired; user is redirected to `/login` (or `/gst/login`, `/client-portal/login`) |

If JWT env secrets are missing the server logs `[jwt.utils] INSECURE: … not set — using built-in development secrets.` — tokens signed by different environments with different secrets will all be "Invalid access token".

## 4. Software / GST gating errors
| Message | Cause |
|---|---|
| "Access to GST is not enabled for your organization." (403) | `Software` row `GST` missing or inactive (run `seed:software` / `seed:marketplace`) |
| "This application is not available in your office." / "This company has not selected this application." (403) | no live selection for that scope — Admin must tick the software in My Applications |
| "The selected user is not authorized to use this application." (403) | user lacks a `SoftwareAccess` grant and the role lacks `use_gst` |
| "The selected user does not belong to this company." (404) | company mismatch between task/header and user |
| "GST client not found." / "GST return not found." (404) | id doesn't exist **or** caller can't access it |
| "Return is locked. Cannot edit filed return." (403) | return FILED/locked; Admin can unlock (`/unlock`) |
| "Only an Admin can unlock a filed return." (403) | |
| "Return has N unresolved blocking issue(s) that must be fixed before filing." (400) | GSTR-1 BLOCK issues |
| "Acknowledge all N warning(s) before filing." (400) | GSTR-1 WARN issues not acknowledged |
| "Missing required field(s): …" (400) | GSTIN registration form |
| "This is not an advance entry" / "Already adjusted" (400), "Advance not found" (404) | marking an outward-supply advance as adjusted |
| "This return is locked or filed." (409) | import against a filed return |
| "Excel file is required." (400) | stage/import without file |
| "Failed to fetch companies from accounting software" (502) | partner API unreachable or tunnel URL changed (hard-coded URL) |

## 5. Task workflow errors
"This task uses the software completion workflow. Submit your completion evidence for approval instead." (400) · "Task must be approved before it can be marked completed." (400) · "Only submitted tasks can be approved or rejected." (400) · "Task approval is not enabled for this task." (403) · "You can only update tasks assigned to you." (403) · "This task requires approval. Submit it for review instead of marking completed directly." (400) · "This task is already assigned to … and work has started. Please cancel the current task before assigning it to another user." (reassign) · "This user cannot receive tasks (missing permission: task_receive)." (400) · "Task can only be assigned to an active user." (400) · "You can only assign tasks within your team." / "…within your organization." (403) · "Only the assigned employee can submit this task." (403) · "This task is already awaiting approval." (409) · "Start rework on this task before submitting it again." (409) · "The GST return linked to this task has not been filed yet. File it, then submit." (422) · "Please fix the highlighted fields." (422 with `errors:[{path,msg}]`) · "A rejection reason is required." / "Describe the corrections or evidence you need." (422) · "You are not authorized to review this task." (403) · "There is no pending submission to review." (409) · "Firstly connect with Google Drive before uploading documents." (403 — thrown when storing evidence/documents without Drive).

## 6. Billing / other business errors
"Invoice can only be created for APPROVED quotations." · "An invoice already exists for this quotation." · "Related task is in "<status>" status. Task must be COMPLETED or APPROVED before invoice generation." · "Only Admin can cancel an invoice." (403) · "Could not generate a unique quotation number. Please try again." (409) · "Google Calendar is not connected. Connect it from Appointments settings to generate Meet links." · "Each file must be 10 MB or smaller." · "Too many files, or a file was sent in an unexpected field (max 10)." · "Upload error: …" / "File type not allowed: <mime>" (documents).

## 7. Troubleshooting playbook

| Symptom | Likely cause (verified in code) | What to check / do |
|---|---|---|
| Random 500s, `EMAXCONNSESSION`, task creation failing | Supabase session pooler (~15 connections) exhausted | `PRISMA_CONNECTION_LIMIT` (default 5 per process); avoid many dev processes (`shared/prisma.js` comment) |
| CORS error in browser | origin not in allow-list | set `CORS_ORIGINS` (no trailing slash); same list is used for Socket.IO |
| Emails not arriving | SMTP vars missing → mails skipped; or deliverability (SPF/DKIM/DMARC) | server log `[mailer.service] SMTP_HOST/SMTP_USER/SMTP_PASS not set`; in non-production the password-reset link is printed to the console |
| WhatsApp not sent | Vonage vars missing/private key unreadable; user has no phone | logs `[vonage.service] Failed to initialize Vonage`, `WhatsApp skipped — user has no registered mobile number` |
| "Google sign-in failed" with "token used too late/early" | server clock out of sync | fix OS time/timezone (hint logged as `GOOGLE AUTH HINT`) |
| Google Drive upload says "Firstly connect with Google Drive…" | user hasn't completed OAuth (needs refresh token) | `GET /api/google-drive/auth-url` → callback `/api/google-drive/callback` → redirect `FRONTEND_URL/profile?driveConnected=true` (error: `?driveError=…`) |
| Meet link not generated | Calendar not connected or token invalid | connect from Appointments page; callback redirects to `/appointments?calendarConnected=true` |
| GST screens say software not available | company hasn't selected GST or user not authorized | My Applications → select GST; grant user access or give role `use_gst` |
| Standalone user can't see office clients (or vice-versa) | by design (`scopeGuard`) | |
| Bulk import progress bar stuck | socket room on a different Node process | frontend falls back to polling `/api/gstr1/import-progress/:importId` (in-memory, 10-min TTL) |
| Import rejects sheets | row count > 20,000, header problems | see `parseWorkbookSheets` oversized/blank-header checks |
| "Return already filed" / cannot edit | return locked | Admin → unlock (status goes back to DRAFT) |
| Accounting list fails (502) | ngrok URL no longer valid or `X_API_KEY` wrong | edit constants in `gst/accounting/*` |
| Reminders never fire | scheduler didn't start or process restarted before `remindAt` | scheduler starts in `server.listen`; logs `[Scheduler] …`; reminder rows `status PENDING` with `remindAt <= now` are picked every 5 min |
| Task stays "OVERDUE" or unexpectedly OVERDUE | cron marks tasks past `dueDate` OVERDUE every 5 min (except SUBMITTED software tasks) | change due date (permission `change_due_date`/`request_due_date_change`) |
| User can log in but sees empty menu | permissions list empty (role without keys) or permission rows missing | `ensureOfficeManagement` re-syncs built-in roles on login; check Roles & Permissions page |
| Frontend loops to login | refresh token rejected; check `accessToken`/`refreshToken` keys in localStorage and secrets consistency | |
| Prisma errors after pulling new code | migrations not applied / client not regenerated | `npm run migrate:deploy` (DB changes need a human decision), `npx prisma generate` (runs on `postinstall`) |
| `npm run seed:rbac` fails | script points to `prisma/seed.js` which doesn't exist | use `seed:software`, `seed:permission`, `seed:admin`, `seed:marketplace` |

## 8. Logging
Plain `console.log/warn/error` only (no logger library). Notable prefixes: `LOGIN ERROR =>`, `GOOGLE AUTH ERROR =>`, `AUTHENTICATION MIDDLEWARE ERROR =>`, `[ERROR] METHOD URL →`, `[Scheduler]`, `[notification.service]`, `[mailer.service]`, `[vonage.service]`, `[clientPortal]`, `[AccountingRequestScheduler]`, `[requireSoftwareSelection]`. Audit trail for business events is stored in table `AuditLog` (`utils/Audit.utils.js#audit`) and per-task `TaskActivity` / `TaskStatusHistory`.
