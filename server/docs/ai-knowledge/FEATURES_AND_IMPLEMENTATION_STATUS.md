# Features and Implementation Status

> Legend: ✅ implemented end-to-end (route/service + UI found) · 🟡 partial / UI or backend only / caveats · ⛔ not implemented (schema, enum or placeholder only) · ❓ could not be verified.
> Based on a code read of `backend/src`, `backend/prisma` and `frontend/src`. No tests were run and the app was not executed, so "implemented" means "code exists and is wired", not "bug-free". No automated test suite was found in the repository.

## 1. Core platform
| Feature | Status | Evidence / notes |
|---|---|---|
| Self-signup (always ADMIN), login, refresh rotation, logout / logout-all | ✅ | `auth.service.js`; UI `Login/*`, `Signup.jsx` |
| Google sign-in | ✅ | `auth.service.googleAuth`, `GoogleAuthButton.jsx` (needs Google env vars) |
| Forgot / reset password by e-mail | ✅ | needs SMTP; 30-min token, 60-s cooldown |
| Multi-tenant org/company model, company switcher | ✅ | `userAccess.service.js`, `CompanySwitcher.jsx` |
| SOLO vs MULTIPLE office structure, professions, onboarding steps | ✅ | `companies.service.js` |
| Roles & permissions (built-in + custom), permission matrix | ✅ | `permissions.*`; 4 permission keys not in seed catalog (see AUTH doc) |
| Super Admin console APIs (`/api/user-management/users`) | 🟡 | backend ✅; no frontend code calls these endpoints (searched `frontend/src`) |
| Office user management (create/edit/activate/deactivate, team leader, client assignment) | ✅ | `OfficeUsers`, `officeUserList`, `OfficeUserForm`, `AssignSoftwareModal` |
| Audit log table | 🟡 | written by many services (`audit()`); read UI limited to permission matrix; no audit-log list endpoint found |

## 2. Clients
| Feature | Status | Notes |
|---|---|---|
| 12 entity-type client CRUD | ✅ | `services/software/common/modules/*` |
| Client code generation | ✅ | `clientCode.util.js` |
| Share clients across owned companies | ✅ | `Client/*`, `ShareClientModals.jsx` |
| Client detail tabs (services, assignments, documents, quotations, invoices, history) | ✅ | `ClientDetail.jsx` |
| Client notes / CRM activity | ⛔ | `NotesActivityTab.jsx` is static "not tracked yet" text |
| Client Portal login + data (services, tasks, deadlines, documents upload/download, doc-request submit, invoices, quotations, appointments, notifications, profile) | ✅ | `/api/client-portal/*`; credentials auto-e-mailed |
| Module assignment flags | 🟡 | `shared/assignClientToModules.js` sets `assignToGST` (+ `gstAssignedAt/By`), `assignToTDS` (+ `tdsAssignedAt/By`), `assignToROC` from module codes `GST_RETURN`, `TDS`, `ROC`; `assignToIT`/`assignToPayroll` columns exist but nothing sets them; only GST has downstream behaviour; UI `ModuleAssignmentPopup.jsx` |

## 3. Tasks & workflow
| Feature | Status | Notes |
|---|---|---|
| Create/assign tasks, priorities, checklist, multi-client | ✅ | `tasks.service.js` |
| State machine, approval, reassign, history, activity timeline | ✅ | `task.permissions.js` |
| Due-date change + reminders (3d/1d/due/overdue/custom) + scheduler | ✅ | `Duedates.service.js`, cron |
| Software tasks: launch, evidence submit, approve/reject/corrections | ✅ | `taskWorkflow.service.js`, `TaskWorkflowPanel` |
| Task attachments (private storage) | ✅ | `taskFiles.js` |
| Document requests to clients | ✅ | `DocumentRequests` + portal submit |
| GST return ↔ task linking and auto-complete on filing | ✅ | `onGstReturnFiled` (comment in `fileReturn` contradicts behaviour) |
| Notifications: in-app, e-mail, WhatsApp | ✅/🟡 | WhatsApp/e-mail depend on config; failures are swallowed |

## 4. Marketplace & software
| Feature | Status | Notes |
|---|---|---|
| Free software selection per company / office | ✅ | `marketplace.service.saveSelection` |
| Per-user software authorization (SoftwareAccess) | ✅ | |
| My Applications + launch | ✅ | |
| Super-Admin revoke | 🟡 | backend ✅ `POST /subscriptions/:id/revoke`; no frontend caller found |
| Paid purchase / Razorpay | ⛔ | only schema defaults |
| Subscription expiry sweeper | ✅ | but selections never carry `expiresAt`; expiry/revocation notifications not sent (enum values only) |
| GST module | ✅ | see below |
| TDS module | ⛔ | catalog entry & permission `use_tds` only |
| ROC module | ⛔ | catalog entry & `use_roc` only |
| DSC module | 🟡 | catalog entry, permission `use_dsc`, launches external URL; no in-repo DSC functionality |

