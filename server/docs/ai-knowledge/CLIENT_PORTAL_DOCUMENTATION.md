# Client Portal Documentation

> Additional deep-dive file. The Client Portal lets a practice's **clients** (not staff) log in and view their own data. Related: [API_DOCUMENTATION.md](API_DOCUMENTATION.md) §13, [AUTHENTICATION_AND_PERMISSIONS.md](AUTHENTICATION_AND_PERMISSIONS.md) §1, [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md) §3 & §6.
> Backend: `backend/src/OfficeManagment/{ClientAuth,ClientPortal,Client}/`, `middleware/authenticateClient.js`. Frontend: `frontend/src/office_Managment_Frontent/{pages/ClientPortal,clientPortal}/`.

## 1. Enabling portal access (staff side)
1. A client has `portalAccess` (boolean) and optionally `email` on the `Client` row (set in the client form / onboarding).
2. When a client is created through any entity module, `createClientWithGeneratedCode` calls `syncPortalAccess`. When `portalAccess` is true and an e-mail exists, `provisionPortalAccess` generates a **12-character random password**, stores only the bcrypt hash (`portalPasswordHash`, `portalPasswordSetAt`) and e-mails the plaintext password + `CLIENT_PORTAL_LOGIN_URL` using the `clientPortalCredentials` template. The password is never logged or returned to staff.
3. Turning access off (`revokePortalAccess`) clears the hash and timestamp. No e-mail on file → provisioning is skipped with a console warning.
4. `GET /api/client/portal-eligible` lists clients that can be given portal access.

## 2. Login & session
- `POST /api/client-portal/auth/login {email, password}` (rate-limited with the shared auth limiter). Requires an ACTIVE client with `portalAccess`, matching e-mail and password; generic 401 for any failure. Updates `portalLastLoginAt`.
- Tokens: access (`JWT_CLIENT_ACCESS_SECRET`, `{id,type:"client"}`, default 1 day) and **stateless** refresh (7 days). A refresh is honoured only while portal access is still enabled and not issued before the last password change (`portalPasswordSetAt`) — changing or revoking credentials ends sessions.
- Frontend session helpers in `clientPortal/clientSession.js` (`isClientSession`, `getClientAccessToken`, `clearClientSession`); keys `om_client_access_token`, `om_client_refresh_token`, `om_client_session_id`. `ClientPortalPage` verifies access on mount (`clientPortalAuthApi` → `GET /api/client-portal/auth/me`) and redirects to `/client-portal/login` if denied.

## 3. What a client can see/do (all scoped to their own `clientId` from the token)
| Menu (frontend) | Route | Backend |
|---|---|---|
| Dashboard | `/client-portal/dashboard` | `GET /dashboard` |
| My Services | `/client-portal/services` | `GET /services` — tasks/invoices/quotations/documents/document-requests grouped by ServiceType, computed live |
| Tasks & Assignments | `/client-portal/assignments` | `GET /tasks` (read-only) |
| My Documents | `/client-portal/documents` | `GET /documents`, `POST /documents/upload` (multipart `file`, ≤10 MB, optional `documentRequestId`, `description`), `GET /documents/:id/download|view` (own documents, uploaded by them or by staff for them), `GET /document-requests`, `POST /document-requests/:id/submit` |
| Appointments | `/client-portal/appointments` | `GET /appointments` (internal fields like adminId/companyId/attendeeIds/googleEventId are not selected) |
| Deadlines | `/client-portal/deadlines` | `GET /deadlines` — upcoming vs overdue from tasks **and** pending document requests |
| Payments & Invoices | `/client-portal/payments` (old `/invoices`, `/quotations` redirect here) | `GET /invoices`, `/invoices/:id`, `/quotations` — invoices in every status except CANCELLED (DRAFT included, because in practice invoices stay DRAFT), quotations view-only |
| Notifications | `/client-portal/notifications` | `GET /notifications`, `/notifications/unread-count`, `PATCH /notifications/:id/read`, `POST /notifications/read-all` |
| My Profile | `/client-portal/profile` | `GET /profile` |
| (activity feed) | — | `GET /activity` — unified read-only feed built live from existing tables |

The portal's **only write actions** are the two document uploads (comment in `portal.routes.js`).

## 4. Notifications to clients
`ClientNotification` rows are created by `ClientPortal/portalNotify.service.js` (never throws): types `TASK, DOCUMENT, DOCUMENT_REQUEST, INVOICE, DEADLINE, APPOINTMENT, QUOTATION, GENERAL` with optional `linkPath`, `relatedId`, `relatedType`. Appointments additionally send an e-mail ("Meeting scheduled: …"). When a client submits a requested document, staff get a `DOCUMENT_SUBMITTED` notification (`notifyDocumentSubmitted`).

## 5. Security properties (verified)
- Separate JWT secrets/payload types from staff tokens; staff middleware rejects client tokens (different secret) and vice-versa.
- A client id is never read from the request; every service takes it from `req.clientUser.id`.
- Client uploads are stored under `backend/uploads/client-portal/<clientId>/` (not statically served); downloads stream through authenticated endpoints with path-traversal guards.
- `ProtectedLayout` confines a client session to `/client-portal*`, `/officeManagment_DashBoard`, `/login`; `AppRoutes` renders only portal routes when `userRole === "client"`.
- The GST client detail endpoint (`gst-client.controller.js#getGstClientDetail`) strips credential/secret fields (such as the portal password hash) before responding; other staff client endpoints were not individually checked for this **[UNVERIFIED]**.
