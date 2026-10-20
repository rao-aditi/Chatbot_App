# Project Structure

> See also: [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md), [BACKEND_DOCUMENTATION.md](BACKEND_DOCUMENTATION.md), [FRONTEND_DOCUMENTATION.md](FRONTEND_DOCUMENTATION.md).
> Paths are relative to the repository root (`officeGST/`). ~890 files are tracked by git (≈400 backend/src, ≈380 frontend/src).

## 1. Top level

```
officeGST/
├─ backend/            Express + Prisma API (server.js entry point)
├─ frontend/           React + Vite SPA
├─ uploads/documents/  3 stray PDF files tracked in git (legacy; not referenced by current code paths)
├─ docs/ai-knowledge/  this knowledge base (generated documentation only)
├─ .vscode/settings.json
├─ package.json        root deps only: clsx, socket.io-client, tailwind-merge
└─ .gitignore
```

## 2. Backend (`backend/`)

```
backend/
├─ server.js                       Express app, middleware, ALL route mounts, Socket.IO, cron start
├─ package.json                    scripts: dev, start, postinstall (prisma generate), migrate:deploy, seed:* 
├─ prisma.config.js                Prisma CLI config (schema path + DATABASE_URL)
├─ .env.example                    environment variable NAMES with comments (no real values)
├─ prisma/
│  ├─ schema.prisma                2,896 lines, 92 models, 80 enums (see DATABASE_DOCUMENTATION.md)
│  ├─ migrations/                  47 migration folders (2026-06 … 2026-10) + migration_lock.toml
│  ├─ seed-admin.js                creates/updates the Super Admin account (seed:admin)
│  ├─ seed-software-roles.js       software catalog + built-in roles (seed:software)
│  ├─ seed-permissions-data.js     PERMISSIONS catalog, ROLE_PERMISSIONS, ROLE_ASSIGNMENT_FLAGS, MODULE_ACCESS_PERMISSIONS
│  ├─ seed-marketplace.js          marketplace software rows (seed:marketplace)
│  ├─ seed-gst-due-date-rules.js   default GST due-date rules
│  ├─ apply-comm-migration.js      helper for the appointments/leads migration
│  └─ scripts/                     one-off maintenance/backfill/verification scripts (add-hr-role, backfill-admin-ownership, verify-isolation, …)
├─ uploads/
│  ├─ software/*.png               public logos served statically at /uploads/software
│  └─ client-portal/<clientId>/    client-uploaded files (private; only via authenticated endpoints)
├─ private_uploads/                (gitignored) task attachments/evidence, default for PRIVATE_UPLOAD_DIR
└─ src/
   ├─ OfficeManagment/             the Office Management API (feature folders, see below)
   ├─ gst/                         the GST module API
   ├─ services/software/common/modules/   client master-data CRUD per entity type
   ├─ modules/                     super-admin user management + software catalog
   ├─ middlewares/                 cross-cutting auth middlewares (GST dual-mode auth, software gate)
   ├─ enums/                       officeEnums.js, gstEnums.js, enums controller (POST /api/getEnums)
   └─ shared/                      prisma client, constants, services (mail, WhatsApp, notifications, access), utils, templates
```

### 2.1 `backend/src/OfficeManagment/` (each folder = `*.routes.js` + `*.controller.js` + `*.service.js` [+ `*.validator.js`])

| Folder | Purpose | Mounted at |
|---|---|---|
| `auth/` | register, login, Google login, refresh, logout, profile, password reset | `/api/auth` |
| `ClientAuth/` | Client Portal login/refresh/me | `/api/client-portal/auth` |
| `ClientPortal/` | Client Portal data endpoints (+ `portalNotify.service.js`) | `/api/client-portal` |
| `Client/` | office-wide client list/detail/update, sharing across companies; `clientCode.util.js`, `clientPortal.service.js`, `clientFields.utils.js`, `clientServices.service.js` | `/api/client` |
| `Companies/` | OfficeFirm (company) + office structure/professions/onboarding | `/api/companies` |
| `Tasks/` | task CRUD, status, reassign, checklist; `task.permissions.js` (state machine), `task.assignment.js`, `task.activity.js` | `/api/task` |
| `TaskWorkflow/` | software-task workflow (start/launch/submit/review/attachments); `taskFiles.js` | `/api/task/:id/workflow/*` |
| `DueDates_Remainders/` | due dates, reminders, **`TaskRemainder_Scheduler.js`** (cron) | `/api/due-dates` |
| `ComplianceCalendar/` | calendar events/summary, office holidays | `/api/compliance-calendar` |
| `Notifications/` | in-app notifications | `/api/notifications` |
| `permissions/` | roles, permissions, matrix; `client.access.js` (client visibility) | `/api/permissions` |
| `OfficeUsers/` | staff user management (calls `modules/users/users.service.js`) | `/api/user-management/office-users` |
| `Marketplace/` | professions, software catalog, selection, launch, per-user software access | `/api/marketplace` |
| `ServiceTypes/`, `Quotations/`, `Invoices/`, `Payments/` | billing chain | `/api/service-type`, `/api/quotation`, `/api/invoice`, `/api/payment` |
| `Documents/`, `DocumentRequests/`, `GoogleDrive/` | documents, requests to clients, Drive OAuth | `/api/documents`, `/api/document-requests`, `/api/google-drive` |
| `Communication/` | `appointments.*`, `enquiries.*`, `googleMeet.service.js` | `/api/appointments`, `/api/enquiries` |
| `Reports/`, `HR/`, `Dashboard/` | reports, attendance, practice dashboard | `/api/reports`, `/api/hr`, `/api/dashboard` |
| `middleware/` | `authenticate.js`, `authenticateClient.js`, `rbac.js`, `errorHandler.js` | — |
| `utils/` | `jwt.utils.js`, `response.utils.js`, `Audit.utils.js`, `enums.js`, `dateRange.js`, `fileHeaders.js` | — |

