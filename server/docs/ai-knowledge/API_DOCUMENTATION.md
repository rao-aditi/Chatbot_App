# API Documentation

> Base URL: `VITE_API_URL` on the frontend (default `http://localhost:5001`); server port = `PORT` env or **5001**. All JSON unless noted. Source of truth: `backend/server.js` (mounts) and each `*.routes.js`.
> Related: [AUTHENTICATION_AND_PERMISSIONS.md](AUTHENTICATION_AND_PERMISSIONS.md), [BACKEND_DOCUMENTATION.md](BACKEND_DOCUMENTATION.md), [GST_MODULE_DOCUMENTATION.md](GST_MODULE_DOCUMENTATION.md).
> Permission keys in the "Guard" column are checked by `checkPermission` (must have) or `checkAnyPermission` (any of). "auth" = valid staff access token. Request bodies are listed only for fields that validators/services actually read; **[UNVERIFIED]** means the exact shape was not read.

## 0. Conventions

- **Auth header:** `Authorization: Bearer <accessToken>`.
- **Extra request headers** (allowed by CORS): `X-Company-Id` (Admin picks a company; absent or `admin` = Admin/Office context), `X-Task-Id` (GST screens opened from a task), `ngrok-skip-browser-warning`.
- **Success envelope (Office modules):** `{ "success": true, "message": "...", "data": ... }`; paginated adds `"pagination": { total, page, limit, totalPages }`.
- **Error envelope:** `{ "success": false, "message": "...", "errors"?: [...] }`.
  - `422 "Validation failed."` for express-validator routes; `400 "Validation Error"` for zod `validateRequest` routes.
  - 401 token problems; 403 permission/scope; 404 not found **or** cross-org record; 409 conflicts; 429 rate limited.
- **GST module (`/api/gst/...`) responses are mostly bare JSON** (arrays/objects) and errors are `{ "error": "..." }` (except software-gate/auth failures which use the Office envelope).
- Health: `GET /health` → `{ "ok": true }` (no auth).
- Static: `GET /uploads/software/<file>.png` (public logos).
- Rate limits: auth routes 100 / 15 min; forgot-password 5 / 15 min (`message: "Too many password reset requests. Please try again later."`).

---

## 1. Staff authentication — `/api/auth`

| Method | Path | Guard | Body / notes |
|---|---|---|---|
| POST | `/register` | none | `name, email, phone?, countryCode?, password` (password ≥8, 1 uppercase, 1 digit). Always creates an ADMIN. Response `data: { token:{accessToken,refreshToken}, user }` + cookie |
| POST | `/google` | none | `{ code }` Google OAuth authorization code (popup flow) |
| POST | `/login` | none | `{ email, password, userRole? }` → `data: { token:{accessToken,refreshToken}, user:{ id,name,email,phone,status,…,isSuperAdmin,softwareRoles,role,permissions } }`; message "Login successfully." Wrong credentials (or `userRole` mismatch) → 401 "Invalid email or password." |
| POST | `/forgot-password` | none (rate-limited 5/15 min) | `{ email }` – e-mails a reset link (valid 30 min; 1 e-mail / 60 s / account) |
| POST | `/reset-password` | none | `{ token, newPassword }` |
| POST | `/refresh` | cookie `refreshToken` or body `refreshToken` | rotates → `data: { accessToken, refreshToken }` |
| POST | `/logout` | cookie/body refresh token | revokes it, clears cookie |
| POST | `/logout-all` | auth | revokes all refresh tokens |
| GET | `/userDetails` | auth | profile |
| PUT | `/update-profile` | auth | `{ name?, phone? }` |
| PUT | `/change-password` | auth | `{ oldPassword, newPassword }` |

