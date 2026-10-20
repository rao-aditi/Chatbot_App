# Software Marketplace and Access Control

> Additional deep-dive file. Related: [AUTHENTICATION_AND_PERMISSIONS.md](AUTHENTICATION_AND_PERMISSIONS.md), [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md) §5, [GST_MODULE_DOCUMENTATION.md](GST_MODULE_DOCUMENTATION.md).
> Code: `backend/src/OfficeManagment/Marketplace/*`, `backend/src/shared/services/softwareAccess.service.js`, `backend/src/middlewares/requireSoftwareSelection.js`, `backend/src/shared/constants/software.js`. Frontend: `pages/MyApplications/MyApplicationsPage.jsx`, `components/Marketplace/*`, `Hooks/useLaunchSoftware.js`, `api/marketplaceApi.js`.

## 1. Concepts

| Concept | Meaning |
|---|---|
| **Software** (table `Software`) | A product row: `SYSTEM`, `OFFICE_MANAGEMENT`, `GST`, `TDS`, `ROC`, `DSC`. Marketplace "supported" set = `OFFICE_MANAGEMENT` + modules (`SUPPORTED_SOFTWARE_CODES`); anything else is rejected |
| **Selection** | A company (or the Admin's own office) *selects* software. Implemented as a `SoftwareSubscription` row with `status ACTIVE`, `amount 0`, `billingPeriod ONE_TIME`, `provider "SELECTION"`. **Selection is free** — the schema keeps `provider "RAZORPAY"` default, price, order/payment ids and PENDING/FAILED statuses, but **no payment gateway code exists** (searched for "razorpay": only the schema default) |
| **Scope** | `companyId` set → that OfficeFirm; `companyId = null` + `purchasedById = adminId` → the Admin's **office-level** selection (SOLO or Admin context). A SOLO Admin's software never mixes into a company's |
| **Authorization** (per user) | `SoftwareAccess` grant (`userId`+`software` enum) **or** an Office role holding the module permission (`use_gst`, `use_tds`, `use_roc`, `use_dsc`). Admin is always authorized for what the org owns |
| **Subscription liveness** | `isSubscriptionLive` = status ACTIVE and (`expiresAt` null or in the future). `effectiveStatus` treats an ACTIVE row past `expiresAt` as EXPIRED even before the sweeper runs |
| **Launch target** (`launchTargetFor`) | `GST` → `/gst-return` (in-app); `DSC` → external DSC tool URL (`https://dsc-tool-web.vercel.app/`); other codes → `/` |

## 2. Who may do what

| Action | Endpoint | Rule |
|---|---|---|
| See catalog | `GET /api/marketplace/software` | any authenticated user; items: `isActive`, `isPurchasable`, supported codes |
| Select/deselect software | `PUT /api/marketplace/selection {softwareIds}` | Admin only. With a company in context → that company (`requireOwnerAdmin`); Admin without company → office-level. New ids create ACTIVE subscriptions; ids no longer listed are set `CANCELLED` ("Deselected by owner"); unknown/unsupported ids → 400; sets onboarding step to COMPLETED |
| My Applications | `GET /api/marketplace/my-applications` (`view_my_applications`) | staff see only apps their scope selected **and** they are authorized for; Admin sees all selected + an `unavailable[]` list (EXPIRED/REVOKED) |
| Launch | `POST /api/marketplace/software/:softwareId/launch` (`view_my_applications`) | server re-checks selection + authorization (403 messages: "Your organization has not selected this software.", "This application is not available in your office.", "Access to this software is expired/revoked…", "You are not authorized to use this software."); writes audit `SOFTWARE_LAUNCHED`; returns `{launchUrl}`; frontend opens a new tab (`openLaunchWindow` / `navigateLaunchWindow` in `helpers/softwareUi.js`) |
| Assign software to users | `GET/PUT /software/:softwareId/users`, `GET/PUT /users/:userId/software` | Admin (all staff of the scope) or Branch Manager (own-team Employees, only software the manager holds); stored as `SoftwareAccess`; others' grants beyond a manager's reach are untouched |
| Revoke | `POST /subscriptions/:id/revoke` | **Super Admin only**; only ACTIVE rows (409 otherwise); status → REVOKED |
| Task software dropdown | `GET /task-software-options` | catalog with `hasAccess`; Branch Manager only `true` where they personally pass `checkUserCanUseSoftware` |

## 3. The central access check — `checkUserCanUseSoftware({user, software, ownerId, actorCompanyId})`

1. If both `actorCompanyId` and `user.companyId` exist and differ → 404 "The selected user does not belong to this company."
2. **Company level** (`actorCompanyId` set): the company must have a live subscription (`getCompanyAccess`).
   **Office level** (none): the Admin's office-level subscription first; otherwise any company owned by the Admin (`findOwnedCompanyWithLiveSoftware`) that has it live; else 403 "This application is not available in your office."
3. `resolveUserSoftwareAccess` → `{orgHasAccess, subscriptionStatus, expiresAt, userAuthorized, canLaunch}`; failure messages: "This company has not selected this application." / "…not available in your office." / "The selected user is not authorized to use this application."
4. `isUserAuthorizedForSoftware`: role ADMIN → owns the company (or is the office owner); non-admin must belong to that company (unless "detached" = office-level) and have a `SoftwareAccess` grant or a role with the module permission.

Used by: `requireSoftwareSelection("GST")` (every GST API call), `tasks.service.createTask` (creator & assignee), `taskWorkflow.service` (access verdict, launch), `marketplace.service.launchSoftware`.

`requireSoftwareSelection` specifics: Super Admin passes; the software row must exist and be active (403 "Access to GST is not enabled for your organization."); task scope from header `X-Task-Id` or `?taskId=` is accepted **only if** the task is assigned to the caller, not CANCELLED, and requires that software (`resolveTaskScope`); otherwise scope = caller's `activeCompanyId` + `orgAdminId`.

## 4. Expiry and revocation
- `expireDueSubscriptions()` (cron every 15 min + at startup) flips ACTIVE rows with `expiresAt <= now` to EXPIRED. Selections created by `saveSelection` have **no `expiresAt`** (they never expire) – expiry only applies to rows created some other way (e.g. a Super-Admin grant). Comment in code: "selections never expire".
- `NotificationType` values `SOFTWARE_ACCESS_EXPIRED`, `SOFTWARE_ACCESS_REVOKED`, `SOFTWARE_PURCHASED` exist and `SoftwareSubscription.expiryNotifiedAt` exists; a code search shows these names appear only in the notification type filter list (`Notifications/notifications.service.js`); **no code creates notifications of those types or sets `expiryNotifiedAt`** — the sweeper only updates status.

## 5. Seeds & bootstrap
- `npm run seed:software` → `seed-software-roles.js` upserts all `SOFTWARE_CATALOG` entries and built-in roles via `ensureOfficeManagement`.
- `npm run seed:marketplace` → `seed-marketplace.js` lists GST, TDS, ROC, DSC: sets description, `iconKey`, `price=null`, `isPurchasable=true`, `isActive=true`, `logoUrl=/uploads/software/<code>.png` and `Software.launchUrl` from the optional env vars `GST_SOFTWARE_LAUNCH_URL`, `TDS_SOFTWARE_LAUNCH_URL`, `ROC_SOFTWARE_LAUNCH_URL`, `DSC_SOFTWARE_LAUNCH_URL` (seed-time only; the runtime `launchTargetFor` switch ignores `Software.launchUrl` even though its comment says an explicit launch URL wins). Logos live in `backend/uploads/software/{gst,tds,roc,dsc}.png`, served at `/uploads/software/*`).
- TDS and ROC appear in the marketplace catalog and can be selected/assigned/launched (`launchTargetFor` → `/`), but **no TDS/ROC feature screens exist in this repository**.
