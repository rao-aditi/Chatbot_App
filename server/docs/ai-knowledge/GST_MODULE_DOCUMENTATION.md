# GST Module Documentation

> Additional deep-dive file. Related: [API_DOCUMENTATION.md](API_DOCUMENTATION.md) §15, [DATABASE_DOCUMENTATION.md](DATABASE_DOCUMENTATION.md) §7–9, [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md) §5 & §9, [FRONTEND_DOCUMENTATION.md](FRONTEND_DOCUMENTATION.md) §5.
> Backend root: `backend/src/gst/`. Frontend root: `frontend/src/gst_Frontend/`.

## 1. Two ways to reach the GST software

| | Office Management ("module") | Standalone GST Software |
|---|---|---|
| UI base path | `/gst-return/*` (inside `ProtectedLayout`) | `/gst/*` (own login pages `/gst/login`, `/gst/register`, …) |
| Who | office staff with `use_gst` (or a `SoftwareAccess` grant) in an org/company that **selected GST**; Admin always; Super Admin bypass | self-registered `GstUser` |
| API prefix | `/api/gst`, `/api/gstr1`, `/api/gstr7`, `/api/getGstEnums` behind `requireSoftwareSelection("GST")` | `/api/gst-user/...` behind `gstBusinessAuth` + `requireStandalone` |
| Clients | master `Client` (Office) → `GSTClient` registration (1:1, `GSTClient.clientId`) | `GSTClient.ownerGstUserId = me`; created directly through `/api/gst-user/gst/clients` using the same client form (whole payload kept in `GSTClient.profile` JSON) |
| Can see the other's data? | **No** – office staff never see standalone-owned GST clients; standalone users only see their own | |
| Landing page | Admin → Return Overview (`/api/gst/admin/return-overview`); others → client list | client list |

The same React screens and the same Express routers serve both; the frontend rewrites URLs (`gstMode.js`), the backend mounts routers twice (`server.js` → `GST_LINE_ITEM_MOUNTS`).

### Launching GST from a task
`Task.requiredSoftware = GST` → task page "Open Software" → `POST /api/task/:id/workflow/launch-software` → frontend opens `/gst-return?taskId=<id>`. `GstLayout`'s `useTaskClientRedirect` calls `GET /api/gst/clients?taskId=…&limit=2`; one client → redirects straight to `/gst-return/<clientId>/returns-filing?taskId=…`, otherwise shows the task-scoped client list. Every GST API call carries `X-Task-Id` so the backend validates software access in the **task's** scope (assignee only). `GET /api/gst/clients` with `taskId` is restricted to that task's clients.

