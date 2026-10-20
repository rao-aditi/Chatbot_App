# Authentication, Roles and Permissions

> Related: [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) §2–3, [API_DOCUMENTATION.md](API_DOCUMENTATION.md), [DATABASE_DOCUMENTATION.md](DATABASE_DOCUMENTATION.md) §2, [MARKETPLACE_AND_SOFTWARE_ACCESS.md](MARKETPLACE_AND_SOFTWARE_ACCESS.md).
> Secrets are never documented here; only environment-variable **names**.

## 1. Three login systems

| | Staff / Admin | Client Portal | Standalone GST |
|---|---|---|---|
| Principal | `User` | `Client` (with `portalAccess=true`) | `GstUser` |
| Endpoints | `/api/auth/*` | `/api/client-portal/auth/*` | `/api/gst-user/auth/*` |
| Sign-up | Public self-signup (`POST /api/auth/register`, always becomes ADMIN) or Google; staff users are created by Admin/HR | **No signup.** Credentials are generated when an Admin/staff enables Portal Access on a client (random 12-char password, bcrypt-hashed, e-mailed once with `CLIENT_PORTAL_LOGIN_URL`) | Public self-signup (`/register`) |
| Access token | JWT signed with `JWT_ACCESS_SECRET`, payload from `buildAuthPayload` `{id,email,name,isSuperAdmin,softwareRoles[{software,role}]}`; default expiry **2d** (`JWT_ACCESS_EXPIRES_IN`) | `JWT_CLIENT_ACCESS_SECRET`, payload `{id, type:"client"}`, default **1d** | `GST_STANDALONE_ACCESS_SECRET`, payload `{id, type:"gst_standalone"}`, default **2d** |
| Refresh token | `JWT_REFRESH_SECRET`, `{id, jti}`, default **7d**, **stored in DB** (`RefreshToken`), rotated on every refresh, revoked on logout; also httpOnly cookie `refreshToken` | `JWT_CLIENT_REFRESH_SECRET`, `{id,type:"client_refresh"}`, 7d, **stateless**: honoured only while portal access is still enabled and not issued before `portalPasswordSetAt` | `GST_STANDALONE_REFRESH_SECRET`, `{id,type,jti}`, 7d, stored in `GstRefreshToken` |
| Middleware | `authenticate` (+ `middlewares/auth.middleware.js` variant) | `authenticateClient` | `gstUserAuth` / dual-mode `middlewares/auth.js#authenticate` + `requireStandalone` |
| Frontend keys | `accessToken`, `refreshToken`, `userData`, `activeCompanyId` | `om_client_access_token`, `om_client_refresh_token`, `om_client_session_id` | `gstUserAccessToken`, `gstUserRefreshToken`, `gstUserData` |

If a `*_SECRET` env var is missing the code **falls back to built-in development secrets and prints an INSECURE warning** (`OfficeManagment/utils/jwt.utils.js`). A bare `JWT_SECRET` is **not** read anywhere.

Passwords: `bcryptjs` with `BCRYPT_SALT_ROUNDS` (default 12). Password policy for staff/GST users: ≥ 8 chars, ≥ 1 uppercase, ≥ 1 digit. Emails are normalized (trim + lowercase) before lookup (`shared/utils/normalizeEmail.js`).

## 2. Staff login flow (step by step)
1. Frontend `Login.jsx` → `reqToUserLogin` thunk (`authSlice.js`) → `POST /api/auth/login {email,password}`.
2. Backend `auth.service.login`: find user by normalized email; must be `ACTIVE`; `bcrypt.compare`; `ensureOfficeManagement(prisma)` (self-heals software/roles/permissions); invalidate access cache; `ensureOwnerAdminRole` (a company owner with no role gets ADMIN back) and `ensureAssignedOfficeRole` (rebuild `UserSoftwareRole` from `User.roleId`); optional `userRole` check; sign access + refresh tokens; store refresh token; set `lastLoginAt`; **record attendance check-in** (EMPLOYEE / BRANCH_MANAGER only).
3. Response: `{ token:{accessToken,refreshToken}, user:{…, isSuperAdmin, softwareRoles, role, permissions[]} }`; refresh token also in an httpOnly cookie.
4. Frontend stores tokens + `userData` in `localStorage`; redux `auth` slice is the only persisted slice (`redux-persist`).
5. On app load `AuthInit` always re-fetches `GET /api/permissions` (fresh permissions) and `GET /api/companies/mine`.
6. Every API call: axios adds `Authorization` and `X-Company-Id` (if `activeCompanyId` stored). On 401 → `core/auth/tokenRefresh.js#retryWithFreshToken` refreshes (`/api/auth/refresh`) and replays; if refresh fails the session is cleared and the user is sent to `/login`. `startProactiveRefresh` also renews shortly before expiry and when a sleeping tab wakes.
7. Google login: `GoogleAuthButton` obtains an OAuth *code*; `POST /api/auth/google {code}`; backend exchanges it using `GOOGLE_CLIENT_ID/SECRET` and `redirect_uri="postmessage"`, verifies the ID token and logs in/creates the account. Failure statuses are 400/403/503 intentionally (not 401).

