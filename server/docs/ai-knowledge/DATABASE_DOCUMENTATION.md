# Database Documentation

> Source: `backend/prisma/schema.prisma` (2,896 lines; **92 models, 80 enums**), 47 migrations in `backend/prisma/migrations/`. Database: **PostgreSQL** (`provider = "postgresql"`, `url = env("DATABASE_URL")`). Client generator `prisma-client-js` with `previewFeatures = ["relationJoins"]`, `binaryTargets = ["native","debian-openssl-3.0.x"]`.
> Related: [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md), [AUTHENTICATION_AND_PERMISSIONS.md](AUTHENTICATION_AND_PERMISSIONS.md), [GST_MODULE_DOCUMENTATION.md](GST_MODULE_DOCUMENTATION.md).
> No field lists here are invented; where a model has dozens of columns (Client, GSTR-1 sections) only meaningful/key fields are listed — open the schema for the complete list.

## 1. Conventions
- IDs: `String @id @default(uuid())` for most models; **`Int @id @default(autoincrement())`** for `Client`, `ServiceType`, `AccountingAccessRequest`, `RegistrarOfCompany`, `SigningPerson`; **`cuid()`** for GSTR-1 section tables and GSTR-7 tables.
- Money: `Decimal(12,2)` (office billing) / `Decimal(15,2)` (GST); tax rates `Decimal(5,2)`.
- Multi-tenancy columns on most office tables: `adminId` (org owner = Admin `User.id`) and `companyId` (`OfficeFirm.id`), both nullable plain strings (not Prisma relations) with indexes.
- Soft delete: `Document.isDeleted/deletedAt/deletedById`; users/clients/etc. use `status` enums (`ACTIVE|INACTIVE`).
- Timestamps: `createdAt @default(now())`, `updatedAt @updatedAt`.
- Two parallel "client" concepts: **`Client`** (Office Management master client, Int id) and **`GSTClient`** (GST registration, uuid id; `GSTClient.clientId` optional unique → `Client.id`; `ownerGstUserId` for standalone-owned clients).
- Every GST return table carries `gstClientId` (→ `GSTClient`) and optional `officeClientId` (→ `Client`, relation name `"OfficeClientLink"`).

## 2. Identity, RBAC and software catalog

