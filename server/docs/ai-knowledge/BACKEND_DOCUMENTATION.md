# Backend Documentation

> Related: [API_DOCUMENTATION.md](API_DOCUMENTATION.md) (every route), [DATABASE_DOCUMENTATION.md](DATABASE_DOCUMENTATION.md), [AUTHENTICATION_AND_PERMISSIONS.md](AUTHENTICATION_AND_PERMISSIONS.md), [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md), [GST_MODULE_DOCUMENTATION.md](GST_MODULE_DOCUMENTATION.md).
> Entry point: `backend/server.js`. All source under `backend/src/`. CommonJS. No TypeScript.

## 1. Layering convention

Almost every feature folder follows **routes → controller → service** (+ optional validator):

- `*.routes.js` – Express router: attaches `authenticate`, permission guards (`checkPermission`, `checkAnyPermission`, `requireAdmin`), validators and the controller method.
- `*.controller.js` – thin: reads `req`, runs `validationResult`, calls the service with `req.user` (the *actor*), maps `err.statusCode` to the HTTP response.
- `*.service.js` – business rules + Prisma. Takes `actor` (= `req.user`) as first argument so scoping (`orgAdminId`, `activeCompanyId`, permissions) is applied inside the service.
- `*.validator.js` – `express-validator` chains (Office modules) or `zod` schemas used through `middlewares/validateRequest.js` (user management, GST sections).

Exceptions: the **GST return/GSTR-3B/GSTR-9** code (`gst/gst-return/gst-return.controller.js`, `gst/gst-gstr3b.controller.js`, `gst/gst-gstr9.controller.js`, `gst/gst-client/*.controller.js`) puts Prisma logic directly in controllers and responds with raw `res.json(...)` / `{ error: "..." }` instead of the `{ success, message, data }` envelope.

## 2. Response & error conventions

- Office modules: `successResponse(res, data, message, status=200)` → `{ success: true, message, data }`; `sendPaginated` adds `pagination: { total, page, limit, totalPages }`; `errorResponse(res, message, status, errors?)` → `{ success:false, message, errors? }` (`OfficeManagment/utils/response.utils.js`). `enrichResponseData` decorates GSTR-1 records with enum labels via `enums/gstEnums.js#enrichGstr1Record`.
- Validation failures: HTTP **422** `"Validation failed."` + `errors` array (express-validator routes); routes using `middlewares/validateRequest.js` (zod) respond **400** `{ success:false, message:"Validation Error", errors }`.
- Services throw `Error` with `statusCode` (400/401/403/404/409/422…). Unknown errors → 500.
- GST controllers: success = bare JSON; error = `{ error: message }` with 400/403/404/500.
- Global handler `OfficeManagment/middleware/errorHandler.js`: logs `[ERROR] METHOD URL → message`, returns `{ success:false, message }` (+ `stack` when `NODE_ENV === "development"`). It is mounted **before** the two `/api/whatsapp/*` routes in `server.js` (those are declared after it).

## 3. Middleware inventory

| File | Export | Behaviour |
|---|---|---|
| `OfficeManagment/middleware/authenticate.js` | default `authenticate` | Bearer access token → `req.user` (see SYSTEM_ARCHITECTURE §4). 401 for missing/malformed/expired/invalid token or inactive user; 403 "No active Office Management role assigned." (non Super-Admin without role) |
| `middlewares/auth.middleware.js` | `authenticate`, `requireSuperAdmin`, `requireSoftware(code)`, `requireOfficeAccess` | Near-duplicate of the above used by the client-entity modules and super-admin user routes. `requireOfficeAccess` = user must hold an `OFFICE_MANAGEMENT` software role (Super Admin passes) |
| `OfficeManagment/middleware/rbac.js` | `checkPermission(key)`, `checkAnyPermission(...keys)`, `requireAdmin` | 403 `"Access denied. You do not have permission to: <key>"`, `"Access denied. Insufficient permissions."`, `"Access denied. Only an Admin can perform this action."`. `requireAdmin` passes Super Admin or role `ADMIN` only |
| `OfficeManagment/middleware/authenticateClient.js` | default | Client Portal token → `req.clientUser = { id, name, email }`; checks `portalAccess` and `status === ACTIVE` |
| `middlewares/auth.js` | `authenticate` (dual-mode), `requireStandalone` | tries GST standalone token first, else falls back to Office `authenticate`. Sets `req.user.isStandalone`/`role:"STANDALONE_GST"` for GstUsers. `requireStandalone` → 403 "Standalone GST account required." |
| `middlewares/gstUserAuth.middleware.js` | default `gstUserAuth` | standalone-only auth, sets `req.gstUser` |
| `middlewares/requireSoftwareSelection.js` | `requireSoftwareSelection(code)` → `[authenticate, checkSelection]` | software gate (GST) – see SYSTEM_ARCHITECTURE §5 |
| `middlewares/validateRequest.js` | `validateRequest(zodSchema)` | validates `{ body, query, params }` |
| `gst/utils/scopeGuard.js` | `createGstAccessGuard(model, opts)`, `guardClient`, `guardReturn`, `guardBodyScope`, `guardSupply`, `guardImportBatchParam`, `guardImportDraftParam`, `guardReturnParam`, `gstClientWhere`, `officeClientWhere` | resolves every id in the request to a GST client and verifies caller access (404 otherwise) |