## 2. Access control inside GST (`gst/utils/scopeGuard.js`)
- Standalone user → only `GSTClient.ownerGstUserId = user.id`.
- Office user → GST clients with `ownerGstUserId = null`, `clientId != null` and whose master `Client` satisfies the Office client-visibility rules (same org/company or shared, plus permission tier or explicit assignment). Super Admin sees all office clients. No org → only explicitly assigned clients.
- `findAccessibleGstClient`, `assertGstClientAccess`, `assertGstReturnAccess` return **404** for both "missing" and "not allowed".
- Guards used in routers: `guardClient`, `guardReturn`, `guardBodyScope({required})`, `guardSupply`, `guardImportBatchParam`, `guardImportDraftParam`, `guardReturnParam`, and `createGstAccessGuard(modelAccessor, opts)` for every section mount (resolves the record/`returnId`/`gstClientId` from path, query or body).
- `gstClientWhere(user)` is composed into list queries (e.g. `generate-returns` without a `clientId` only touches the caller's clients).

## 3. GST clients
- Office side (`gst-client.controller.js`): a master client has **at most one** GST registration (DB unique on `GSTClient.clientId`); a second GSTIN returns a clear message. Required GSTIN fields are checked by `REQUIRED_GSTIN_FIELDS` (gstin, legalName, pan, stateCode, registrationType, businessType, principalAddress, contactEmail, contactMobile, registrationDate — see file). `createGstClientFromMaster` builds the registration from the GST fields on the master client (`gstNo`, `gstTradeName`, `gstStateCode`, …). `getGstClientDetail` auto-provisions the GSTClient when the master client has complete GST fields and returns `gstLinkStatus` = `existing | provisioned | incomplete | conflict | error`; secrets such as portal password hash are stripped.
- Standalone (`gstUserClient.controller.js`): same form validation as the Office client form (`validateClientPayload`), `generateClientCode` per owner (first 3 letters + running number).
- `annualTurnover` (Decimal) on `GSTClient` drives the HSN 6-digit rule (> ₹5 Cr).

## 4. Returns lifecycle
1. **Generate** (`POST /generate-returns {financialYear, periodType, period, returnType, clientId?}`) → `GSTReturn` rows, `status DRAFT`, `skipDuplicates` on unique `(gstClientId, financialYear, period, returnType)`. Response includes `inserted` and `skipped` counts. Period strings: monthly `YYYY-MM` (e.g. `2026-07`), quarterly `YYYY-Qn` (Q1 = Apr–Jun, … Q4 ends March of next year); `periodToFp` converts them to the GSTN filing period `MMYYYY` (quarter → its end month). Financial years run April → March.
2. **Edit data** in section tables / outward supplies; `PATCH /returns/:id` may only set `status` to `DRAFT` or `READY_FOR_REVIEW` and `dueDate`; locked returns reject edits (403 "Return is locked. Cannot edit filed return.").
3. **File** (`POST /returns/:id/file`): 404 if missing; 400 "Return already filed" if `isLocked`; for **GSTR1 only**: `runReturnLevelChecks` then `getFilingBlockers` — any unresolved BLOCK issue → 400 with `blockingIssues`; any unacknowledged WARN → 400 with `unacknowledgedWarnings`. Then status `FILED`, `filingDate=now`, `arn = "ARN" + Date.now() + 4 random chars` (**a locally generated placeholder – there is no real GSTN submission**), `isLocked=true`, `lockedAt`, `lockedBy`. Finally `onGstReturnFiled` syncs the linked office task (see BUSINESS_LOGIC §5).
4. **Unlock** (`POST /returns/:id/unlock`): only Super Admin, office ADMIN, or a standalone GstUser → `isLocked=false`, `status=DRAFT`.
5. Filing never talks to the GST portal; the JSON export is the hand-off to the official GST Offline Tool.

## 5. GSTR-1
### 5.1 Sections (29 tables)
`B2BSEZDE, B2BA, B2CL, B2CLA, B2CS, B2CSA, CDNR, CDNRA, CDNUR, CDNURA, EXP, EXPA, AT, ATA, ATADJ, ATADJA, EXEMP, HSN, DOCS, ECO, ECOA, ECOB2B, ECOURP2B, ECOB2C, ECOURP2C, ECOAB2B, ECOAB2C, ECOAURP2B (model `GSTR1ECOAURP2BInvoice`), ECOAURP2C`. Each has CRUD + `/summary` routes and a Zod `create*Schema` in its `*.validator.js`. Manual create/update run schema validation and persist schema problems as `GSTR1ValidationIssue` rows rather than blocking, then add record-level checks.
Frontend field lists per section: `gst_Frontend/modules/gst/GSTR1/GSTR1ModuleAddEdit/gstr1ModuleConfig.js` (`endpoints` + `fields`).

### 5.2 Validation engine (`GSTR-1/shared/validationIssues.service.js`)
Issues have `severity` **BLOCK** (must fix before filing) or **WARN** (must be acknowledged before filing). Codes found in code:

| Code | Severity | Meaning |
|---|---|---|
| `GSTIN_CHECKSUM` | BLOCK | invalid GSTIN (state code / PAN pattern / check digit) |
| `PLACE_OF_SUPPLY_GSTIN_MISMATCH` | WARN (default when no severity is given) | POS state differs from recipient GSTIN state |
| `DOC_NUMBER_FORMAT` | BLOCK | doc number > max length or characters other than letters/digits/`/`/`-` (Rule 46) |
| `MONEY_DECIMAL_PLACES` | WARN | more than 2 decimals |
| `TAX_FORMULA_MISMATCH` / `_GROUP` | WARN/…| invoice total ≠ taxable + tax + cess beyond ₹1 tolerance |
| `CGST_SGST_MISMATCH` | WARN | HSN CGST ≠ SGST for intra-state |
| `INVOICE_GROUP_FIELD_MISMATCH` | BLOCK | rows of one invoice disagree on common fields |
| `HSN_DIGIT_FORMAT` | BLOCK | HSN must be numeric and 4/6/8 digits; ≥6 digits when client's annual turnover > ₹5 Cr |
| `DOC_TIME_BAR` | BLOCK | document date > 3 years past return due date |
| `DOC_BEFORE_GST` | BLOCK | date before 1 July 2017 |
| `DOC_BEFORE_REGISTRATION` | WARN | date before client's registration date |
| `DOC_AFTER_PERIOD_END` | BLOCK | date in future or after return period end |
| `CREDIT_NOTE_DEADLINE` | WARN | past Section 34 deadline (30 Nov after FY) – approximate |
| `DUPLICATE_KEY` | BLOCK | number repeats within return/section (per `SECTION_UNIQUE_FIELDS`) |
| `DUPLICATE_KEY_CROSS_TABLE` | BLOCK | CDN numbers shared across CDNR/CDNUR series; B2B/SEZ/DE/export invoice numbers share one series (same GSTIN + FY) |
| `RECIPIENT_IS_OWN_GSTIN` | BLOCK | recipient GSTIN equals supplier's |
| `B2CL_NOT_INTERSTATE` | BLOCK | B2CL place of supply equals supplier state |
| `ADVANCE_OVER_ADJUSTED` | WARN | adjusted advances exceed received (running balance) |
| `DOCS_RANGE_OVERLAP` | WARN | overlapping serial ranges of same nature |
| `AMENDMENT_ORIGINAL_NOT_FOUND` | WARN | original record not in system |
| `AMENDMENT_PERIOD_INVALID` | BLOCK | original date/FY-month later than current period |
| `AMENDMENT_RECIPIENT_CHANGED` | BLOCK | recipient changed by amendment |
| `RETURN_TIME_BAR` | BLOCK | return > 3 years past due date |
| `PREV_GSTR1_NOT_FILED` | BLOCK | previous period's GSTR-1 not filed |
| `PREV_GSTR3B_NOT_FILED` / `SECOND_PRIOR_GSTR3B_NOT_FILED` | BLOCK | required earlier GSTR-3B not filed (second-prior for monthly filers) |
| `IFF_SCOPE_VIOLATION` / `IFF_VALUE_LIMIT_EXCEEDED` | BLOCK | IFF may only hold B2B/SEZ/DE + B2B notes; B2B total limit ₹50,00,000 per month |
| `GSTIN_INACTIVE` | WARN | client GSTIN cancelled/inactive for the period |
| `DOCS_COUNT_LOW` | WARN | Documents Issued (Table 13) undercounts reported documents |

Endpoints: list/ack/ack-all/resolve-duplicate/validate/revalidate-record under `/api/gstr1/:returnId/...` (API doc §15.6). The frontend shows them in `GSTWarningLogPanel`, `GSTDuplicateResolutionModal`, and the client workspace "Warning Log" tab (`/gst-return/:clientId/warning-log`).

### 5.3 Excel bulk import (stage → review → commit)
- Template: `frontend/public/templates/GSTR1_Excel_Workbook_Template_V2.0.xlsx`. Parser: `GSTR-1/import/gstr1Import.parse.util.js` (SheetJS, header-alias maps, date handling, **max 20,000 rows per sheet**), mapping config `gstr1Import.config.js#moduleMapping` (sheet key → section label, service create function, Zod schema).
- `POST /api/gstr1/stage` parses the workbook, validates each row with the section's Zod schema + record/return checks, and writes **only to `GSTR1ImportDraft`** (status `READY` or `BLOCKED`, duplicate-key detection against both other drafts and committed rows).
- User reviews blocked rows (`/batches/:id/blocked`), edits (`PATCH …/drafts/:draftId`) or resolves duplicates, then `POST /batches/:id/commit` writes drafts into the real section tables (blocked while BLOCK issues remain; rejects if the return is locked/filed with 409 "This return is locked or filed.").
- Progress: Socket.IO `import-progress` / `import-complete` to the room `importId` (client emits `join-import-room`), and polling endpoint `GET /api/gstr1/import-progress/:importId` (in-memory, 10-minute TTL).
- Rows are inserted in concurrent chunks (`gst/utils/importRunner.js`, `GST_IMPORT_CONCURRENCY`, default 4) to stay inside Prisma's pool and the request timeout.
- The older direct importer path is described in code comments as "superseded" by the draft pipeline.

### 5.4 GSTR-1 JSON export (`GSTR-1/export`)
`GET /returns/:id/gstr1-json` (preview: `{ meta, unmapped, gstr1 }`) and `/gstr1-json/download` (file `GSTR1_<gstin>_<period>.json`). Only GSTR1-type returns (else 400). Built from: `b2b` (from B2BSEZDE), `b2cl`, `b2cs`, `cdnr`, `cdnur`, `exp`, `at`, `atadj`, `hsn`, `doc_issue`, `nil` (from EXEMP, emitted as a single `INTRB2B` bucket). **Amendment tables (B2BA, B2CLA, …, EXPA, ATA, ATADJA) and all ECO tables are not exported.** Rows that cannot be mapped (e.g. `INTRA_STATE_SUPPLIES_ATTRACTING_IGST`) are listed in `unmapped`. The file header comment says the mapping is best-effort and must be validated in the GST Offline Tool; `gt`/`cur_gt` are emitted as 0.

## 6. GSTR-3B (`gst-gstr3b.controller.js`)
- `GET /returns/:returnId/gstr3b`: loads the GSTR-3B return, finds the **GSTR-1 return of the same client, period and FY**, aggregates its `OutwardSupply` rows (excluding `ADVANCE`) per tax rate, adds **un-adjusted ADVANCE** entries and subtracts **adjusted** advances.
- `PUT …/gstr3b`: totalITC = inputs + input services + capital goods − reversed; per head `net = max(0, (outward tax + advance − adjusted advance) − ITC utilised)`; cess payable stored as 0; cash ledger values are taken from the request; `interStateValue/interStateIgst` stored as 0.
- Unlike GSTR-1, no BLOCK/WARN engine is applied to GSTR-3B filing (only `runReturnLevelChecks` for `GSTR1` in `fileReturn`).

## 7. GSTR-9 (`gst-gstr9.controller.js`)
`GET …/gstr9` aggregates, for the client and FY: all GSTR-1 returns in `FILED` or `READY_FOR_REVIEW` (total taxable sales and list of invoices from `OutwardSupply`) and GSTR-3B returns in the same statuses (sum of `itcAvailable` and cash CGST+SGST+IGST as "tax paid"); returns the stored GSTR-9 record if any. `PUT` saves `totalSales, totalITC, totalTaxPaid, amendments` (JSON).

## 8. GSTR-7 (TDS under GST)
Tables `GSTR7Deductee`, `GSTR7Amendment`, `GSTR7Summary`, `GSTR7CashLedgerEntry` with CRUD routers (`/returns/gstr7-*`), Excel import (`POST /api/gstr7/import`, config `gstr7-import/gstr7TableConfig.js`) and UI `GSTR7EditForm` (+ `SummaryForm`, `DeducteeTable`, `GSTR7DeducteeModal`). Deductee uniqueness: `(returnId, deducteeGstin, billNo)`; cash ledger uniqueness `(returnId, cin, head)`.

## 9. Accounting-software integration (`gst/accounting/`)
- Purpose: pull a client's **GSTR-1 data for one month** from an external "accounting software" partner API and write it into the GSTR-1 tables.
- Endpoints (`/api/gst/accounting/*`): list companies (partner API `GET …/partner/companies` with header `x-api-key: $X_API_KEY`, merged with local `AccountingAccessRequest` rows), `request-access` (creates a request; period `PERMANENT` = one-time connection, or `YYYY-MM` for a specific month), `link-client` (creates an Office master client from an accounting company so the user can open its GST workspace; idempotent; maps GST `BusinessType` → `EntityType`).
- Lifecycle: `PENDING` → `APPROVED` / `REJECTED`. `accountingRequestScheduler` (every 5 min) refreshes pending requests via `GET …/partner/requests/:requestId` and retries imports of approved-but-not-imported period requests. When a period request is approved, `importForApprovedRequest` fetches `GET …/partner/requests/:id/data?from&to`, ensures the GSTR-1 return exists (FY = April→March), and maps sections **B2B, B2CL, B2CS, CDNR, HSN, SEZ/DE** (`accounting/gstr1Import/mappers/*`) through the same Zod schemas; invalid rows are counted as skipped; summary stored in `importSummary`/`importedAt`.
- The partner API base URLs are hard-coded constants (ngrok tunnel) in two files, not environment variables; if they change the code must be edited. Partner failures return 502 `Failed to fetch companies from accounting software`.

## 10. Frontend GST structure (summary)
Routes (`GSTRoutes.jsx`): `gstr1/:returnId`, `gstr1/:returnId/view-all`, `gstr1/:returnId/tab/:tabKey`, `gstr7/:returnId` (each wrapped in `ReturnDataGate`) and `*` → `GstLayout` (index landing; `:clientId`, `:clientId/registrations` redirect to filing; `:clientId/returns-filing`, `:clientId/filing-history`, `:clientId/warning-log` → `GSTClientWorkspace`). Redux slices: `gstClients`, `gstReturns`, `gstr1`, `gstr3b`, `gstr7`, `gstr9`. GSTR-3B and GSTR-9 forms: `modules/gst/GSTR3B/GSTR3BEditForm.jsx`, `modules/gst/GSTR9/GSTR9EditForm.jsx`. See [FRONTEND_DOCUMENTATION.md](FRONTEND_DOCUMENTATION.md).

## 11. Known limitations (verified)
- ARN is generated locally; no GSTN API filing/EVC/DSC signing (the `FilingMethod`/`digitalSignatureHash` fields exist in `GSTR3B` but no signing flow was found).
- `GSTR2B` and `IFF` exist as `ReturnType` values; IFF has validation hooks (`IFF_*`), but no dedicated GSTR-2B/IFF screens or routes were found (**[UNVERIFIED]** frontend coverage).
- Due-date engine covers GSTR1/3B/7/9 only.
- Legacy models `GSTTask`, `GSTUserProfile`, `GSTUserClientAssignment`, `CommunicationAddress` exist in the schema but are unused in `backend/src`.