## 5. Billing & documents
| Feature | Status | Notes |
|---|---|---|
| Service types master | ✅ | |
| Quotations (create/list/update/status) | ✅ | |
| Invoices from approved quotations, status, cancel (Admin) | ✅ | `pdfUrl` column exists but is never generated |
| Payments, auto invoice status | ✅ | no online gateway |
| Billing page | ✅ | `Billing.jsx` uses invoice/payment APIs |
| Coupon codes | 🟡 | `couponCode` stored on ServiceType; no redemption logic found |
| `view_client_fee_details` permission | 🟡 | referenced in `client.access.js` to mask fee data |
| Documents (Google Drive storage, view/download/delete, stats) | ✅ | requires Drive connection |
| `DocumentType` / `frequencyType` master | ⛔ | model & enum exist; no routes/UI found |

## 6. Communication, calendar, HR, reports
| Feature | Status | Notes |
|---|---|---|
| Appointments with Google Meet | ✅ | needs Google Calendar connect |
| Enquiries / leads pipeline | ✅ | |
| Client broadcast messaging (`/dynamic-messaging`) | ⛔ | UI mock; no backend |
| "Notification links" (`/notification-link`) | ⛔ | UI mock; fake random link |
| Compliance calendar (tasks + GST due dates + meetings + holidays) | ✅ | |
| GST due-date rules/overrides admin | ✅ | covers GSTR1/3B/7/9 only |
| HR attendance (check-in on login / check-out on logout) + calendar/week/year views | ✅ | EMPLOYEE & BRANCH_MANAGER only |
| Reports (7 types) with permission tiers + export | ✅ | |
| Dashboards (Practice, Manager, Employee, HR) | ✅ | |
| Profession workspaces (CA/TAX, CS, CMA, Advocate) | ⛔ | route + gating real, content = "not connected to a backend" placeholder |

## 7. GST
| Feature | Status | Notes |
|---|---|---|
| Standalone GST accounts and app (`/gst`) | ✅ | |
| GST clients / GSTIN registration (office + standalone) | ✅ | one registration per master client |
| Return generation per client/period | ✅ | |
| GSTR-1: 29 section CRUD + summaries | ✅ | |
| GSTR-1 validation engine (BLOCK/WARN, acknowledge) | ✅ | |
| Excel bulk import with staging, duplicate resolution, progress (Socket.IO + polling) | ✅ | max 20,000 rows/sheet |
| GSTR-1 JSON export | 🟡 | core tables only; amendments (B2BA…) and ECO tables excluded; best-effort mapping |
| GSTR-3B computation | 🟡 | liability from GSTR-1 outward supplies, ITC input, advance handling; cess always 0; interest/late-fee columns exist but not computed in the reviewed controller |
| GSTR-9 summary | 🟡 | aggregate totals only |
| GSTR-7 (deductee, amendment, ledger, summary, Excel import) | ✅ | |
| File / lock / unlock return | 🟡 | local placeholder ARN; **no GSTN API/EVC/DSC submission** |
| GSTR-2B, IFF screens | ⛔/❓ | return types & validations exist; dedicated screens not found |
| GSTR-9C, CMP-08, GSTR-4/8/10/11 | ⛔ | explicitly "deferred" in `gstDueDate.constants.js` |
| Accounting-software integration (company list, access requests, monthly GSTR-1 auto-import) | ✅ | hard-coded tunnel URL; sections B2B, B2CL, B2CS, CDNR, HSN, SEZ/DE |
| Admin return overview (`/api/gst/admin/return-overview`) | ✅ | Filled / Draft / Not Filled view |
| Legacy maker–checker models (`GSTTask`, `GSTUserProfile`, `GSTUserClientAssignment`), `CommunicationAddress` | ⛔ | in schema, unused in code |

## 8. AI / chatbot
| Feature | Status | Notes |
|---|---|---|
| Gemini / LLM agent | ⛔ | no code, no dependency, no env var |
| Frontend ChatWidget | 🟡 | UI + socket client exist; server events/route missing |
| Socket.IO server | 🟡 | only `join-import-room` for import progress |
| Knowledge base for the chatbot | ✅ | this `docs/ai-knowledge/` folder (documentation only) |

## 9. Quality / operations
| Item | Status |
|---|---|
| Automated tests (unit/integration/e2e) | ⛔ none found; `backend/prisma/scripts/verify-*.js` are manual isolation checks |
| Linting | frontend `eslint` configured; backend none |
| TypeScript | ⛔ (plain JS) |
| API documentation (OpenAPI) | ⛔ none; see API_DOCUMENTATION.md |
| `npm run seed:rbac` | ⛔ broken (missing `prisma/seed.js`) |
| Request logging / metrics | ⛔ console logging only |

## 10. Areas not fully analysed (be cautious when answering)
- Individual field lists of every `Client` entity form (`onboarding/form-sections/*`) and each entity's Zod/validation rules.
- Per-section GSTR-1 Zod validators (`*.validator.js`) beyond the shared checks documented.
- `Reports/reports.service.js` query details and `Dashboard/dashboard.service.js` metrics formulas.
- E-mail/WhatsApp template wording (`shared/services/templates/*`).
- `ComplianceCalendar` row synthesis for GST (`gstComplianceRow.service.js`) in detail.
- Frontend styling/CSS, the Landing page content, and many presentational components.
- Behaviour at runtime (nothing was executed), actual database contents, deployment state.