Rate limits in `server.js`: `authLimiter` 100 req/15 min on `/api/auth`, `/api/client-portal/auth`, `/api/gst-user/auth`; `forgotPasswordLimiter` 5 req/15 min on both forgot-password paths.

## 4. Shared services (`backend/src/shared/services/`)

| Service | Responsibility |
|---|---|
| `userAccess.service.js` | `loadUserAccess` (roles & permission keys via `UserSoftwareRole`), `getAuthUser`, TTL caches (30 s) + invalidation functions, `resolveOrgAdminId`, `resolveActiveCompanyId`, `getOwnedCompanyIds`, `buildAuthPayload` |
| `softwareAccess.service.js` | subscription maps (company vs office level), `effectiveStatus`, `isUserAuthorizedForSoftware`, `resolveUserSoftwareAccess`, `checkUserCanUseSoftware`, `assertAssigneeCanUseSoftware`, `launchTargetFor` |
| `ownership.service.js` | `scopeWhere`, `assertOwnedByAdmin` |
| `officeBootstrap.service.js` | `ensureOfficeManagement(db)`: idempotently creates Office Management software, built-in roles, permissions and role links; called on every login |
| `notification.service.js` | `notify` (in-app + email + WhatsApp), `notifyTaskAssigned`, `notifyTaskSubmitted`, `notifyTaskDecision`, `notifyDocumentSubmitted`, `notifyDueReminder` |
| `mailer.service.js` | nodemailer wrapper; **never throws**; skipped (logged once) if `SMTP_HOST/USER/PASS` missing |
| `whatsapp.service.js` | Vonage Messages (WhatsApp) wrapper, `handleWhatsAppStatusWebhook` |
| `passwordReset.service.js` | token generation (32 random bytes, SHA-256 hash stored), `RESET_TTL_MS` 30 min, `RESEND_COOLDOWN_MS` 60 s, e-mail link `${FRONTEND_URL}${path}?token=…` |
| `templates/*.template.js` | HTML e-mail templates (task assigned/submitted, generic task, password reset, document request, appointment, client portal credentials) and a WhatsApp template creator script |

Utilities: `shared/utils/ttlCache.js` (in-memory TTL map), `dateOnly.js`, `generatePassword.js` (12-char random password for portal credentials), `normalizeEmail.js` (trim + lowercase, **no** Gmail dot stripping), `shared/prisma.js` (singleton PrismaClient; appends `connection_limit` = `PRISMA_CONNECTION_LIMIT` or **5** unless already in `DATABASE_URL`).

## 5. Module-by-module summary (Office Management)

