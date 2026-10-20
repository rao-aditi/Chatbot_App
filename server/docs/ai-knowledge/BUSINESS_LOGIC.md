# Business Logic and Workflows

> Rules below were read from service code. Each section names the file that implements it. For GST-specific rules also read [GST_MODULE_DOCUMENTATION.md](GST_MODULE_DOCUMENTATION.md); for software access rules read [MARKETPLACE_AND_SOFTWARE_ACCESS.md](MARKETPLACE_AND_SOFTWARE_ACCESS.md).

## 1. Onboarding & organization

1. **Signup** (`auth.service.register`): public; role is never taken from the request. Creates `User` (status ACTIVE) + `UserSoftwareRole(OFFICE_MANAGEMENT, ADMIN)` in one transaction. No company is created. Duplicate e-mail → 409; duplicate phone → 409.
2. **Office structure** (`companies.service.setOfficeStructure`): first-time choice `SOLO` (the Admin is the office; no OfficeFirm) or `MULTIPLE` (can create companies). Final – changing → 409 "The office structure has already been chosen." An Admin who already owns companies is treated as MULTIPLE without a stored value.
3. **Professions** (`setOfficeProfessions` / `setCompanyProfessions`): ordered by `PROFESSION_ORDER`; when `onboardingStep` is PROFESSION and ≥1 profession is chosen it advances to MARKETPLACE. Professions drive the sidebar "Services" workspaces (CA/TAX → `/workspace/ca-tax`, CS, CMA, ADVOCATE).
4. **Software selection** (`marketplace.saveSelection`) sets onboarding step to COMPLETED. UI does not force onboarding (comment in `AppShell.jsx`): new accounts land on the dashboard.
5. **Companies** (`createCompany`): OfficeFirm with partners (designation PROPRIETOR/PARTNER/PAID_CA) and addresses; owner cache invalidated so the new company is usable immediately.

## 2. Users, roles, teams
- Staff are created by Admin (any role), HR (EMPLOYEE & BRANCH_MANAGER) or a Branch Manager with `create_user` (own-team Employees). `requiresCompanyAssignment` roles get exactly one company chosen by the creating Admin (from `activeCompanyId`), others none.
- `teamLeaderId` links an Employee to a Branch Manager; team rules govern task assignment (`task_assign_team`), reassignment, approval-if-enabled.
- `clientIds` on the user = explicit client assignment (Admin only may set it).
- Deactivating a user (`status=INACTIVE`) blocks login and API access immediately (cache invalidated).
- Attendance: on every login, EMPLOYEE and BRANCH_MANAGER get a `PRESENT` attendance row for today with `checkIn` (first login of the day only). Admin/HR logins are not tracked. On logout (`auth.service.logout`, using the refresh token) a `checkOut` time is recorded for the same two roles (`attendance.service.recordCheckOut`).

## 3. Clients
- Created per entity type through 12 endpoint groups; `code` auto-generated (3 letters + 3-digit sequence). Client `status` ACTIVE/INACTIVE.
- **Visibility**: `view_all_clients` sees the whole org; `view_assigned_clients` sees clients linked to tasks they created/lead/are assigned; `view_client_via_task` only via tasks assigned to them; explicit `User.clientIds` always add access.
- **Company sharing**: a client belongs to ≤1 company (`Client.companyId`) but an Admin can share it into other companies they own (`CompanyClient`); company-context lists include shared clients.
- **Module assignment flags**: `assignToGST/IT/Payroll/ROC/TDS`; `gstAssignedAt/By` recorded when GST is assigned.
- **Client Portal access**: when `portalAccess` is enabled and the client has an e-mail, a random password is generated, hashed, and e-mailed with the portal URL; disabling wipes the hash. No e-mail on file → provisioning skipped (warning logged). Portal sessions are blocked when `status != ACTIVE` or `portalAccess=false`.

## 4. Tasks (Office Management)

