# System Architecture

> Related: [BACKEND_DOCUMENTATION.md](BACKEND_DOCUMENTATION.md), [FRONTEND_DOCUMENTATION.md](FRONTEND_DOCUMENTATION.md), [AUTHENTICATION_AND_PERMISSIONS.md](AUTHENTICATION_AND_PERMISSIONS.md), [DATABASE_DOCUMENTATION.md](DATABASE_DOCUMENTATION.md).

## 1. High-level picture

```
 Browser (React SPA, Vite)                     External services
 ┌──────────────────────────────┐              ┌──────────────────────────────────┐
 │ Redux (auth persisted)       │              │ Google OAuth / Drive / Calendar  │
 │ React Query (30s stale)      │  HTTPS/JSON  │ SMTP server (nodemailer)         │
 │ axios instance (3 sessions)  │◄────────────►│ Vonage WhatsApp API              │
 │ socket.io-client             │  + WebSocket │ Accounting software partner API  │
 └──────────────────────────────┘              │ (x-api-key) – ngrok URL hardcoded│
              │                                └──────────────────────────────────┘
              ▼
 Express 5 app (backend/server.js)  ── Prisma ──►  PostgreSQL (Supabase pooler, conn limit 5/process)
   • cors / compression / cookieParser / json
   • rate limiters (auth 100/15min, forgot-password 5/15min)
   • Socket.IO server (room "join-import-room")
   • node-cron schedulers (reminders, overdue, subscriptions, appointments, accounting requests)
```

Single-process monolith. No message queue, no Redis. In-process caches: `createTTLCache` (30s for user/access/owned-companies, 20s for client-scope) and an in-memory import-progress store (10-minute TTL).

## 2. Three independent identity systems

| System | Table | Token secret env | Login route | Middleware | Frontend storage keys |
|---|---|---|---|---|---|
| Staff / Admin (Office Management) | `User` (+ `RefreshToken`) | `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | `POST /api/auth/login` | `OfficeManagment/middleware/authenticate.js` | `accessToken`, `refreshToken`, `userData`, `activeCompanyId` |
| Client Portal | `Client` (portalAccess + portalPasswordHash; refresh tokens are stateless) | `JWT_CLIENT_ACCESS_SECRET` / `JWT_CLIENT_REFRESH_SECRET` | `POST /api/client-portal/auth/login` | `authenticateClient.js` | `om_client_access_token`, `om_client_refresh_token`, `om_client_session_id` |
| Standalone GST | `GstUser` (+ `GstRefreshToken`) | `GST_STANDALONE_ACCESS_SECRET` / `GST_STANDALONE_REFRESH_SECRET` | `POST /api/gst-user/auth/login` | `middlewares/auth.js` (`authenticate` + `requireStandalone`) and `gstUserAuth.middleware.js` | `gstUserAccessToken`, `gstUserRefreshToken`, `gstUserData` |

Each token payload carries a `type` (`client`, `client_refresh`, `gst_standalone`) so a token from one system cannot be replayed on another.

## 3. Multi-tenancy model ("org" and "company")

- **Organization root = the Admin's `User.id`.** Every Branch Manager / Employee / HR created by an Admin has `User.adminId = <admin id>`. Records created by that org (Client, Task, Quotation, Invoice, Document, Appointment, …) are stamped with `adminId`.
- `req.user.orgAdminId` = `resolveOrgAdminId(user)`: `null` for Super Admin (unrestricted), `user.id` for ADMIN, else `user.adminId` (`shared/services/userAccess.service.js`).
- **Company (`OfficeFirm`)** is optional second level. `OfficeFirm.ownerId` → Admin. Staff roles with `requiresCompanyAssignment` (Employee, Branch Manager, HR) have `User.companyId`.
- `req.user.activeCompanyId` = `resolveActiveCompanyId`: Admin → the `X-Company-Id` header if it names a company they own (else 403 "You do not have access to the requested company."), `null`/`"admin"` = Admin/Office-level context; others → their own `User.companyId`.
- Scoping helper: `shared/services/ownership.service.js` → `scopeWhere(orgAdminId, extra, companyId)` adds `adminId` (and `companyId` when present) to Prisma `where`; `assertOwnedByAdmin` returns **404 (not 403)** for cross-org records so ids can't be probed.
- Office structure: `User.officeStructure` = `SOLO` (the Admin *is* the office; no OfficeFirm row) or `MULTIPLE` (companies created explicitly). The choice is final (`companies.service.js#setOfficeStructure`). There is **no "Main Office" record**: no `activeCompanyId` means Admin context.
- Clients can additionally be **shared** into other companies owned by the same Admin via `CompanyClient`.

## 4. Request lifecycle (staff API)

1. `server.js` global middleware: `cors` (allow-list, credentials), `compression`, `cookieParser`, `express.json`, `express.urlencoded`.
2. Router-level: `authenticate` → verify access JWT → load user (cached) + role/permissions (cached) → build `req.user`:
   `{ id, email, name, role, roleId, clientIds, adminId, companyId, permissions, isSuperAdmin, softwareRoles, orgAdminId, activeCompanyId }`.