## 3. Password reset
`POST /api/auth/forgot-password {email}` (limiter: 5 / 15 min per IP) → if the account exists and no reset e-mail was created in the last **60 s**, a 32-byte random token is generated, only its **SHA-256 hash** is stored in `PasswordResetToken` (expires in **30 min**) and an e-mail with `${FRONTEND_URL}/reset-password?token=…` is sent (standalone GST uses its own path and `GstPasswordResetToken`). `POST /api/auth/reset-password {token,newPassword}` rejects used/expired tokens (400) and inactive accounts (403). Without SMTP configured, outside production the link is printed to the server console.

## 4. Roles

### 4.1 Software catalog and where roles live
`shared/constants/software.js`:
- `SYSTEM` → role `SUPER_ADMIN`.
- `OFFICE_MANAGEMENT` → the **only software that owns roles**: built-ins `ADMIN`, `BRANCH_MANAGER`, `EMPLOYEE`, `HR` (+ Admin-created custom roles).
- `GST`, `TDS`, `ROC`, `DSC` → **modules** with no roles of their own, governed by Office Management role permissions `use_gst`, `use_tds`, `use_roc`, `use_dsc` (`MODULE_ACCESS_PERMISSIONS`).

A user's role is stored in `User.roleId` **and** mirrored in `UserSoftwareRole` (unique per user+software). `loadUserAccess` reads `UserSoftwareRole`; `authenticate` falls back to `User.roleRef` when the assignment row is missing.

### 4.2 Built-in role defaults (`backend/prisma/seed-permissions-data.js`)

| Role | Default permission keys | Assignment flags |
|---|---|---|
| **ADMIN** | every permission in the catalog | no company/manager required; supports client assignment |
| **BRANCH_MANAGER** | `view_assigned_clients, view_client_via_task, create_task, task_assign_team, task_receive, view_own_tasks, reassign_task_within_team, update_task_status, mark_task_complete, approve_task_if_enabled, request_due_date_change, view_quotation, send_client_messages, upload_documents, view_operational_reports` (+ additive `view_my_applications, view_compliance_calendar, view_communication` for existing installs) | requires company; supports clients |
| **EMPLOYEE** | `view_client_via_task, view_own_tasks, update_task_status, mark_task_complete, upload_documents, view_own_reports, task_receive` (+ same additive keys) | requires company + manager (team leader); supports clients |
| **HR** | `list_users, create_user, view_client_via_task, view_hr_workforce` (exact set re-synced on each login: extras removed) | requires company; no manager; **no client list** |
| **SUPER_ADMIN** | every active permission (computed dynamically) | — |

### 4.3 Permission catalog (keys defined in the seed file)
`create_user, manage_roles, deactivate_user, list_users, view_all_clients, update_client, view_assigned_clients, view_client_via_task, view_client_fee_details, create_task, task_receive, task_assign_any, task_assign_team, view_all_tasks, view_own_tasks, reassign_task, reassign_task_within_team, update_task_status, mark_task_complete, approve_task, approve_task_if_enabled, change_due_date, request_due_date_change, create_change_fees, create_quotation, view_quotation, generate_invoice, send_client_messages, upload_documents, delete_documents, view_all_reports, view_operational_reports, view_own_reports, view_hr_workforce, view_audit_logs, create_service_type, update_service_type, delete_service_type, use_gst, use_tds, use_roc, use_dsc, manage_compliance_calendar_settings`.

**ADMIN_ONLY_PERMISSIONS** (`manage_roles, create_user, deactivate_user, view_audit_logs, manage_compliance_calendar_settings`): the seed file comment says they are reserved for ADMIN. What the code actually enforces: (a) role/permission-admin routes are behind `requireAdmin` regardless of keys held, and (b) `removePermissionsFromRole` refuses to strip these keys from the built-in ADMIN role (403). `assignPermissionsToRole` does **not** block assigning them to a custom role. HR holds `create_user` as an explicit exception in `ROLE_PERMISSIONS`, limited by `ROLES_MANAGEABLE_BY`.