## 2. Permissions, roles, software catalog

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/permissions/` | auth | current user's `{ role, permissions[], isSuperAdmin, softwareRoles[] }` (used by the frontend `fetchUserPermissions`) |
| GET | `/api/permissions/matrix` | requireAdmin + `view_audit_logs` | permission matrix |
| POST | `/api/permissions/add_role` | requireAdmin + `manage_roles` | create custom role |
| GET | `/api/permissions/getAllRoles` | requireAdmin + `manage_roles` | list visible roles |
| PUT/DELETE | `/api/permissions/roles/:id` | requireAdmin + `manage_roles` | update / delete role |
| POST | `/api/permissions/` | Super Admin | create a Permission row |
| GET | `/api/permissions/list` | requireAdmin + `manage_roles` | full permission catalog |
| POST/DELETE | `/api/permissions/role-permissions` | requireAdmin + `manage_roles` | body `{ roleId, permissionIds[] }` assign / remove |
| GET | `/api/user-management/software/catalog` | auth | software catalog |
| POST | `/api/getEnums` | none | returns lists of enum values (roles, taskStatus, taskPriority, appointmentStatus, quotation/invoice/payment statuses, GST enums…) |

## 3. User management

**Super Admin only** (`authenticate`+`requireSuperAdmin`) — `/api/user-management/users`: `GET /` (zod query filters), `POST /`, `GET /:id`, `PUT /:id`, `PATCH /:id/activate`, `PATCH /:id/deactivate`, `DELETE /:id` (= deactivate).

**Office staff** — `/api/user-management/office-users` (`authenticate` + `requireOfficeAccess`):

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/` | `list_users` or `create_user` | query `status?(ACTIVE|INACTIVE), q?, page=1, limit≤100` |
| POST | `/` | `create_user` | zod: `name(2–80), email, phone?, countryCode? (+NN), password(≥8,A-Z,0-9), role, teamLeaderId?, clientIds[]` |
| GET | `/assignable-roles` | `create_user` | roles the actor may create (HR → EMPLOYEE, BRANCH_MANAGER) |
| GET | `/assignable-clients` | `create_user` | id/name/code list (Admin only) |
| GET | `/:id` | `list_users`/`create_user`/`view_operational_reports`/`view_all_reports` | |
| PUT | `/:id` | `create_user` | partial update |
| PATCH | `/:id/activate`, `/:id/deactivate` | `create_user` | |

## 4. Companies / office onboarding — `/api/companies`
| Method | Path | Notes |
|---|---|---|
| GET | `/mine` | `data: { companies[], office }` for navbar switcher |
| GET | `/active` | `{ context: "admin"|"company", company }` |
| POST | `/` | create company: `profession, firm{firmName,structureType,firmPAN?,firmGSTIN?,registrationNumber?,establishedDate?}, partners[{name,designation,…}], addresses[{addressLine1,city,state,pincode,…}]` |
| PUT | `/office/structure` | `{ structure: "SOLO"|"MULTIPLE" }` (Admin; final) |
| PATCH | `/office/professions`, `/:id/professions` | `{ professions[] }` |
| POST | `/office/onboarding/complete`, `/:id/onboarding/complete` | |

> Route-order caveat: `/api/companies/private`, `/api/companies/public`, `/api/companies/public-not-interested` (client entities) are mounted **before** `/api/companies`, so those paths go to the entity routers.

## 5. Clients

### 5.1 Office-wide — `/api/client` (auth)
| Method | Path | Guard |
|---|---|---|
| GET | `/allClients` | `view_all_clients` or `view_assigned_clients`; query `search, isActive, entityType, page, limit, assignableOnly` |
| GET | `/portal-eligible` | same; query `search` |
| GET | `/sharing` | list clients available for cross-company sharing |
| POST | `/share` | bulk share (zod/validator `bulkShareValidator`) |
| GET/PUT | `/:id/companies` | get / set companies a client is shared with |
| GET | `/:id` | `view_all_clients`/`view_assigned_clients` |
| PUT | `/:id` | `update_client` |