### 4.1 Creation (`tasks.service.createTask`, permission `create_task`)
- Validates: ≥1 client id (int), title, `serviceTypeId` (int), `assignedToId` (uuid), priority (LOW/MEDIUM/HIGH/URGENT), optional dueDate/description/remarks/checklistItems/`requiresApproval` (default **true**).
- Assignee must be ACTIVE, hold `task_receive`, be in the actor's org (`assertSameOrg`); actor needs `task_assign_any` (anyone in org) or `task_assign_team` (self or own team). With a company in context the assignee must belong to that company (Admin-owner exception).
- Clients must be active and must be ones the **assignee** may access (not the actor's wider scope).
- Optional `requiredSoftwareId`: software must exist; actor's scope must have an ACTIVE selection of it (403 "You do not have access to this application."); non-Admin creators must be individually authorized; the **assignee** must also be authorized (`assertAssigneeCanUseSoftware`).
- Task starts as **ASSIGNED** (not DRAFT), `adminId = actor.orgAdminId`, `companyId = actor.activeCompanyId` (server-derived only). Writes `TaskClient`, status history ("Task created and assigned"), checklist, audit log `TASK_CREATED`, activity timeline entries, then (post-commit, not awaited) notifications and default reminders.

### 4.2 Status state machine (`Tasks/task.permissions.js`)
```
DRAFT      → ASSIGNED, CANCELLED
ASSIGNED   → IN_PROGRESS, CANCELLED, OVERDUE
IN_PROGRESS→ SUBMITTED, CANCELLED, OVERDUE
SUBMITTED  → APPROVED, REJECTED, COMPLETED*, CANCELLED      (* removed when requiresApproval = true)
REJECTED   → IN_PROGRESS, CANCELLED
APPROVED   → COMPLETED
OVERDUE    → IN_PROGRESS, SUBMITTED, CANCELLED
COMPLETED  → (terminal)
CANCELLED  → ASSIGNED (via reassign)
```
- `assertCanSetStatus`: APPROVED/REJECTED require `approve_task` or `approve_task_if_enabled` (the latter fails when `requiresApproval === false`: "Task approval is not enabled for this task.") and the task must be SUBMITTED. Users with `update_task_status` may set other transitions; others only the assignee may move to IN_PROGRESS / SUBMITTED / COMPLETED (COMPLETED not allowed when approval required).
- Generic `PATCH /status` with COMPLETED requires prior APPROVED when `requiresApproval`.
- **Software tasks** (`requiredSoftwareId` set) cannot use the generic endpoint for SUBMITTED/APPROVED/REJECTED/COMPLETED – 400 "This task uses the software completion workflow…".
- Changing `dueDate` through status update requires `change_due_date`, or `request_due_date_change` and being the assignee.
- Every change writes `TaskStatusHistory`, an audit log `TASK_STATUS_CHANGED`, and a `TaskActivity`; SUBMITTED notifies approvers, APPROVED/REJECTED notifies the assignee.

### 4.3 Reassignment (`reassignTask`)
Needs `reassign_task` (anywhere in org) or `reassign_task_within_team`. Only tasks in **DRAFT, ASSIGNED or CANCELLED** can be reassigned; otherwise the task must be cancelled first (messages: "…already completed…", "…approved…", "…work has started. Please cancel…"). A cancelled task moves back to ASSIGNED for the new assignee.

### 4.4 Due dates and reminders (`DueDates_Remainders/Duedates.service.js`)
- `changeTaskDueDate`: needs `change_due_date` or `request_due_date_change`; cannot change a COMPLETED task; writes an AuditLog `TASK_DUE_DATE_CHANGED`; cancels pending non-CUSTOM reminders and reschedules defaults.
- `scheduleDefaultReminders(taskId, dueDate, userId)`: three reminders at **09:00** — 3 days before (`THREE_DAYS_BEFORE`), 1 day before (`ONE_DAY_BEFORE`), on due date (`ON_DUE_DATE`); only future times are created. Custom reminders (`CUSTOM`) are user-created.
- `processPendingReminders` (cron): up to 200 `PENDING`, active reminders with `remindAt <= now`; sends notifications (in-app + e-mail + WhatsApp via `notifyDueReminder`), marks SENT or FAILED.
- `processOverdueTasks` (cron): tasks not COMPLETED/CANCELLED/OVERDUE with `dueDate < now` become **OVERDUE** (history row "Automatically marked overdue by system scheduler") **except** software-workflow tasks currently SUBMITTED (waiting on approver). An OVERDUE reminder is created for the assignee.

### 4.5 Checklist & activity
Checklist items (title, completed by/at) can be added/toggled/deleted by the permissions listed in API doc §6.1. `TaskActivity.action` values come from `Tasks/task.activity.js#ACTIVITY` = TASK_CREATED, TASK_ASSIGNED, TASK_REASSIGNED, STATUS_CHANGED, TASK_STARTED, REWORK_STARTED, SOFTWARE_LAUNCHED, ATTACHMENT_ADDED, EVIDENCE_SUBMITTED, SUBMITTED_FOR_APPROVAL, APPROVED, REJECTED, CORRECTIONS_REQUESTED, COMPLETED, DOCUMENT_DELETED, GST_RETURN_LINKED, GST_RETURN_FILED. Activity entries deliberately contain no filing references or client data.

## 5. Software task workflow (`TaskWorkflow/taskWorkflow.service.js`)
Applies only to tasks with `requiredSoftwareId`.

```
ASSIGNED ─(start / launch)→ IN_PROGRESS ─(submit evidence)→ SUBMITTED  (UI: "Pending Approval")
SUBMITTED ─(approve)→ APPROVED → COMPLETED   (one transaction; both transitions recorded)
SUBMITTED ─(reject | request corrections)→ REJECTED (UI: "Rework Required") ─(start rework)→ IN_PROGRESS
```
- **Start**: allowed from ASSIGNED, OVERDUE, REJECTED (assignee only).
- **Launch**: verifies the assignee's software access in the task's scope (company task → company; Admin-level task → Admin's office-level selection); returns `launchUrl` (`/gst-return` for GST, an external URL for DSC, `/` otherwise) and records activity. Access verdict gives `mode`: `ORG_SOFTWARE` if the org has the software and the user is authorized, else `EXTERNAL_SOFTWARE`.
- **Submit** (assignee only; statuses ASSIGNED/IN_PROGRESS/OVERDUE): validation (`validateSubmission`): `filingDate` required, `YYYY-MM-DD`, not more than 1 day in the future, year ≥ 2000; `referenceLink` ≤500 chars, http(s) URL or in-app path starting with `/` — **required** in ORG mode; in EXTERNAL mode `externalSoftwareName` (2–120 chars) and ≥1 screenshot are required; `completionNotes` ≤2000. If a GST return is linked and mode is ORG, the return must be `FILED` first (422). Screenshots (max 5, 10 MB each, validated by magic bytes: pdf, png, jpg, gif, webp, docx/xlsx/doc/xls…) are stored as Documents in the submitter's **Google Drive** (403 if Drive not connected). A `TaskSubmission` row with `round = last+1`, `decision=PENDING` is created and the task moves to SUBMITTED. Only one PENDING submission is allowed.
- **Review** (`reviewSubmission`): decision `APPROVE | REJECT | REQUEST_CORRECTIONS`; comment mandatory for non-approvals (≤1000 chars). Reviewer rules (`canReviewTask`): must hold an approval permission; cannot review own work unless ADMIN; org-wide `approve_task` holders may review any, others only tasks they assigned or whose assignee they lead. Approval sets status APPROVED then immediately COMPLETED (`completedAt` set) – this is the only path to COMPLETED for software tasks. Rejection/corrections → REJECTED. Notifies the assignee, audit `TASK_SUBMISSION_<decision>`.
- **Attachments**: task creators (`create_task`) or `upload_documents` holders can add up to 10 supporting files/request; stored in `PRIVATE_UPLOAD_DIR`; only the uploader may delete their file.
- **GST return linking**: assignee links a return (`link-gst-return`) – returns that belong to the task's clients and are not already linked are offered. When a return is filed (`gst-return.controller.fileReturn`), `onGstReturnFiled` runs: if the return is not linked, it auto-links to the filer's **single** open GST task for that client (ambiguous or none → nothing happens); then the linked task is **moved straight to COMPLETED** ("Auto-completed on GST return filing"), history/activities are written, and the task's assigner gets a "GST return filed" notification (only once per completion). If the task is already COMPLETED/CANCELLED only an activity entry is logged. *Note:* a comment in `fileReturn` claims the task is completed only by the approver, which contradicts this implementation — the code in `taskWorkflow.service.js` is authoritative.

## 6. Document requests and documents
- Staff create a `DocumentRequest` for a client (optionally tied to a task/service type) → client notified in the portal; the client uploads via `POST /api/client-portal/document-requests/:id/submit` which creates a `Document` (source CLIENT, stored under `backend/uploads/client-portal/<clientId>/`) and links `submittedDocumentId`; staff get a `DOCUMENT_SUBMITTED` notification; status flows PENDING → SUBMITTED → APPROVED/REJECTED (or CANCELLED/OVERDUE).
- Document access: a client-linked document is visible only to users who may access that client; a task document only to people involved in the task; uploader always keeps access; Admin limited to own org. Staff uploads need the uploader's Google Drive connected.

## 7. Billing chain (`Quotations`, `Invoices`, `Payments`, `ServiceTypes`)
1. **ServiceType** defines default `serviceCharges`, `taxRate`, `discountAllowed`.
2. **Quotation** (`create_quotation`): `QTN-` + (row count + 1) padded to 5 digits, retried on unique conflict (409 after repeated conflicts). Requires service type and ≥1 client; `taxRate` defaults to the service type's; **finalAmount = round((max(0, charges − discount) × (1 + tax%)) , 2)**. Status DRAFT→SENT→APPROVED/REJECTED/EXPIRED. Non-admin readers see quotations only for clients they can access.
3. **Invoice** (`generate_invoice`): only from an **APPROVED** quotation, only one invoice per quotation; if the quotation is tied to a task the task must be COMPLETED or APPROVED (unless `adminOverride`); client = first client of quotation; number `INV-` + (max existing number + 1) padded to 5 digits; copies charges/tax/discount; `total = quotation.finalAmount`. Only an Admin may set status CANCELLED or edit an invoice (`updateInvoice` recomputes total with the same formula).
4. **Payment**: records amount/mode/date; after every payment `syncInvoicePaymentStatus` sums payments with status SUCCESS: `total paid ≥ invoice total → PAID`; `>0 → PARTIALLY_PAID` (never moves backwards automatically).
5. Clients see their invoices and quotations in the portal (read-only).

## 8. Communication
- **Appointments**: created with optional Google Meet link (`generateMeetLink` uses the organizer's connected Google Calendar; failures don't block creation unless 403); client gets portal notification + e-mail; updates sync the Calendar event; moving an open meeting to a future time resets OVERDUE → SCHEDULED; cron marks SCHEDULED meetings whose time has passed as **OVERDUE** every 5 min; delete/cancel removes the Calendar event.
- **Enquiries/Leads**: statuses NEW → CONTACTED → QUALIFIED → PROPOSAL → NEGOTIATION → WON/LOST; `convertedAt` set automatically the first time status becomes WON; `/stats` returns counts per status.

## 9. Compliance calendar & GST due dates
- `ComplianceCalendar/complianceCalendar.service.js` merges: tasks (scoped by role; HR sees HR-type categories `HR_TASK, PAYROLL, EMPLOYEE_DOCUMENT, TAX_DECLARATION`), GST rows (`buildGstComplianceRows`), appointments (status mapped to COMPLETED / OVERDUE / DUE_TODAY / UPCOMING (≤7 days) / PENDING) and office holidays.
- GST due dates (`gst/compliance-calendar/gstDueDate.service.js`): resolved at read time from `GstDueDateOverride` (specific FY+period, e.g. government extension) first, then `GstDueDateRule`; the most specific match wins (taxpayer category/state specificity, newer `effectiveFrom`, org's own row over global). `computeDueDate`: MONTHLY/QUARTERLY = period end month + `monthOffset` → `dayOfMonth`; ANNUAL = (`dueMonth`,`dueDay`) in FY-end-year + `dueYearOffset`; EVENT_BASED = `eventOffsetDays` after cancellation date. Covered compliance types: GSTR1, GSTR3B, GSTR7, GSTR9 only (comments say GSTR-9C, CMP-08, GSTR-4/8/10/11 are deferred). Taxpayer classification: COMPOSITION, QRMP (REGULAR + `qrmpStatus`), REGULAR, CASUAL_TAXABLE, NON_RESIDENT, else ANY. Admin edits rules/overrides via `/api/gst/compliance-calendar/*` (requires `requireAdmin`).
- Marking complete: `PATCH /api/compliance-calendar/events/:sourceType/:sourceId/complete` handles `TASK` and `GST`.

## 10. Notifications
`notification.service.notify`: always creates in-app `Notification` rows (company context derived from the task), then, if provided, e-mails (nodemailer) and WhatsApp (Vonage; skipped when user has no phone). Failures are logged and never fail the originating action. Triggers: task assigned, task submitted, task decision (approved/rejected/corrections), due reminders/overdue, document submitted by client, GST return filed (task assigner), software access expired/revoked/purchased types exist in the enum. Client-facing notifications use `ClientNotification` (+ e-mail for appointments/credentials).

## 11. Reports, HR, dashboards
- Report tiers (`Reports/report.permissions.js`): `view_all_reports` → all 7 reports; `view_operational_reports` → tasks, overdue, staff-performance; `view_own_reports` → own task report only; `view_hr_workforce` → staff-performance for the whole company without client/billing reports (clients, fees, invoices, payments are admin-only).
- HR attendance endpoints return overview, month calendar, week and year views scoped by the same visibility rule as office-users.
- `Dashboard.getPracticeDashboard` aggregates tasks/clients/revenue (monthly trend) for the Admin dashboard; other roles have separate dashboard pages.

## 12. Data-safety rules worth remembering
- Cross-org ids return 404 (never 403) to prevent probing.
- `companyId`/`adminId` can never be supplied by clients; derived from `req.user`.
- Passwords/hashes are never returned (`password` removed from user payloads; GST client detail strips credentials; portal password only ever e-mailed).
- Email/WhatsApp failures never break business actions.
- Software logos are the only publicly served uploads.
