# Project Glossary

> Project-specific terms, entities and abbreviations as they are used in this codebase. Cross-references point to the file where the term is explained in detail.

## A. Product & organization terms
| Term | Meaning in this project |
|---|---|
| **Office Management (OM)** | The main software (`Software.code = "OFFICE_MANAGEMENT"`): clients, tasks, billing, documents, HR, communication. The only software that owns roles |
| **Module** | A software organised under Office Management with no roles of its own: `GST`, `TDS`, `ROC`, `DSC`. Access is controlled by `use_gst`, `use_tds`, `use_roc`, `use_dsc` or a `SoftwareAccess` grant |
| **SYSTEM** | Pseudo-software that owns the `SUPER_ADMIN` role |
| **Super Admin** | Platform operator. Passes software gates, sees all orgs (`orgAdminId = null`), holds every active permission |
| **Admin** | Practice owner / organization root. `User.id` of the Admin is the **org id** stored as `adminId` on all org-owned records |
| **Org / `orgAdminId`** | Tenant boundary: `resolveOrgAdminId(user)` = null (Super Admin), own id (ADMIN) or `User.adminId` (staff) |
| **Branch Manager (BM)** | Team lead role (`BRANCH_MANAGER`); may assign within team, approve if enabled |
| **Employee / Member** | `EMPLOYEE`; staff who receive tasks. Reports to a Branch Manager via `teamLeaderId` |
| **HR** | `HR` role: workforce, attendance, can create Employees & Branch Managers |
| **Custom role** | Admin-created role (`Role.adminId` = org, `isSystem=false`) |
| **Company / Firm / OfficeFirm** | A sub-entity owned by an Admin (multi-company practice); table `OfficeFirm`. Staff roles with `requiresCompanyAssignment` belong to exactly one |
| **Office-level / Admin context** | Acting with no active company (`activeCompanyId = null`; header `X-Company-Id` absent or `admin`). There is **no "Main Office" record** |
| **SOLO / MULTIPLE** | `officeStructure`: single-office practice vs. multi-company practice (final choice) |
| **Active company** | `req.user.activeCompanyId` resolved from `X-Company-Id` (Admin) or `User.companyId` (staff) |
| **Profession** | `OfficeFirmProfession`: CA, CS, CMA, TAX_CONSULTANT, ADVOCATE (CLIENT exists in enum, hidden from lists). Drives sidebar workspaces |
| **Practice (code)** | frontend mapping of profession → workspace key: CA→`CA`, TAX_CONSULTANT→`TAX`, CS, CMA, ADVOCATE (`usePracticeTypes.js`) |
| **Onboarding step** | `PROFESSION` → `MARKETPLACE` → `COMPLETED` |
| **Selection** | A company/office choosing a software in the marketplace (free; a `SoftwareSubscription` with provider `SELECTION`) |
| **Subscription (`SoftwareSubscription`)** | Row granting a company/office access to a software; statuses PENDING, ACTIVE, EXPIRED, CANCELLED, REVOKED, FAILED |
| **My Applications** | Page/API listing the software the current user can open (`view_my_applications`) |
| **Launch** | Server-authorized opening of a software (`POST /api/marketplace/software/:id/launch`) |
| **Detached staff** | Staff whose own company is missing/invalid; resolved through their Admin's scope (`detached` flag in `softwareAccess.service.js`) |

## B. Clients
| Term | Meaning |
|---|---|
| **Client** | A customer of the practice (table `Client`, Int id). Not a UI "client" in the HTTP sense |
| **Entity type** | One of 12 `EntityType` values; frontend uses "status codes" `01,03,05,07,08,09,10,11,12,13,14,16` for them (`entityEndpoints.js`) |
| **Client code** | `Client.code` = first 3 letters of name + 3-digit sequence (e.g. `ABC001`) |
| **Shared client** | A client made visible in another owned company through `CompanyClient` |
| **Portal Access** | `Client.portalAccess` flag enabling Client Portal login with an auto-generated, e-mailed password |
| **Client Portal** | Separate login area for clients (`/client-portal/*`) |
| **Explicit client assignment** | `User.clientIds` (Int[]) — clients directly assigned to a user |
| **Master client** | Office `Client` that a `GSTClient` registration is linked to (vs. standalone-owned GST clients) |