### 5.2 Entity CRUD (all: `authenticate` + `requireOfficeAccess`; `POST /`, `GET /`, `GET /:id`, `PUT /:id`, `PATCH /:id`, `DELETE /:id`)
| Entity | Mount |
|---|---|
| Individual | `/api/individual` |
| HUF | `/api/huf` |
| Firm | `/api/firm` |
| AOP | `/api/aop` |
| AOP Trust | `/api/trust` |
| Body of Individual | `/api/body-of-individual` |
| Artificial Juridical Person | `/api/artificial-juridical-person` |
| Cooperative Society | `/api/cooperative-society` |
| Public company (interested) | `/api/companies/public` |
| Public company (not interested) | `/api/companies/public-not-interested` |
| Private company | `/api/companies/private` |
| Local Authority | `/api/local-authority` |
| All clients (read) | `GET /api/clients` |

Frontend maps entity "status codes" → endpoints (`onboarding/config/entityEndpoints.js`): `01` individual, `03` HUF, `05` firm, `07` AOP, `08` trust, `09` body-of-individual, `10` artificial-juridical-person, `11` cooperative-society, `12` public, `13` public-not-interested, `14` private, `16` local-authority. Body fields: see `Client` model in [DATABASE_DOCUMENTATION.md](DATABASE_DOCUMENTATION.md); `companyId`/`adminId`/`orgAdminId` in the body are deleted server-side.

## 6. Tasks

### 6.1 `/api/task` (tasksRoutes; `authenticate`)
| Method | Path | Guard | Body / query |
|---|---|---|---|
| GET | `/assignees` | `task_assign_any` or `task_assign_team` | assignable users |
| GET | `/assignees/:id/clients` | same | clients the assignee can access |
| GET | `/` | `view_all_tasks` or `view_own_tasks` | `status, clientId, assignedToId, priority, from, to, page, limit` |
| POST | `/create_Task` | `create_task` | `clientIds[int≥1], title, description?, requiredSoftwareId?(uuid), serviceTypeId(int), assignedToId(uuid), priority(LOW|MEDIUM|HIGH|URGENT), dueDate?, requiresApproval?(default true), remarks?, checklistItems[]?` → 201 `data:{task}`; status starts **ASSIGNED** |
| GET | `/:id` | view tasks | |
| PATCH | `/:id/status` | `update_task_status`/`mark_task_complete`/`approve_task`/`approve_task_if_enabled`/`change_due_date`/`request_due_date_change` | `{ status, remarks?, dueDate? }` – state machine in BUSINESS_LOGIC |
| PATCH | `/:id/reassign` | `reassign_task`/`reassign_task_within_team` | `{ assignedToId, remarks? }` – only DRAFT/ASSIGNED/CANCELLED tasks |
| PATCH | `/:id/clients` | `create_task` | `{ clientIds[] }` |
| GET | `/:id/history` | view tasks | status history |
| POST | `/:id/checklist` | create/update/complete/own | `{ title }` |
| PATCH | `/:id/checklist/:checklistId/toggle` | same | |
| DELETE | `/:id/checklist/:checklistId` | `create_task`/`update_task_status` | |