### 2.2 `backend/src/gst/`

| Folder | Purpose |
|---|---|
| `auth/` | standalone GstUser register/login/refresh/profile (`/api/gst-user/auth`) |
| `gst-client/` | `gst-client.*` (office staff: GSTIN registrations of master clients, dashboards) and `gstUserClient.*` (standalone users' own clients) |
| `gst-return/` | return list/get/file/unlock/update/generate + outward supplies + GSTR-1 JSON export routes |
| `gst-gstr3b.controller.js`, `gst-gstr9.controller.js` | GSTR-3B / GSTR-9 handlers (wired from gst-return routes) |
| `GSTR-1/<SECTION>/` (≈29 folders) | one folder per GSTR-1 table (B2BSEZDE, B2BA, B2CL, B2CLA, B2CS, B2CSA, CDNR, CDNRA, CDNUR, cdnura, EXP, expa, at, ata, atadj, atadja, exemp, hsn, docs, eco, ecoa, ecob2b, ecob2c, ecourp2b, ecourp2c, ecoab2b, ecoab2c, ecoaurp2b, ecoaurp2c) each with routes/controller/service/validator |
| `GSTR-1/import/` | staged Excel import (`gstr1ImportDraft.*`, `gstr1Import.config.js`, `importProgress.store.js`, warnings controller) |
| `GSTR-1/export/` | GSTN offline-tool JSON builder (`gstr1Json.service.js`, `gstr1Json.mappings.js`) |
| `GSTR-1/shared/` | validation engine (`validationIssues.service.js`), GSTIN/doc-number/money validators, coerce utils |
| `gstr7-*` (deductee, amendment, cashledger, summary, import) | GSTR-7 module |
| `compliance-calendar/` | GST due-date rules/overrides (`/api/gst/compliance-calendar`) |
| `admin-overview/` | admin-only return overview (`/api/gst/admin/return-overview`) |
| `accounting/` | external accounting-software integration + 5-minute scheduler; `gstr1Import/` mappers |
| `enums/`, `utils/` | GST enums API; `scopeGuard.js` (client-level access control), `importRunner.js`, `response.utils.js` |

### 2.3 Other backend src
- `services/software/common/modules/<entity>/` – 12 entity folders (individual, huf, firm, aop, aop-trust, body-of-individual, artificial-juridical-person, cooperative-society, company-private, company-public-interested, company-public-not-interested, local-authority) plus `clients/` (GET list). Mounted in `server.js` under `/api/individual`, `/api/huf`, `/api/firm`, `/api/aop`, `/api/trust`, `/api/body-of-individual`, `/api/artificial-juridical-person`, `/api/cooperative-society`, `/api/companies/{private|public|public-not-interested}`, `/api/local-authority`, `/api/clients`.
- `modules/users/` – Super Admin user management (`/api/user-management/users`); `modules/software/` – software catalog (`/api/user-management/software/catalog`).
- `middlewares/` – `auth.js` (dual-mode GST auth + `requireStandalone`), `requireSoftwareSelection.js`, `auth.middleware.js`, `gstUserAuth.middleware.js`, `validateRequest.js`.
- `shared/` – `prisma.js`, `constants/{software,officeRoles}.js`, `services/{mailer,notification,whatsapp,passwordReset,userAccess,softwareAccess,ownership,officeBootstrap}.service.js`, `services/templates/*.template.js` (email/WhatsApp HTML), `utils/{ttlCache,dateOnly,normalizeEmail,generatePassword}.js`.

## 3. Frontend (`frontend/`)

```
frontend/
├─ index.html, vite.config.js (alias "@" → src), vercel.json, eslint.config.js, components.json
├─ store/                  Store.js (configureStore + redux-persist), rootReducer.js, officeUsers/officeUsersSlice.js
├─ public/                 logos, templates/GSTR1_Excel_Workbook_Template_V2.0.xlsx
└─ src/
   ├─ main.jsx             Provider → PersistGate → QueryClientProvider → BrowserRouter → App
   ├─ App.jsx              top-level route table (public, GST standalone, protected)
   ├─ Login/               staff Login, Forgot/Reset password, ProfileSettingsModal
   ├─ core/                auth/{sessionKeys,tokenRefresh}.js, hooks/useAuth.js, query/{queryClient,queryKeys}.js, cache, Spinner
   ├─ helperFunction/      ThemeContext.jsx, apiError.js
   ├─ modules/user-management/api/officeUsersApi.js
   ├─ office_Managment_Frontent/   (sic) Office Management UI
   │   ├─ api/             axiosConfig.js (shared axios instance) + one *Api.js per backend area + api/queries/*(React Query hooks)
   │   ├─ routes/          ProtectedLayout, ProtectedRoute, PracticeRoute, AppRoutes (office route table)
   │   ├─ layouts/AppShell.jsx
   │   ├─ pages/           ~80 page files grouped by feature (see FRONTEND_DOCUMENTATION.md)
   │   ├─ components/      SideBar, Header, CompanySwitcher, Chat/ChatWidget, Marketplace, TaskManagement/Workflow, ui/*, common/*
   │   ├─ onboarding/      client master-data module (MasterDataModule, AddClientFormModal, per-entity form-sections)
   │   ├─ clientPortal/    clientSession.js + pages/Client*.jsx = the real portal section components; they are rendered by thin wrappers in pages/ClientPortal/ClientPortal*.jsx (via ClientPortalPage, which verifies the client session)
   │   ├─ Hooks/           usePermission, usePracticeTypes, useLaunchSoftware, useTaskEnums, useAppointmentStatuses
   │   ├─ helpers/         constants.js (apiEndPoints), permissions.js, AlertContent, exportUtils, softwareUi, ...
   │   └─ store/slice/     auth, client, task, dueDate, permission, serviceType, quotation, payment, document, googleDrive, reports
   └─ gst_Frontend/        GST UI (shared by Office "/gst-return" and standalone "/gst")
       ├─ api/             gstClientsApi, gstReturnsApi, gstr1Api, gstr7Api, gstUserApi, accountingCompaniesApi, gstAdminOverviewApi, gstUserAxiosClient
       ├─ routes/          GSTRoutes, GstLayout, GstAuthGuard, ReturnDataGate
       ├─ modules/gst/     GSTClient, GSTR1, GSTR3B, GSTR7, GSTR9, GSTReturns, AdminOverview
       ├─ pages/gstUser/   GstLogin, GstRegister, GstForgotPassword, GstResetPassword
       ├─ helpers/gstMode.js  URL/base-path switch between Office and standalone mode
       ├─ config/socket.js    Socket.IO client singleton (import progress)
       └─ store/slice/     ClientSlice, gstReturns/{gstReturnsSlice,gstr1Slice,gstr3bSlice,gstr7Slice,gstr9Slice}
```

Note: the folder name `office_Managment_Frontent` (and backend `OfficeManagment`) contain deliberate/legacy typos – use them exactly when referencing paths.

## 4. Important single files to know
| File | Why it matters |
|---|---|
| `backend/server.js` | every route mount, global middleware order, GST gating, Socket.IO, scheduler start |
| `backend/prisma/schema.prisma` | single source of truth for data model |
| `backend/prisma/seed-permissions-data.js` | permission keys & default role grants |
| `backend/src/shared/constants/software.js` | software catalog (SYSTEM, OFFICE_MANAGEMENT, GST, TDS, ROC, DSC) |
| `backend/src/shared/services/userAccess.service.js` | role/permission loading, org-admin & active-company resolution |
| `backend/src/shared/services/softwareAccess.service.js` | subscription/software authorization logic |
| `backend/src/OfficeManagment/middleware/authenticate.js` | builds `req.user` |
| `backend/src/gst/utils/scopeGuard.js` | client-level access control for all GST APIs |
| `frontend/src/App.jsx` | top-level routes and session separation |
| `frontend/src/office_Managment_Frontent/api/axiosConfig.js` | headers (`X-Company-Id`, `X-Task-Id`), 3-session routing, 401 refresh |
| `frontend/src/gst_Frontend/helpers/gstMode.js` | how `/gst` reuses Office GST screens via URL rewrite |