## C. Tasks & workflow
| Term | Meaning |
|---|---|
| **Task** | Unit of work assigned to a user for one or more clients; statuses DRAFT, ASSIGNED, IN_PROGRESS, SUBMITTED, APPROVED, REJECTED, COMPLETED, OVERDUE, CANCELLED |
| **`requiresApproval`** | Task flag (default true): COMPLETED cannot be reached without approval |
| **Assigner / Assignee** | `Task.assignedBy` / `Task.assignedTo` |
| **Software task / Required software** | Task with `requiredSoftwareId`; uses the evidence workflow |
| **Workflow** | `TaskWorkflow` module: start → launch → submit evidence → review |
| **Submission / round** | `TaskSubmission` per attempt (`round` increments); `decision` PENDING/APPROVED/REJECTED/CORRECTIONS_REQUESTED |
| **ORG_SOFTWARE vs EXTERNAL_SOFTWARE** | Submission mode: done in the organization's own selected software vs. another tool (needs software name + screenshot) |
| **Evidence** | Filing date, reference link, notes, screenshots submitted for approval |
| **Pending Approval / Rework Required** | UI labels for SUBMITTED / REJECTED in the software workflow |
| **Request corrections** | Review decision `REQUEST_CORRECTIONS` (recorded as `CORRECTIONS_REQUESTED`, task goes to REJECTED) |
| **Reminder types** | THREE_DAYS_BEFORE, ONE_DAY_BEFORE, ON_DUE_DATE, OVERDUE, CUSTOM |
| **Compliance category** | `TaskComplianceCategory` (GST_COMPLIANCE, HR_TASK, PAYROLL, EMPLOYEE_DOCUMENT, TAX_DECLARATION, BRANCH_COMPLIANCE, LICENSE_RENEWAL, GENERAL, MEETING) |
| **Document request** | Staff request for a document from a client (`DocumentRequest`) |
| **Service type** | Billable service master (`ServiceType`): charges, tax rate, discount flag |
| **QTN / INV numbers** | `QTN-00001`, `INV-00001` formats for quotations/invoices |

## D. Permissions (selected)
| Key | Meaning |
|---|---|
| `view_all_clients` / `view_assigned_clients` / `view_client_via_task` | three client-visibility tiers |
| `task_assign_any` / `task_assign_team` / `task_receive` | who may assign / receive tasks |
| `approve_task` / `approve_task_if_enabled` | org-wide approval vs. approval only where task `requiresApproval` and within team |
| `change_due_date` / `request_due_date_change` | direct vs. limited (assignee) due-date changes |
| `view_all_reports` / `view_operational_reports` / `view_own_reports` / `view_hr_workforce` | report tiers |
| `manage_roles` / `create_user` / `list_users` / `deactivate_user` | role & user admin |
| `use_gst` / `use_tds` / `use_roc` / `use_dsc` | module access through role |
| `view_my_applications`, `view_communication`, `manage_communication`, `view_compliance_calendar` | portal-gate keys not in the seed catalog |
Full list: [AUTHENTICATION_AND_PERMISSIONS.md](AUTHENTICATION_AND_PERMISSIONS.md).