### 6.2 Software-task workflow — `/api/task/:id/workflow/*` (mounted before tasksRoutes)
| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/workflow` | view tasks | read model: access verdict, submissions, files, linked GST return |
| POST | `/workflow/start` | work-on-task perms | ASSIGNED/OVERDUE/REJECTED → IN_PROGRESS |
| POST | `/workflow/launch-software` | work-on-task perms | verifies access, returns launch URL |
| GET | `/workflow/gst-returns` | work-on-task perms | returns that can be linked |
| POST | `/workflow/link-gst-return` | work-on-task perms | `{ returnId(uuid) }` |
| POST | `/workflow/submit` | work-on-task perms | **multipart**: `filingDate (YYYY-MM-DD, required, not in future)`, `referenceLink` (required for org software), `externalSoftwareName` (required for external), `completionNotes ≤2000`, files field `screenshots` (max 5; ≥1 required for external) |
| POST | `/workflow/review` | approve perms | `{ decision: "APPROVE"|"REJECT"|"REQUEST_CORRECTIONS", comment ≤1000 }` (comment required unless APPROVE) |
| POST | `/workflow/attachments` | `create_task` or `upload_documents` | multipart `files` (max 10) |
| GET | `/workflow/files/:fileId` | view tasks | authenticated download |
| DELETE | `/workflow/files/:fileId` | `delete_documents` | uploader only |

(The exact permission arrays `VIEW_TASKS`, `WORK_ON_TASKS`, `APPROVE_TASKS` are constants at the top of `TaskWorkflow/taskWorkflow.routes.js`.)

## 7. Due dates & reminders — `/api/due-dates`
| Method | Path | Guard |
|---|---|---|
| GET | `/dueDate_dashboard` | `view_all_tasks`/`view_own_tasks` |
| PATCH | `/tasks/:taskId` | `change_due_date`/`request_due_date_change`; body `{ dueDate, reason }` |
| GET | `/tasks/:taskId/history` | view tasks |
| GET/POST | `/tasks/:taskId/reminders` | POST body `{ remindAt, message, userId? }` |
| GET | `/reminders/my` | view tasks |
| PATCH/DELETE | `/reminders/:reminderId` | PATCH `{ remindAt?, message? }`; DELETE = cancel |

## 8. Billing
| Mount | Routes (all `authenticate`) |
|---|---|
| `/api/service-type` | `POST /create_ServiceType` (`create_service_type`), `GET /getAllserviceTypes`, `GET /get-serviceTypeById/:id`, `PUT /update_serviceType/:id` (`update_service_type`), `DELETE /delete_serviceType/:id` (`delete_service_type`). Body fields include `name, serviceCharges, taxRate, discountAllowed, couponCode?, status` |
| `/api/quotation` | `POST /create_Quotation` (`create_quotation`; body `serviceTypeId, clientIds[], taskId?, serviceCharges?, taxRate?, discountAmount?, status?`), `GET /getAllQuotations` (`create_quotation`/`view_quotation`; query `search,status,clientId,page,limit`), `GET /get-quotationById/:id`, `PATCH /update_quotationStatus/:id`, `PUT /update_quotation/:id` |
| `/api/invoice` | `POST /create_Invoice` (`generate_invoice`; body `{ quotationId, adminOverride? }`), `GET /getAllInvoices`, `GET /get-invoiceById/:id`, `PATCH /update_invoiceStatus/:id` (`status`; CANCELLED = Admin only), `PUT /update_invoice/:id` (Admin only), `POST /cancel_invoice/:id` |
| `/api/payment` | `POST /create_Payment` (`generate_invoice`; body `invoiceId, amountPaid, paymentDate, mode(CASH|UPI|BANK_TRANSFER|CHEQUE|CARD), referenceNo?, status?`), `GET /getAllPayments`, `GET /get-paymentById/:id`, `GET /invoice/:invoiceId` |

## 9. Documents
| Mount | Routes |
|---|---|
| `/api/documents` | `GET /` (query `page,limit,clientId,taskId,search`), `GET /stats`, `GET /:id`, `GET /:id/download`, `GET /:id/view` — guard `upload_documents` or `delete_documents`; `POST /upload` (`upload_documents`; multipart field `file`, body `description?, clientId?, taskId?`; 10 MB; MIME allow-list; multer errors → 400 `Upload error: …`); `DELETE /:id` (`delete_documents`) |
| `/api/document-requests` | all require `upload_documents`/`view_all_clients`/`view_assigned_clients`: `POST /`, `GET /`, `GET /:id`, `PATCH /:id/status` |
| `/api/google-drive` | `GET /callback` (OAuth redirect, no auth; state is a signed JWT), then auth: `GET /auth-url`, `GET /status`, `DELETE /disconnect` |

## 10. Communication
`/api/appointments` (auth; view = `view_communication`; manage = `view_communication` **or** `manage_communication`): `GET /`, `GET /stats`, `GET /calendar/status`, `GET /calendar/auth-url`, `DELETE /calendar/disconnect`, `GET /clients`, `GET /:id`, `POST /` (body fields read by service: `title, description, scheduledAt, durationMinutes=30, notes, complianceCategory="MEETING", clientId, attendeeIds[], attendeeEmails[], googleMeetLink, generateMeetLink`), `PATCH /:id`, `PATCH /:id/cancel`, `DELETE /:id`.
`/api/enquiries`: `GET /`, `GET /stats`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`. UI field names `contactName, contactEmail, contactPhone, companyName, enquiryText, estimatedValue` are accepted and mapped to model fields `clientName, clientEmail, clientPhone, title, serviceInterest, expectedValue`.