**Permission keys used in code but NOT present in the seed catalog** (**[UNVERIFIED]** where the rows are created): `view_my_applications`, `view_communication`, `manage_communication`, `view_compliance_calendar` (enforced in routes, sidebar and `officeBootstrap.service.js`, which only auto-links them to existing Branch Manager/Employee roles). The frontend `pages/RolesPermissions/permissionsCatalog.js` also lists `update_user, delete_user, create_client, delete_client`, which no backend route checks.

### 4.4 Custom roles
Admin (`requireAdmin` + `manage_roles`) can create custom roles owned by their org (`Role.adminId`), toggle/rename/delete them, and edit permission sets of built-in or custom roles through `/api/permissions/*`. Built-in roles cannot be renamed or deleted (`isSystem`). Custom roles inherit the assignment flags chosen at creation (`requiresCompanyAssignment`, `requiresManagerAssignment`, `supportsClientAssignment`). Any change flushes the whole access cache (`invalidateAllUserAccessCache`).

### 4.5 Who can manage whom (user management)
- Super Admin: unrestricted; manages all users via `/api/user-management/users`.
- ADMIN: all roles in own org.
- HR: only EMPLOYEE and BRANCH_MANAGER; cannot assign clients.
- BRANCH_MANAGER (if granted `create_user`): only EMPLOYEEs in their own team (`assertTargetInActorTeam`).
- Reference: `shared/constants/officeRoles.js#ROLES_MANAGEABLE_BY`, `modules/users/users.service.js`.

## 5. Authorization layers (evaluated in this order)
1. **Authentication** (token valid, user ACTIVE).
2. **Org scope** (`orgAdminId`, `activeCompanyId`): every service filters by `adminId`/`companyId`; foreign records → 404.
3. **Permission keys** via `checkPermission`/`checkAnyPermission` (route level) and re-checks in services (e.g. `canApproveTask`).
4. **Client-level access** (`permissions/client.access.js`): `view_all_clients` → all org clients; `view_assigned_clients` → clients on tasks they assigned / whose assignee they lead / assigned to them; `view_client_via_task` → clients on tasks assigned to them; plus explicit `User.clientIds`. Documents, quotations, GST data etc. reuse this.
5. **Software gate** for GST: org/company must have selected the software **and** the user must be authorized (Admin always; staff need a `SoftwareAccess` grant or a role with `use_<module>`).
6. **Task-level rules** (assignee-only actions, reviewer rules, state machine) — see [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md).

## 6. Frontend authorization
- `usePermission()` (`Hooks/usePermission.js`) reads `state.auth.permissions`; helpers `can`, `canAny`, `canAll`, `canAccessReport`.
- `ProtectedRoute` wraps every office route with `permission` / `anyPermissions`; a user lacking permission is redirected (to `/dashboard`, which falls through to `*` → `/`).
- `AppShell` blocks non-Super-Admin users without an `OFFICE_MANAGEMENT` software role (redirect to `/`).
- `AppRoutes` role-based dashboard: `admin`/default → `PracticeDashboard`, `branch_manager` → `ManagerDashboard`, `employee` → `EmployeeDashboard`, `hr` → `HRDashboard`, client → `ClientPortalDashboard`.
- `ProtectedLayout` ensures a session exists (staff tokens or client session) and confines client sessions to `/client-portal*`, `/officeManagment_DashBoard`, `/login`.
- `PracticeRoute` limits `/workspace/{ca-tax|cs|cma|advocate}` to companies whose professions enable that practice.
- `GstAuthGuard` protects `/gst/*` using `isGstUserLoggedIn()`.

## 7. Company context
- Admin can switch companies via `CompanySwitcher`; the chosen id is stored in `localStorage.activeCompanyId` and sent as `X-Company-Id`. Invalid id → 403 "You do not have access to the requested company." and the frontend clears the key and reloads.
- Non-Admin staff are pinned to `User.companyId` (header ignored).

## 8. Seeding the Super Admin
`npm run seed:admin` (`backend/prisma/seed-admin.js`) ensures the software catalog/roles then creates or updates the Super Admin user. The email and initial password are constants inside that script (not reproduced here); change them after seeding in any shared environment.