## E. GST terminology (as used here)
| Term | Meaning |
|---|---|
| **GST / GSTIN** | Goods & Services Tax / 15-char registration number validated with state code, PAN pattern and check digit (`GSTIN_CHECKSUM`) |
| **GSTClient** | GST registration record (`gstin` unique) linked to a master `Client` or owned by a `GstUser` |
| **GstUser / Standalone GST** | Self-registered user of the standalone GST software (`/gst`), separate table and tokens |
| **Return / `GSTReturn`** | One filing for client × FY × period × return type; statuses DRAFT … FILED / LOCKED |
| **Return types** | GSTR1, GSTR3B, GSTR2B, IFF, GSTR7, GSTR9 |
| **Period** | `YYYY-MM` (monthly) or `YYYY-Qn` (quarterly); FY runs April–March |
| **QRMP** | Quarterly Return Monthly Payment scheme — `GSTClient.qrmpStatus` + REGULAR registration |
| **IFF** | Invoice Furnishing Facility (optional monthly B2B upload for QRMP); limit ₹50,00,000 in validation |
| **ARN** | Acknowledgement Reference Number — **generated locally** on filing (`ARN<timestamp><rand>`) |
| **FILED / locked** | After filing `isLocked=true`; edits rejected until an Admin unlocks (→ DRAFT) |
| **GSTR-1 sections** | B2BSEZDE (B2B + SEZ + deemed exports), B2BA, B2CL(A), B2CS(A), CDNR(A), CDNUR(A), EXP(A), AT/ATA (advances received), ATADJ/ATADJA (advances adjusted), EXEMP (nil/exempt/non-GST), HSN (HSN summary), DOCS (documents issued), ECO* (e-commerce operator supplies) — suffix **A** = amendment |
| **B2B / B2C** | Business-to-business (registered recipient) / business-to-consumer (unregistered) |
| **B2CL / B2CS** | B2C **L**arge (inter-state, large value) / B2C **S**mall (aggregated) |
| **CDNR / CDNUR** | Credit/Debit Notes to **R**egistered / **U**n**R**egistered persons |
| **EXP / EXPWP / EXPWOP** | Exports / with payment of tax / without payment |
| **SEZ / DE** | Special Economic Zone / Deemed Export |
| **ECO** | E-Commerce Operator; `ECOURP*` = supplies to unregistered persons via ECO; `ECOAURP*` = their amendments |
| **HSN / UQC** | Harmonised System of Nomenclature code (4/6/8 digits) / Unit Quantity Code |
| **POS (Place of Supply)** | `PlaceOfSupply` enum, values like `DL_07` (state name + 2-digit GST state code) |
| **Rate enum** | RATE_0 … RATE_40 (percent: 0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40) |
| **Reverse charge** | `ReverseCharge` YES/NO |
| **CGST / SGST / IGST / Cess** | Central / State / Integrated GST and cess components |
| **ITC / IMS** | Input Tax Credit / Invoice Management System status (PENDING/ACCEPTED/REJECTED in `ImsStatus`) |
| **Advance / Adjusted advance** | `OutwardSupply.supplyType = ADVANCE`; "adjusted" advances reduce liability in GSTR-3B |
| **GSTR-3B** | Summary return with ITC and net liability (`GSTR3B` table) |
| **GSTR-7 / deductee** | TDS-under-GST return; `GSTR7Deductee` = person from whom tax was deducted; cash ledger entries keyed by **CIN** |
| **GSTR-9** | Annual return (summary here) |
| **Validation issue** | `GSTR1ValidationIssue` with `severity` **BLOCK** (prevents filing) or **WARN** (must be acknowledged) |
| **Draft / staging / batch** | `GSTR1ImportDraft` rows grouped by `importBatchId`; committed to real tables after review |
| **Import room** | Socket.IO room named by the client-generated `importId` |
| **Due-date rule / override** | `GstDueDateRule` (generic) / `GstDueDateOverride` (specific FY+period extension) |
| **Accounting software** | External partner system queried via `x-api-key`; `AccountingAccessRequest` with period `PERMANENT` (connection) or `YYYY-MM` (data pull) |
| **Offline tool JSON** | GSTN GST Offline Tool GSTR-1 JSON (`/gstr1-json`) |

## F. Technical abbreviations
| Abbrev | Meaning |
|---|---|
| **RBAC** | Role-based access control (roles → permission keys) |
| **JWT** | JSON Web Token (access/refresh) |
| **TTL cache** | In-process cache with expiry (`shared/utils/ttlCache.js`) |
| **BM / HR / OM / FY / POS / CIN / ARN / ITC / HSN / UQC / SEZ / ECO** | see above |
| **RAG** | Retrieval-Augmented Generation — intended use of this documentation folder |