### 5.1 Auth (`OfficeManagment/auth/`)
`auth.service.js`: `register` (always creates an **ADMIN** user + `UserSoftwareRole` for OFFICE_MANAGEMENT in one transaction; role never read from request), `login` (email normalized, bcrypt compare, `ensureOfficeManagement`, cache invalidation, `ensureOwnerAdminRole`/`ensureAssignedOfficeRole` self-heal, optional `userRole` must match the office role, creates `RefreshToken` row, updates `lastLoginAt`, records attendance check-in without blocking), `googleAuth` (exchanges OAuth code with `redirect_uri = "postmessage"`, verifies ID token; failures return **400** on purpose so the frontend 401 interceptor doesn't hijack the message), `refreshTokens` (rotates; revoked/expired → 401), `logout`, `logoutAll`, `getProfile`, `updateProfile` (name + phone only), `changePassword`, `requestPasswordReset`, `resetPassword`. Refresh token is set in an httpOnly cookie `refreshToken` (sameSite strict, secure in production, 7 days) **and** returned in the JSON body; `/refresh` and `/logout` accept the token from cookie or `body.refreshToken`.

### 5.2 Companies (`Companies/`)
`createCompany` (OfficeFirm + partners + addresses), `listMyCompanies`, `getActiveCompany` (`{context:"admin"|"company"}`), `setOfficeStructure` (SOLO/MULTIPLE, immutable), `setOfficeProfessions`/`setCompanyProfessions` (ordered by `PROFESSION_ORDER`; advances `onboardingStep` PROFESSION→MARKETPLACE), `completeOnboarding`/`completeOfficeOnboarding`.

### 5.3 Client master data
- Entity CRUD: `services/software/common/modules/<entity>/` (12 types). All pass through `createClientWithGeneratedCode` (`Client/clientCode.util.js`) which generates `code` = first 3 letters of name (uppercase, padded `X`, fallback `CLT`) + 3-digit running number, retrying on unique-code conflict and finally falling back to a timestamp suffix; it also triggers portal credential provisioning when `portalAccess` is true.
- `server.js` strips `companyId`, `adminId`, `orgAdminId` from request bodies on all client-entity paths so ownership can never be set by the client; only the Admin sharing endpoints can move clients between companies.
- Office-wide: `Client/client.service.js`: `getAllClients`, `getClientById`, `updateClient` (office fields), `getPortalEligibleClients`, `listOfficeClientsForSharing`, `bulkShareClients`, `getClientCompanies`, `setClientCompanies`.
- Visibility rules: `permissions/client.access.js` (`view_all_clients` → all org clients; `view_assigned_clients` → clients on tasks they assigned/lead/are assigned; `view_client_via_task` → clients on tasks assigned to them; plus explicit `User.clientIds`; company-aware scope includes clients shared via `CompanyClient`).
- Client Portal credentials: `Client/clientPortal.service.js` (`provisionPortalAccess` generates random password, stores bcrypt hash, e-mails plaintext once; `revokePortalAccess` wipes the hash).

### 5.4 Tasks (`Tasks/`, `TaskWorkflow/`, `DueDates_Remainders/`)
See [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md) for the state machine and workflow. Key functions: `tasks.service.js` – `createTask`, `listTasks`, `listAssignableUsers`, `getAssigneeAssignableClients`, `updateTaskStatus`, `reassignTask`, `updateTaskClients`, `getTask`, `getTaskStatusHistory`, checklist CRUD. `taskWorkflow.service.js` – `getWorkflow`, `startWork`, `launchSoftware`, `linkGstReturn`, `listLinkableReturns`, `onGstReturnFiled`, `submitForApproval`, `reviewSubmission`, `addAttachments`, `getFileForDownload`, `deleteTaskDocument`. `Duedates.service.js` – reminders CRUD, `changeTaskDueDate`, `getDueDateHistory`, `processOverdueTasks`, `processPendingReminders`, `scheduleDefaultReminders`, `getDueDateDashboard`.

### 5.5 Permissions / roles (`permissions/`)
`permissions.service.js`: `createRole`, `updateRole`, `listRoles`, `deleteRole`, `createPermission`, `listPermissions`, `assignPermissionsToRole`, `removePermissionsFromRole`, `getPermissionMatrix`. Built-in roles (ADMIN, BRANCH_MANAGER, EMPLOYEE, HR) are system roles (not renamable/deletable); custom roles are owned by `Role.adminId`.

### 5.6 User management (`modules/users/users.service.js`, `OfficeUsers/`)
- Super Admin API (`/api/user-management/users`): `createUser`, `listUsers`, `getUserById`, `updateUser`, `setUserStatus`, `deleteUser` (soft: deactivate).
- Office API (`/api/user-management/office-users`): `createOfficeUser`, `listOfficeUsers`, `getOfficeUserById`, `updateOfficeUser`, `setOfficeUserStatus`, `listAssignableOfficeRoles`, `listAssignableClients`.
- Rules: new office users are stamped with the creating Admin's org (`adminId`) and company (resolved server-side – `companyId` in the body is ignored/stripped by zod on create); HR may only manage EMPLOYEE and BRANCH_MANAGER (`ROLES_MANAGEABLE_BY` in `shared/constants/officeRoles.js`); a Branch Manager (if granted `create_user`) may manage only Employees in their own team; restricted managers cannot assign clients (`canAssignClients`); password policy ≥8 chars, one uppercase, one digit.

### 5.7 Marketplace (`Marketplace/`)
`getCatalog`, `saveSelection`, `getMyApplications`, `launchSoftware`, `expireDueSubscriptions`, `revokeSubscription` (Super Admin only), `listSoftwareUsers`/`setSoftwareUsers`, `listUserSoftware`/`setUserSoftware`, `listTaskSoftwareOptions`, `listProfessions`.

### 5.8 Billing
`ServiceTypes`, `Quotations` (`QTN-00001` numbering, tax/discount math), `Invoices` (`INV-00001`, only from APPROVED quotations), `Payments` (auto invoice status sync). See BUSINESS_LOGIC §Billing.

### 5.9 Documents & Drive
`Documents.service.js`: list/get/download/view/delete + `createDocument` (uploads to uploader's Google Drive via `googleDrive.service.uploadFileToDrive`, folder chosen by `resolveFolderType`), 10 MB multer memory limit, MIME allow-list (PDF, Word, Excel, JPEG/PNG/GIF/WebP, txt, csv). `googleDrive.service.js`: OAuth (`drive.file` scope; state = JWT with `purpose:"google_drive"`), status, disconnect, upload/download/delete/list. `DocumentRequests`: staff request a document from a client; client submits via portal.

### 5.10 Communication
`appointments.service.js` (CRUD, optional Google Meet link generation through `googleMeet.service.js`, client notification + email, OVERDUE sweep), `enquiries.service.js` (lead pipeline NEW→…→WON/LOST, `convertedAt` auto-set when status becomes WON, stats by status).

### 5.11 Reports, HR, Dashboard, Compliance Calendar, Notifications
- `Reports/` – 7 report types, permission tiers in `report.permissions.js`.
- `HR/` – attendance overview/calendar/week/year (`hr.service.js`), `attendance.service.js` (check-in on login and check-out on logout, EMPLOYEE & BRANCH_MANAGER only).
- `Dashboard/dashboard.service.js#getPracticeDashboard`.
- `ComplianceCalendar/` – merges tasks, GST due dates (from `gst/compliance-calendar`), appointments and holidays into calendar rows; `markComplete` supports sourceType `TASK` and `GST`.
- `Notifications/` – list, unread count, mark read / read-all.

## 6. Startup order in `server.js` (matters for behaviour)
1. Load env (`dotenv`), build CORS list (`CORS_ORIGINS` or dev fallback list).
2. Global middleware; `/health`; static `/uploads/software`.
3. `app.use(["/api/getGstEnums","/api/gst","/api/gstr1","/api/gstr7"], ...requireSoftwareSelection("GST"))` **before** GST routers.
4. GST routers (Office), then `/api/gst-user/*` (standalone), then client-entity body sanitizer, then client-entity routers, user-management, `/api/gst` client & return routers, auth routers (with rate limiters), the rest of Office routers. `taskWorkflowRoutes` is mounted **before** `tasksRoutes` on `/api/task` so `/:id/workflow/*` isn't swallowed by `/:id`.
5. `app.use(errorHandler)`, then `/api/whatsapp/inbound` (logs body) and `/api/whatsapp/status` (delivery webhook; both unauthenticated).
6. HTTP server + Socket.IO; `server.listen` → `startScheduler()` + `startAccountingRequestScheduler()`.

## 7. Scripts (`backend/package.json`)
`npm run dev` (nodemon server.js) · `npm start` · `postinstall` → `prisma generate` · `migrate:deploy` → `prisma migrate deploy` · `seed:rbac` → `node prisma/seed.js` (**file does not exist in the repo – script is stale**) · `seed:permission` · `seed:software` · `seed:admin` · `seed:marketplace`.