## 11. Compliance calendar, holidays, dashboard, notifications, reports, HR
| Mount | Routes |
|---|---|
| `/api/compliance-calendar` | `GET /events`, `GET /summary` (guard `VIEW_PERMS` array in routes file), `PATCH /events/:sourceType/:sourceId/complete` (`mark_task_complete`/`update_task_status`; sourceType `TASK` or `GST`); `/holidays`: `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id` (manage = `manage_compliance_calendar_settings`; body `name, date, isOptional, branchScope[]`) |
| `/api/dashboard` | `GET /practice` |
| `/api/notifications` | `GET /` (query `unreadOnly,status,type,page,limit`), `GET /unread-count`, `PATCH /read-all`, `PATCH /:id/read` |
| `/api/reports` | `GET /tasks` (any report access), `/overdue` (`view_all_reports`/`view_operational_reports`), `/clients`, `/fees`, `/invoices`, `/payments` (`view_all_reports`), `/staff-performance` (`view_all_reports`/`view_operational_reports`/`view_hr_workforce`) |
| `/api/hr` | `GET /attendance`, `/attendance/calendar`, `/attendance/week`, `/attendance/year` (`view_all_reports`/`view_operational_reports`/`view_hr_workforce`) |

## 12. Marketplace — `/api/marketplace` (auth)
| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/professions` | | professions list (excludes CLIENT) |
| GET | `/software` | | catalog + current selection state |
| PUT | `/selection` | | `{ softwareIds: uuid[] (≤100) }` – Admin only (service `requireOwnerAdmin` or office scope) |
| GET | `/my-applications` | `view_my_applications` | |
| GET | `/task-software-options` | | software the actor may attach to a task |
| POST | `/software/:softwareId/launch` | `view_my_applications` | `data:{ launchUrl }` |
| GET/PUT | `/software/:softwareId/users` | | PUT `{ userIds: uuid[] (≤500) }` |
| GET/PUT | `/users/:userId/software` | | PUT `{ softwareIds: uuid[] }` |
| POST | `/subscriptions/:subscriptionId/revoke` | Super Admin (service-enforced) | `{ reason? ≤500 }` |

## 13. Client Portal
`/api/client-portal/auth`: `POST /login {email,password}`, `POST /refresh {refreshToken}`, `GET /me` (client token).
`/api/client-portal` (client token; every route is automatically scoped to that one client): `GET /dashboard`, `/services`, `/tasks`, `/deadlines`, `/appointments`, `/documents`, `POST /documents/upload` (multipart), `GET /documents/:id/download|view`, `GET /document-requests`, `POST /document-requests/:id/submit` (multipart), `GET /invoices`, `/invoices/:id`, `/quotations`, `/notifications`, `/notifications/unread-count`, `PATCH /notifications/:id/read`, `POST /notifications/read-all`, `GET /activity`, `GET /profile`.

## 14. WhatsApp webhooks (unauthenticated)
`POST /api/whatsapp/inbound` (logs body, returns `OK`), `POST /api/whatsapp/status` (`handleWhatsAppStatusWebhook(req.body)`).

---

## 15. GST module

### 15.1 Gating & prefixes
- **Office/staff:** `/api/getGstEnums`, `/api/gst/*`, `/api/gstr1/*`, `/api/gstr7/*` all pass through `requireSoftwareSelection("GST")` (authenticated + org selected GST + user authorized; Super Admin bypass; `X-Task-Id`/`?taskId=` scope).
- **Standalone GST user:** same routers under `/api/gst-user/getGstEnums`, `/api/gst-user/gst/*`, `/api/gst-user/gstr1/*`, `/api/gst-user/gstr7/*`; auth via `gstBusinessAuth` + `requireStandalone`; client CRUD at `/api/gst-user/gst/clients` is separate (`gstUserClient.routes.js`).
- The frontend rewrites office paths to standalone paths automatically (`gst_Frontend/helpers/gstMode.js`).

### 15.2 Standalone GST auth — `/api/gst-user/auth`
`POST /register`, `POST /login`, `POST /forgot-password` (rate-limited), `POST /reset-password`, `POST /refresh`, `POST /logout`, `POST /logout-all` (token), `GET /me`, `PUT /update-profile`, `PUT /change-password`.

### 15.3 GST clients & dashboards (`/api/gst`, office staff)
| Method | Path | Notes |
|---|---|---|
| GET | `/clients` | paginated (`page`, `limit ≤1000`, `q`, `taskId`) → `{ clients[], pagination }` |
| GET | `/clients/:clientId` | workspace detail (auto-provisions GSTClient from master client GST fields: status `existing|provisioned|incomplete|conflict|error`) |
| GET | `/master-clients` | master clients with GSTIN counts |
| GET/POST | `/master-clients/:clientId/gstins` | POST requires `REQUIRED_GSTIN_FIELDS`; only one registration per client (else clear error) |
| PUT/DELETE | `/master-clients/:clientId/gstins/:gstinId` | |
| PATCH | `/gstins/:gstinId/toggle` | activate/deactivate |
| POST | `/clients/:clientId/import-from-master` | create GSTClient from master client's saved GSTIN |
| GET | `/returns-dashboard` | |
| GET | `/admin/return-overview` | **Admin only** (`requireAdmin`) |
| GET/POST/PATCH/DELETE | `/compliance-calendar/rules`, `/compliance-calendar/overrides` | **Admin only**; GST due-date rules & overrides |
| GET | `/accounting/accounting-companies` | external accounting software companies (+ local request status) |
| POST | `/accounting/request-access` | `{ gstin, companyName?, period? }` → 201 |
| POST | `/accounting/link-client` | `{ gstin?, name (required), pan?, code?, businessType? }` → 201 `{ clientId }` |

Standalone clients: `/api/gst-user/gst/clients` — `GET /`, `GET /:gstClientId`, `POST /`, `PUT /:gstClientId`, `PATCH /:gstClientId/toggle`, `DELETE /:gstClientId` (payload = same shape as the Office client form + `status` entity code; client code = first 3 letters + running number per owner).

### 15.4 Returns (`/api/gst`, same router mounted for standalone)
| Method | Path | Notes |
|---|---|---|
| GET | `/clients/:clientId/returns` | query `financialYear, period, returnType` |
| GET | `/returns/:returnId` | |
| POST | `/generate-returns` | body `{ financialYear, periodType, period, returnType, clientId? }`; creates DRAFT returns with `skipDuplicates`; without `clientId` = all clients the caller may access |
| PATCH | `/returns/:returnId` | only `status` ∈ {DRAFT, READY_FOR_REVIEW} and `dueDate`; 403 if locked |
| POST | `/returns/:returnId/file` | validates (GSTR1 blockers/warnings), sets FILED, generates fake ARN `ARN<timestamp><4 chars>`, locks; then syncs office task |
| POST | `/returns/:returnId/unlock` | Admin / Super Admin / standalone user only |
| GET | `/returns/:returnId/gstr1-json`, `/gstr1-json/download` | GSTN offline-tool JSON |
| GET | `/returns/:returnId/supplies`; POST `/outward-supplies`; DELETE `/outward-supplies/:supplyId`; PATCH `/outward-supplies/:supplyId/adjust` (`{adjustedAgainst}`) | |
| GET/PUT | `/returns/:returnId/gstr3b` | auto-computes liability from the matching GSTR-1 return |
| GET/PUT | `/returns/:returnId/gstr9` | auto-summary from filed/ready GSTR-1 and GSTR-3B of the FY |

### 15.5 GSTR-1 / GSTR-7 sections
Every section router below supports `GET /` (list, filtered by `returnId`/`gstClientId`), `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`; GSTR-1 sections additionally `GET /summary`. Mount = `/api/gst` + path (GSTR-1 section routers create `B2BA`-style `POST /` etc.). Each is wrapped by `createGstAccessGuard(<prisma model accessor>)`.

| Path | Prisma accessor | Path | Prisma accessor |
|---|---|---|---|
| `/b2ba` | b2BA | `/returns/b2bsezde` | b2BSEZDE |
| `/b2cla` | b2CLA | `/returns/b2cl` | b2CL |
| `/b2csa` | b2CSA | `/returns/b2cs` | b2CS |
| `/cdnra` | cDNRA | `/returns/cdnr` | cDNR |
| `/cdnura` | cDNURA | `/returns/cdnur` | cDNUR |
| `/expa` | eXPA | `/returns/exp` | eXP |
| `/ata` | aTA | `/returns/at` | aT |
| `/atadja` | aTADJA | `/returns/atadj` | aTADJ |
| `/hsn` | hSN | `/returns/exemp` | eXEMP |
| `/eco` | eCO | `/returns/docs` | dOCS |
| `/ecob2b` | eCOB2B | `/returns/ecoa` | eCOA |
| `/ecob2c` | eCOB2C | `/returns/ecourp2b` | eCOURP2B |
| `/ecoab2b` | eCOAB2B | `/returns/ecourp2c` | eCOURP2C |
| `/ecoaurp2b` | gSTR1ECOAURP2BInvoice | `/returns/ecoab2c` | eCOAB2C |
| | | `/returns/ecoaurp2c` | eCOAURP2C |
| `/returns/gstr7-deductee` | gSTR7Deductee | `/returns/gstr7-amendment` | gSTR7Amendment |
| `/returns/gstr7-cashledger` | gSTR7CashLedgerEntry | `/returns/gstr7-summary` | (keyed by returnId: `GET/PUT /:returnId`) |

### 15.6 Excel import & validation (`/api/gstr1`, `/api/gstr7`; standalone: `/api/gst-user/gstr1|gstr7`)
| Method | Path | Notes |
|---|---|---|
| POST | `/api/gstr1/stage` | multipart `file` (xlsx) + body scope (`returnId`, `gstClientId`, `financialYear`, `returnPeriod`, `importId`); stages rows into `GSTR1ImportDraft`; progress via Socket.IO room `importId` |
| GET | `/api/gstr1/import-progress/:importId` | HTTP polling fallback |
| GET | `/api/gstr1/batches/:importBatchId/blocked` | blocked drafts |
| GET/PATCH | `/api/gstr1/batches/:importBatchId/drafts/:draftId` | view / edit a draft |
| GET | `/…/drafts/:draftId/conflict` | duplicate conflict detail |
| POST | `/…/drafts/:draftId/resolve-duplicate` | |
| POST | `/api/gstr1/batches/:importBatchId/commit` | writes drafts to real section tables (only when no BLOCK issues remain) |
| GET | `/api/gstr1/:returnId/warnings` | validation issues |
| GET | `/…/warnings/:issueId/conflict`, POST `/…/warnings/:issueId/resolve-duplicate` | |
| POST | `/…/warnings/:issueId/acknowledge`, `/…/warnings/acknowledge-all` | |
| POST | `/api/gstr1/:returnId/validate`, `/api/gstr1/:returnId/revalidate-record` | return-level and record-level checks |
| POST | `/api/gstr7/import` | multipart xlsx, direct import |