3. `checkPermission(key)` / `checkAnyPermission(...keys)` / `requireAdmin` (`middleware/rbac.js`).
4. Validators (`express-validator` chains or `zod` via `validateRequest`).
5. Controller → service (business logic + Prisma) → `successResponse` / `errorResponse` (`utils/response.utils.js`).
6. Errors: services throw `Error` with `.statusCode`; controllers catch and call `errorResponse`; unhandled errors reach `errorHandler.js` (`{ success:false, message }`, plus `stack` only if `NODE_ENV==="development"`).

## 5. GST module gating & scoping

```
/api/getGstEnums, /api/gst, /api/gstr1, /api/gstr7
   └─ requireSoftwareSelection("GST")  = authenticate + checkSelection("GST")
        - Super Admin passes
        - Software row must exist & be active
        - task context (X-Task-Id header or ?taskId=) is verified against the task (assignee only) and decides scope
        - checkUserCanUseSoftware: company/office must have selected GST (live subscription) AND user authorized
/api/gst/<section>  = createGstAccessGuard(prismaModelAccessor) → router
/api/gst-user/*     = standalone: gstBusinessAuth + requireStandalone + same guards + same routers
```
Standalone and Office share the **very same routers**; only the URL prefix and token differ (`server.js`, `GST_LINE_ITEM_MOUNTS`). Client-level access is enforced by `gst/utils/scopeGuard.js` (standalone user → only `GSTClient.ownerGstUserId = me`; office user → only GST clients whose master `Client` they may see; a standalone-owned GST client is never visible to office staff).

## 6. Background processing (see also [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md))

`startScheduler()` (`OfficeManagment/DueDates_Remainders/TaskRemainder_Scheduler.js`) and `startAccountingRequestScheduler()` (`gst/accounting/accountingRequestScheduler.js`) are started in the `server.listen` callback:

| Job | Frequency | Function |
|---|---|---|
| Mark tasks OVERDUE (+ create OVERDUE reminder) | startup + every 5 min | `Duedates.service#processOverdueTasks` |
| Send due reminders | startup + every 5 min | `Duedates.service#processPendingReminders` |
| Expire software subscriptions | startup + every 15 min | `marketplace.service#expireDueSubscriptions` |
| Mark appointments OVERDUE | startup + every 5 min | `appointments.service#processOverdueAppointments` |
| Poll accounting access requests / retry GSTR-1 import | every 5 min | `accountingRequestScheduler#runAccountingRequestCheck` |

## 7. Real-time (Socket.IO)

- Server (`server.js`): `io.on("connection")` registers only **`join-import-room(importId, ack)`**. Import services emit `import-progress` and `import-complete` to that room; the io instance is stored with `app.set("io", io)`.
- Fallback for multi-process hosting: `GET /api/gstr1/import-progress/:importId` reads the in-memory store (`importProgress.store.js`).
- Frontend: `gst_Frontend/config/socket.js` (singleton `getSocket()`), and the separate chat widget (see [AI_AGENT_DOCUMENTATION.md](AI_AGENT_DOCUMENTATION.md)) which opens its own socket and expects events **not implemented on this backend**.

## 8. File storage
| Kind | Where | Access |
|---|---|---|
| Staff documents | uploader's **Google Drive** (`drive.file` scope), metadata in `Document` (`driveFileId`, `driveUrl`) | authenticated `/api/documents/:id/download|view` |
| Client-portal uploads | local `backend/uploads/client-portal/<clientId>/...` (`Document.filePath`, `source=CLIENT`) | authenticated portal/documents endpoints; path traversal guarded in `Documents.service.js` |
| Task attachments | `PRIVATE_UPLOAD_DIR` (default `backend/private_uploads/`), random names, magic-byte validation, 10 MB/file | `/api/task/:id/workflow/files/:fileId` |
| Task completion screenshots | stored as task `Document`s in the submitter's Google Drive (`storeInDrive`) | via documents |
| Software logos | `backend/uploads/software/*.png` | public static `/uploads/software` |

## 9. Frontend architecture summary
- One SPA with four zones: public pages, staff/admin app (`ProtectedLayout` → `AppShell` → `AppRoutes`), client portal (same shell in `clientMode`), and standalone GST (`/gst/*`, `GstAuthGuard`).
- One axios instance serves all three sessions (see `axiosConfig.js`); a 401 triggers `retryWithFreshToken` from `core/auth/tokenRefresh.js`.
- The GST screens are shared: `gstMode.js` rewrites `api/gst/...` → `api/gst-user/gst/...` when the current path starts with `/gst`.
- Permission-driven UI: `usePermission()` + `ProtectedRoute` + sidebar filtering by permission keys.

## 10. Known architectural quirks (verified)
- `fileReturn`'s comment says the linked task is "completed solely by the approver", but `taskWorkflow.service.js#onGstReturnFiled` actually **auto-completes** the linked office task (see [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md) §Task workflow).
- Accounting API base URLs are hard-coded in `gst/accounting/accountingCompanies.service.js` and `gst/accounting/gstr1Import/accountingReportsClient.js` (an ngrok tunnel), only the API key comes from env (`X_API_KEY`).
- The seed catalog (`seed-permissions-data.js`) does **not** define `view_my_applications`, `view_communication`, `manage_communication`, `view_compliance_calendar`; they are enforced in routes and only auto-granted to existing Branch Manager/Employee roles by `officeBootstrap.service.js`. Where the Permission rows are created could not be verified (see [AUTHENTICATION_AND_PERMISSIONS.md](AUTHENTICATION_AND_PERMISSIONS.md)).