| Model | Key fields / constraints | Relations |
|---|---|---|
| `User` | `id uuid`, `name`, `email @unique`, `phone @unique?`, `password` (bcrypt hash), `roleId?`, `status UserStatus(ACTIVE)`, `createdBy?`, `teamLeaderId?`, `lastLoginAt?`, `clientIds Int[]` (explicit client assignment), `adminId?` (org owner), `companyId?`, `countryCode "+91"`, Google Drive fields (`googleDriveAccessToken/RefreshToken/TokenExpiry/Connected/Email/FolderId`), Google Calendar fields (`googleCalendar*`), `officeOnboardingStep OnboardingStep(PROFESSION)`, `officeProfessions OfficeFirmProfession[]`, `officeStructure OfficeStructure?` | self-relations `adminOwner/ownedUsers` (AdminOwnedUsers), `teamLeader/teamMembers`; `roleRef Role?`; `softwareRoles UserSoftwareRole[]`; tasks (assigner/assignee), notifications, refresh/reset tokens, attendance, documents, officeFirms (as owner), etc. Indexes: roleId, teamLeaderId, status, adminId, companyId |
| `Role` | `name`, `isActive`, `softwareId?`, flags `requiresCompanyAssignment`, `requiresManagerAssignment`, `supportsClientAssignment`, `isSystem`, `adminId?` (owner of custom role); `@@unique([softwareId, adminId, name])` | `software`, `rolePermissions`, `users`, `userAssignments` |
| `Permission` | `key @unique`, `description?`, `isActive` | `rolePermissions` |
| `RolePermission` | composite PK `[roleId, permissionId]` | cascade deletes |
| `Software` | `code @unique` (SYSTEM, OFFICE_MANAGEMENT, GST, TDS, ROC, DSC), `name`, `description?`, `isActive`, `billingPeriod SoftwareBillingPeriod(YEARLY)`, `currency "INR"`, `iconKey?`, `isPurchasable` (= "listed/selectable"), `launchUrl?`, `logoUrl?`, `price?`, `professions OfficeFirmProfession[]` | `roles`, `subscriptions`, `requiredByTasks`, `submissions`, `userAssignments` |
| `UserSoftwareRole` | `@@unique([userId, softwareId])`, `roleId`, `isActive`, `grantedBy?`, `grantedAt`, `revokedAt?` | user, software, role (cascade) |
| `SoftwareAccess` | per-user module grant: `@@unique([userId, software SoftwareType])`, `isActive`, `grantedBy`, `revokedAt` | user |
| `SoftwareSubscription` | `companyId?` (null = Admin's office-level), `softwareId`, `purchasedById?`, `purchasedByGstUserId?`, `status SoftwareSubscriptionStatus(PENDING)`, `amount`, `currency`, `billingPeriod`, `provider "RAZORPAY"` default (actual selections use `"SELECTION"` with amount 0 / `ONE_TIME`), `providerOrderId @unique?`, `providerPaymentId @unique?`, `activatedAt`, `expiresAt`, `expiryNotifiedAt`, `revokedAt/revokedById/revokeReason` | company (OfficeFirm), software, purchasedBy User, purchasedByGstUser |
| `RefreshToken` | `token @unique`, `userId`, `revoked`, `expiresAt` | cascade with user |
| `PasswordResetToken` | `token @unique` (stores SHA-256 hash), `userId`, `expiresAt`, `usedAt?` | |
| `AuditLog` | `actorId?`, `action`, `entityType`, `entityId?`, `oldValue Json?`, `newValue Json?`, `ipAddress?`, `userAgent?` | written via `utils/Audit.utils.js#audit` |
| `GstUser` | standalone GST identity: `email @unique`, `password`, `status`, `lastLoginAt` | `gstClients` (GstUserOwnedClients), `refreshTokens` (`GstRefreshToken`), `passwordResetTokens` (`GstPasswordResetToken`), `subscriptions` |
| `GSTUserProfile` | `userId @unique`, `gstRole GSTRole(STAFF|REVIEWER)`, permissions booleans `canView/canEdit/canCreate/canReview/canApprove/canFile`, `isActive` | `GSTTask` assignee/reviewer, `GSTUserClientAssignment`. **Not referenced anywhere in `backend/src`** (verified by search) — legacy/unused |

## 3. Organization / company

| Model | Notes |
|---|---|
| `OfficeFirm` | `ownerId → User` (cascade), `firmName`, legacy `profession?`, `professions[]`, `structureType? (PROPRIETORSHIP|PARTNERSHIP|LLP)`, `firmPAN?`, `firmGSTIN?`, `registrationNumber?`, `establishedDate?`, `onboardingStep` |
| `OfficeFirmPartner` | `firmId`, `name`, `membershipNumber?`, `copNumber?`, `copValidTill?`, `designation (PROPRIETOR|PARTNER|PAID_CA)`, phone, email |
| `OfficeFirmAddress` | `type (HEAD_OFFICE|BRANCH)`, address lines, city, state, pincode, country "India" |
| `CompanyClient` | sharing join: `@@unique([companyId, clientId])`, `assignedAt`, `assignedById?` |
| `OfficeHoliday` | `name`, `date`, `isOptional`, `branchScope String[]`, `adminId?`, `companyId?`, `createdById?` |
| `Attendance` | `@@unique([userId, date])`, `checkIn?`, `checkOut?`, `status AttendanceStatus(PRESENT|ABSENT)` |

## 4. Client master data

`Client` (Int id) is one very wide table covering all 12 entity types (`entityType EntityType`): identity (`code @unique?`, `group`, `prefix`, `name`, first/middle/last name, father/spouse, qualification, nationality, occupation, UIN, passport, gender, voters id, `dob/dod`), tax ids (`pan`, `tan`, `din`, `gstNo`, `gstStartDate/EndDate`, VAT/CST/service tax numbers), company data (`cin`, `gln`, `llpId`, `isLLP`, `registrarOfCompanyId → RegistrarOfCompany`, `companyCategory`, `companySub`, `companyType`, `havingShareCapital`, `isPrivateOnePersonCompany`, `sec8LicenceNo`), business (`businessName`, `contactPerson`, `natureOfBusiness`, `majorActivity`, `isMSME`, `msmeRegistrationNo/Date`, `enterpriseType`, `stockValuationMethod`, `dateOfCommencementOfBusiness`, `isFIIFPI`, `sebiRegnNo`), `status ClientStatus(ACTIVE)`, module assignment flags (`assignToGST/IT/Payroll/ROC/TDS` + `gstAssignedAt/By`, `tdsAssignedAt/By`), ownership (`adminId`, `companyId`), contact (`email`, `phone`), **Client Portal** (`portalAccess`, `portalPasswordHash`, `portalPasswordSetAt`, `portalLastLoginAt`), GST fields (`gstBusinessType`, `gstConstitution`, `gstPrincipalAddress`, `gstRegistrationType`, `gstStateCode`, `gstTradeName`, `gstQrmpStatus`). Indexes on entityType, pan, status, createdAt, assignToGST, adminId, portalAccess, companyId.
Related: `SigningPerson` (1:1 via unique `clientId`, cascade), `RegistrarOfCompany` (`name @unique`), `ClientNotification` (portal notifications), `CompanyClient`.

## 5. Tasks and workflow

| Model | Key points |
|---|---|
| `Task` | `title`, `assignedToId?`, `assignedById`, `priority TaskPriority(MEDIUM)`, `status TaskStatus(DRAFT)`, `dueDate?`, `completedAt?`, `requiresApproval (default true)`, `remarks?`, `serviceTypeId?`, `adminId?`, `companyId?`, `description?`, `requiredSoftwareId?`, `complianceCategory TaskComplianceCategory(GENERAL)`. Relations: clients (`TaskClient`), checklist, reminders, statusHistory, activities, submissions, files, documents, documentRequests, quotations, invoices, notifications, `gstReturn` (`@relation("TaskGstReturn")` via `GSTReturn.officeTaskId`) |
| `TaskClient` | composite PK `[taskId, clientId]` |
| `TaskChecklist` | `title`, `isCompleted`, `completedById?`, `completedAt?` |
| `TaskReminder` | `taskId`, `userId`, `remindAt`, `reminderType?` (THREE_DAYS_BEFORE, ONE_DAY_BEFORE, ON_DUE_DATE, OVERDUE, CUSTOM — strings), `message?`, `status ReminderStatus(PENDING|SENT|FAILED|CANCELLED)`, `sentAt?`, `error?`, `isActive`, `createdById?` |
| `TaskStatusHistory` | `fromStatus?`, `toStatus`, `changedById`, `remarks?` |
| `TaskActivity` | timeline: `actorId?`, `action` (string), `message?`, `details Json?` |
| `TaskSubmission` | evidence rounds: `@@unique([taskId, round])`, `mode TaskSubmissionMode(ORG_SOFTWARE|EXTERNAL_SOFTWARE)`, `softwareId?`, `externalSoftwareName?`, `filingReference?`, `filingDate?`, `completionNotes?`, `decision TaskSubmissionDecision(PENDING|APPROVED|REJECTED|CORRECTIONS_REQUESTED)`, `reviewedById?`, `reviewedAt?`, `reviewComment?`, `referenceLink?` |
| `TaskFile` | `purpose TaskFilePurpose(SUPPORTING|SCREENSHOT|ACKNOWLEDGEMENT|EVIDENCE)`, `storagePath`, `originalName`, `mimeType`, `fileSize`, `uploadedById` |
| `Notification` | `userId`, `adminId?`, `companyId?`, `type NotificationType`, `title`, `message`, `taskId?`, `isRead`, `readAt?`; indexes `[userId,isRead]`, `[userId,companyId,isRead]` |

Enums: `TaskStatus` = DRAFT, ASSIGNED, IN_PROGRESS, SUBMITTED, APPROVED, REJECTED, COMPLETED, OVERDUE, CANCELLED. `TaskPriority` = LOW, MEDIUM, HIGH, URGENT. `NotificationType` = TASK_ASSIGNED, TASK_SUBMITTED, TASK_APPROVED, TASK_REJECTED, DUE_SOON, OVERDUE, DOCUMENT_SUBMITTED, TASK_CORRECTIONS_REQUESTED, TASK_COMPLETED, SOFTWARE_ACCESS_EXPIRED, SOFTWARE_ACCESS_REVOKED, SOFTWARE_PURCHASED. `TaskComplianceCategory` = GST_COMPLIANCE, HR_TASK, PAYROLL, EMPLOYEE_DOCUMENT, TAX_DECLARATION, BRANCH_COMPLIANCE, LICENSE_RENEWAL, GENERAL, MEETING.

## 6. Billing, documents, communication

| Model | Key points |
|---|---|
| `ServiceType` | Int id, `name @unique`, `serviceCharges`, `taxRate (default 0)`, `discountAllowed`, `couponCode?`, `status ServiceTypeStatus(ACTIVE|INACTIVE)` |
| `Quotation` | `quotationNo @unique` (`QTN-00001`), `serviceTypeId`, `serviceCharges`, `taxRate`, `discountAmount`, `finalAmount`, `status QuotationStatus(DRAFT|SENT|APPROVED|REJECTED|EXPIRED)`, `createdBy`, `quotationDate`, `taskId?`, `adminId`, `companyId`; join `QuotationClient [quotationId, clientId]`; 1:1 optional `invoices` |
| `Invoice` | `invoiceNo @unique` (`INV-00001`), `clientId`, `taskId?`, `quotationId @unique?`, `total`, `status InvoiceStatus(DRAFT|SENT|PAID|PARTIALLY_PAID|OVERDUE|CANCELLED)`, `pdfUrl?`, `issuedAt`, `discountAmount`, `serviceCharges`, `serviceTypeId?`, `taxRate`, `adminId`, `companyId`, `createdBy?` |
| `Payment` | `invoiceId`, `amountPaid`, `paymentDate`, `mode PaymentMode(CASH|UPI|BANK_TRANSFER|CHEQUE|CARD)`, `referenceNo?`, `status PaymentStatus(SUCCESS default; INITIATED|FAILED|PENDING)`, `createdById?` |
| `Document` | `name`, `originalName`, `filePath?` (local, client uploads), `fileSize`, `mimeType`, `description?`, `clientId?`, `taskId?`, `uploadedById?`, soft-delete fields, `documentTypeId?`, `driveFileId?`, `driveUrl?`, `frequencyType FrequencyType[]`, `adminId`, `companyId`, `source DocumentSource(STAFF|CLIENT)`, `uploadedByClientId?` |
| `DocumentType` | `id` (manual string), `name @unique`, `frequencyTypes[]`, `status` |
| `DocumentRequest` | `clientId`, `serviceTypeId?`, `deadline?`, `status DocumentRequestStatus(PENDING|SUBMITTED|APPROVED|REJECTED|CANCELLED|OVERDUE)`, `requestedById`, `adminNotes?`, `documentName`, `instructions?`, `submittedAt?`, `submittedDocumentId @unique?`, `taskId?` |
| `Appointment` | `title`, `scheduledAt`, `durationMinutes 30`, `googleMeetLink?`, `googleEventId?`, `status AppointmentStatus(SCHEDULED|COMPLETED|CANCELLED|NO_SHOW|OVERDUE)`, `notes?`, `complianceCategory (MEETING)`, `organizedById`, `clientId?`, `attendeeIds String[]` |
| `EnquiryLead` | `title`, `clientName`, `clientEmail?`, `clientPhone?`, `source LeadSource(DIRECT default)`, `status LeadStatus(NEW|CONTACTED|QUALIFIED|PROPOSAL|NEGOTIATION|WON|LOST)`, `priority`, `expectedValue Float?`, `serviceInterest?`, `followUpDate?`, `assignedToId?`, `createdById`, `convertedAt?` |
| `ClientNotification` | `clientId`, `title`, `message`, `type ClientNotificationType(TASK|DOCUMENT|DOCUMENT_REQUEST|INVOICE|DEADLINE|APPOINTMENT|QUOTATION|GENERAL)`, `isRead`, `linkPath?`, `relatedId?`, `relatedType?` |

## 7. GST core

| Model | Key points |
|---|---|
| `GSTClient` | `gstin @unique`, `clientId Int? @unique`, `legalName`, `tradeName?`, `pan`, `stateCode`, `registrationType`, `businessType`, `principalAddress`, `contactEmail`, `contactMobile`, `constitution?`, `registrationDate`, `cancellationDate?`, `eInvoiceApplicable`, `qrmpStatus`, `isActive`, `ownerGstUserId?`, `clientCode?`, `profile Json?` (whole standalone form payload), `annualTurnover Decimal(15,2)?`; `@@unique([clientId, gstin])` |
| `GSTReturn` | `gstClientId`, `financialYear`, `period`, `periodType (MONTHLY|QUARTERLY|YEARLY)`, `returnType (GSTR1|GSTR3B|GSTR2B|IFF|GSTR7|GSTR9)`, `status ReturnStatus(DRAFT default)`, `filingDate?`, `arn?`, `isLocked`, `lockedAt/By`, `dueDate?`, `officeTaskId @unique?` (link to office `Task`), `officeClientId?`, `taskId @unique?` (legacy `GSTTask`); **`@@unique([gstClientId, financialYear, period, returnType])`** |
| `GSTR3B` | 1:1 via `returnId @unique`; outward rates JSON, ITC fields (`itcOnInputs`, `itcOnInputServices`, `itcOnCapitalGoods`, `itcReversed`, `itcAvailable`, IMS accepted/rejected/pending), `netCgst/Sgst/Igst/CessPayable`, interest/late-fee fields, cash & ITC utilisation per head, `filedVia FilingMethod(EVC|DSC)?`, `digitalSignatureHash?` |
| `GSTR9` | `returnId @unique`, `totalSales`, `totalITC`, `totalTaxPaid`, `amendments Json?` |
| `OutwardSupply` | `returnId`, `supplyType (B2B|B2CL|B2CS|CDNR|CDNUR|EXPORT|ADVANCE|NIL_EXEMPT)`, invoice no/date/value, buyer GSTIN/name/state, `taxableValue`, `taxRate`, `cgst/sgst/igst/cess`, HSN, quantity, UoM, (advance adjustment fields further down) |
| `ITCRecord`, `TaxPayment` | ITC register rows (`imsStatus`, `isReversed`…) and challans (`challanNo @unique`, per-head amounts, `paymentType`, `status`) |
| `GSTTask`, `GSTUserProfile`, `GSTUserClientAssignment` | legacy/standalone maker-checker model (statuses DRAFT…COMPLETED). **Not referenced anywhere in `backend/src`** (verified by search); office tasks use `Task` |
| `AccountingAccessRequest` | external accounting-software access: `gstin`, `companyName?`, `requestId?`, `status (PENDING|APPROVED|REJECTED)`, `period "PERMANENT"` default, `importedAt?`, `importSummary Json?`; `@@unique([gstin, period])` |
| `CommunicationAddress` | GST address records (`gstClientId`, geo fields, address-proof type); **not referenced anywhere in `backend/src`** |
| `GstDueDateRule` | `complianceType`, `taxpayerCategory (ANY|REGULAR|QRMP|COMPOSITION|CASUAL_TAXABLE|NON_RESIDENT|TDS_DEDUCTOR|TCS_COLLECTOR|UIN_HOLDER)`, `frequency (MONTHLY|QUARTERLY|ANNUAL|EVENT_BASED)`, `stateCodes[]`, `monthOffset?`, `dayOfMonth?`, `dueMonth?`, `dueDay?`, `dueYearOffset?`, `eventOffsetDays?`, `effectiveFrom/To`, `isActive`, `adminId?` |
| `GstDueDateOverride` | extension notifications: `complianceType`, `financialYear`, `period`, `extendedDueDate`, `notificationRef?`, `reason?`; unique `[complianceType, financialYear, period, taxpayerCategory, adminId]` |
| `GSTR1ValidationIssue` | `returnId`, `section`, `recordId?`, `rowRef?`, `fieldPath?`, `checkCode`, `message`, `originalValue?`, `severity (WARN|BLOCK)`, `source "IMPORT"`, `acknowledged`, `acknowledgedAt/By`; unique `[returnId, section, recordId, fieldPath, checkCode]` |
| `GSTR1ImportDraft` | staging rows: `importBatchId`, `section`, `rowRef?`, `keyValue?`, `data Json`, `issues Json`, `status (BLOCKED|READY)` |

## 8. GSTR-1 section tables (29 models)

Shared columns: `id cuid`, `returnId → GSTReturn`, `gstClientId → GSTClient`, `officeClientId? → Client`, `taxableValue Decimal?`, `cessAmount default 0`, `createdAt/updatedAt`. Uniqueness per section prevents duplicates inside a return:

| Table (GSTR-1 table #) | Unique key |
|---|---|
| `B2BSEZDE` (B2B, SEZ, deemed exports) | `[returnId, invoiceNumber, rate]` |
| `B2BA` (amended B2B) | `[returnId, revisedInvoiceNumber, rate]` |
| `B2CL` / `B2CLA` | `[returnId, invoiceNumber, rate]` / `[returnId, revisedInvoiceNumber, rate]` |
| `B2CS` / `B2CSA` | (no `@@unique` listed in schema) |
| `CDNR` / `CDNRA` | `[returnId, noteNumber, rate]` / `[returnId, revisedNoteNumber, rate]` |
| `CDNUR` / `CDNURA` | same pattern |
| `EXP` / `EXPA` | `[returnId, invoiceNumber, rate]` / `[returnId, revisedInvoiceNumber, rate]` |
| `AT`, `ATA`, `ATADJ`, `ATADJA` | advances received / adjusted (+ amendments) |
| `EXEMP` | nil-rated/exempt/non-GST supplies |
| `HSN` | `[returnId, hsnCode, rate]`; fields `uqc`, `totalQuantity`, `totalValue`, `integratedTaxAmount`, `centralTaxAmount`, `stateTaxAmount`, `cessAmount` |
| `DOCS` | documents issued (`natureOfDocument`, `srNoFrom/To`, `totalNumber`, `cancelled`) |
| `ECO`, `ECOA` | `[returnId, ecoGstin, natureOfSupply]` |
| `ECOB2B`, `ECOURP2B`, `ECOB2C`, `ECOURP2C`, `ECOAB2B`, `ECOAB2C`, `GSTR1ECOAURP2BInvoice`, `ECOAURP2C` | e-commerce operator sections (document-number based unique keys for B2B variants) |

Value enums used: `Rate` (RATE_0, 0_1, 0_25, 1, 1_5, 3, 5, 6, 7_5, 12, 18, 28, **40**), `PlaceOfSupply` (38 values like `DL_07`, `AP_NEW_37`), `InvoiceType`, `ReverseCharge`, `NoteType (C|D)`, `URType (B2CL|EXPWP|EXPWOP)`, `ExportType (WOPAY|WPAY)`, `B2CSType (OE|ECOM)`, `UQC` (45 codes), `DocumentNature` (12), `NatureOfSupply`, `ECODocumentType`, `Month`.

## 9. GSTR-7
| Model | Notes |
|---|---|
| `GSTR7Deductee` | `deducteeGstin`, `deducteeName`, `billNo`, `billDate`, `contractValue?`, `taxableValue`, cgst/sgst/igst amounts, `supplyType (INTRA|INTER)`, `invoiceValue?`; unique `[returnId, deducteeGstin, billNo]` |
| `GSTR7Amendment` | amendments referencing `originalDeducteeId`, `originalPeriod` |
| `GSTR7Summary` | `returnId @unique`, payable/paid per head, interest, late fee |
| `GSTR7CashLedgerEntry` | `cin`, `amount`, `head (CGST|SGST|IGST|INTEREST|LATE_FEE|PENALTY|OTHER)`, `paidOn`; unique `[returnId, cin, head]` |

## 10. Important enums (value lists)
`UserStatus` ACTIVE/INACTIVE · `ClientStatus` ACTIVE/INACTIVE · `OfficeFirmProfession` CA, CS, CMA, TAX_CONSULTANT, ADVOCATE, CLIENT · `OfficeStructure` SOLO/MULTIPLE · `OnboardingStep` PROFESSION, MARKETPLACE, COMPLETED · `SoftwareType` GST, TDS, ROC, OFFICE_MANAGEMENT, DSC · `SoftwareSubscriptionStatus` PENDING, ACTIVE, EXPIRED, CANCELLED, REVOKED, FAILED · `SoftwareBillingPeriod` MONTHLY, QUARTERLY, YEARLY, ONE_TIME · `EntityType` INDIVIDUAL, FIRM, AOP, AOP_TRUST, BODY_OF_INDIVIDUAL, ARTIFICIAL_JUDICIAL_PERSON, COOPERATIVE_SOCIETY, HUF, COMPANY_PUBLIC_INTERESTED, COMPANY_PUBLIC_NOT_INTERESTED, COMPANY_PRIVATE, LOCAL_AUTHORITY · `ReturnStatus` DRAFT, READY_FOR_REVIEW, UNDER_REVIEW, APPROVED, REJECTED, FILED, FILING_FAILED, LOCKED · `ReturnType` GSTR1, GSTR3B, GSTR2B, IFF, GSTR7, GSTR9 · `RegistrationType` REGULAR, COMPOSITION, CASUAL_TAXABLE, NON_RESIDENT · `BusinessType` PROPRIETORSHIP, PARTNERSHIP, PRIVATE_LIMITED, PUBLIC_LIMITED, LLP, TRUST, SOCIETY, HUF · `FilingMethod` EVC, DSC · `ValidationSeverity` WARN, BLOCK · `GSTR1DraftStatus` BLOCKED, READY.

## 11. Entity relationship overview (text)

```
User ──< UserSoftwareRole >── Software        User.adminId → User (org owner)   User.companyId ~ OfficeFirm.id
  │            └── Role ──< RolePermission >── Permission
  ├─< Task (assigner/assignee) ──< TaskClient >── Client
  │      ├─< TaskChecklist / TaskReminder / TaskStatusHistory / TaskActivity
  │      ├─< TaskSubmission ──< TaskFile
  │      ├─< Quotation ──< QuotationClient >── Client ;  Quotation ─1:1─ Invoice ──< Payment
  │      └─ GSTReturn.officeTaskId (1:1)
  └─ OfficeFirm (owner) ──< CompanyClient >── Client ; OfficeFirm ──< SoftwareSubscription >── Software
Client ──1:1── GSTClient ──< GSTReturn ──< (29 GSTR-1 tables, OutwardSupply, GSTR7*, TaxPayment, ITCRecord, GSTR3B, GSTR9, validation issues, import drafts)
GstUser ──< GSTClient (ownerGstUserId)           GstUser ──< GstRefreshToken / GstPasswordResetToken
```

## 12. Migrations timeline (folder names, chronological)
First commit `20260603202027_first_commit` → client status & service-type master (Jun 2026) → accounting access request + lifecycle + period + rate 40% (Aug) → GSTR-7 module (Aug 25) → office client isolation, notifications, country code, client portal access/credentials, document requests (Sep) → **software marketplace and task workflow** (`20260921000000`), company onboarding step, role hierarchy, task reference link → GST client model, GST standalone identity, client GST fields, client code/profile (Sep 23–24) → compliance calendar, attendance, appointments & leads, office structure (Sep 28–30) → notification company id, GSTR-1 import draft, GST client annual turnover (Oct 3–9) → appointment OVERDUE status, **DSC software type**, restrict software type to supported (Oct 19). `backend/prisma/scripts/*.js` are manual backfill/verification scripts (e.g. `backfill-admin-ownership.js`, `verify-isolation.js`).

> `backend/src/shared/prisma.js` documents that the database sits behind a Supabase pooler (session mode, ~15 total connections), which is why the Prisma pool is capped at 5 per process. Whether every migration folder has been applied to a given environment cannot be determined from the repository.
