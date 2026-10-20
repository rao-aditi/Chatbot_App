# AI Knowledge Index (master map)

> Purpose: help a retrieval system / chatbot find the right document and source file for a question about this project.
> How to use with RAG: chunk each file by `##`/`###` headings; keep the file name + heading as metadata; prefer the file listed under "Primary doc" and cite the "Source files". When documentation says **[UNVERIFIED]** or "not implemented", answer exactly that — do not invent behaviour.
> Repository root = `officeGST/`. Backend = `backend/`, frontend = `frontend/`. Docs live in `docs/ai-knowledge/`.

## 1. Document catalogue
| File | Contents | Read when asked about… |
|---|---|---|
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | purpose, actors, feature list, tech stack | "What is this project?", "Which technologies?" |
| [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) | folder tree, what each folder/file does | "Where is X located?" |
| [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) | components, 3 identity systems, multi-tenancy, request lifecycle, schedulers, sockets, storage | "How does it work overall?" |
| [FRONTEND_DOCUMENTATION.md](FRONTEND_DOCUMENTATION.md) | routes, pages, state, axios layer, GST UI, placeholders | any UI question |
| [BACKEND_DOCUMENTATION.md](BACKEND_DOCUMENTATION.md) | layering, middleware, shared services, module summaries, startup order, scripts | any server-code question |
| [API_DOCUMENTATION.md](API_DOCUMENTATION.md) | every endpoint with method, guard, body | "Which endpoint…?" |
| [DATABASE_DOCUMENTATION.md](DATABASE_DOCUMENTATION.md) | models, fields, relations, enums, migrations | "Which table/field…?" |
| [AUTHENTICATION_AND_PERMISSIONS.md](AUTHENTICATION_AND_PERMISSIONS.md) | login flows, tokens, roles, permission keys, scoping | "Who can do X?" |
| [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md) | rules and workflows (tasks, billing, documents, reminders, compliance) | "What happens when…?" |
| [GST_MODULE_DOCUMENTATION.md](GST_MODULE_DOCUMENTATION.md) | GST software, returns, GSTR-1/3B/7/9, import, validation, JSON export, accounting integration | any GST question |
| [MARKETPLACE_AND_SOFTWARE_ACCESS.md](MARKETPLACE_AND_SOFTWARE_ACCESS.md) | software selection, subscriptions, per-user access, launch | "How does software access work?" |
| [CLIENT_PORTAL_DOCUMENTATION.md](CLIENT_PORTAL_DOCUMENTATION.md) | client login and portal features | "What can clients see?" |
| [AI_AGENT_DOCUMENTATION.md](AI_AGENT_DOCUMENTATION.md) | chat widget, socket server, **absence of Gemini code** | "Where is the chatbot / Gemini?" |
| [INTEGRATIONS_AND_CONFIGURATION.md](INTEGRATIONS_AND_CONFIGURATION.md) | env var names, Google/SMTP/Vonage/accounting integrations, deployment | "How do I configure…?" |
| [ERROR_HANDLING_AND_TROUBLESHOOTING.md](ERROR_HANDLING_AND_TROUBLESHOOTING.md) | error messages, status codes, playbook | "Why do I get error…?" |
| [FEATURES_AND_IMPLEMENTATION_STATUS.md](FEATURES_AND_IMPLEMENTATION_STATUS.md) | done / partial / missing features | "Is X implemented?" |
| [PROJECT_GLOSSARY.md](PROJECT_GLOSSARY.md) | terms and abbreviations | "What does X mean?" |

## 2. Topic → source file map

### Server bootstrap & cross-cutting
| Topic | Source files |
|---|---|
| All route mounts, CORS, rate limits, sockets, scheduler start | `backend/server.js` |
| Prisma client / connection limit | `backend/src/shared/prisma.js`, `backend/prisma.config.js` |
| Auth middleware (staff) | `backend/src/OfficeManagment/middleware/authenticate.js`, `backend/src/middlewares/auth.middleware.js` |
| Permission guards | `backend/src/OfficeManagment/middleware/rbac.js` |
| Client portal auth middleware | `backend/src/OfficeManagment/middleware/authenticateClient.js` |
| Standalone GST auth | `backend/src/middlewares/auth.js`, `backend/src/middlewares/gstUserAuth.middleware.js`, `backend/src/gst/auth/*` |
| Error handler / response helpers | `backend/src/OfficeManagment/middleware/errorHandler.js`, `backend/src/OfficeManagment/utils/response.utils.js`, `backend/src/gst/utils/response.utils.js` |
| JWT secrets & expiry | `backend/src/OfficeManagment/utils/jwt.utils.js` |
| Org/company scoping | `backend/src/shared/services/userAccess.service.js`, `backend/src/shared/services/ownership.service.js` |
| Software catalog / roles constants | `backend/src/shared/constants/software.js`, `backend/src/shared/constants/officeRoles.js` |
| Permission catalog & default role grants | `backend/prisma/seed-permissions-data.js`, `backend/src/shared/services/officeBootstrap.service.js` |
| Audit logging | `backend/src/OfficeManagment/utils/Audit.utils.js` |
| Notifications / e-mail / WhatsApp | `backend/src/shared/services/notification.service.js`, `mailer.service.js`, `whatsapp.service.js`, `templates/` |
| Schedulers | `backend/src/OfficeManagment/DueDates_Remainders/TaskRemainder_Scheduler.js`, `backend/src/gst/accounting/accountingRequestScheduler.js` |

### Office Management features
| Topic | Source files (backend → frontend) |
|---|---|
| Registration/login/refresh/reset | `OfficeManagment/auth/auth.service.js`, `auth.controller.js`, `auth.routes.js` → `Login/*`, `store/slice/auth/authSlice.js`, `core/auth/tokenRefresh.js` |
| Companies, office structure, professions | `OfficeManagment/Companies/companies.service.js` → `components/Profession/*`, `pages/Public/*`, `components/Header/CompanySwitcher.jsx` |
| Roles & permissions | `OfficeManagment/permissions/permissions.service.js` → `pages/RolesPermissions/*`, `pages/Settings/PermissionMatrix.jsx` |
| Staff users | `modules/users/users.service.js`, `OfficeManagment/OfficeUsers/*` → `pages/UserManagement/*` |
| Clients (12 entity types) | `services/software/common/modules/*`, `OfficeManagment/Client/*`, `permissions/client.access.js` → `onboarding/*`, `pages/ClientManagement/*` |
| Client code generation | `OfficeManagment/Client/clientCode.util.js` |
| Tasks | `OfficeManagment/Tasks/tasks.service.js`, `task.permissions.js`, `task.assignment.js` → `pages/TaskManagement/*` |
| Software-task workflow | `OfficeManagment/TaskWorkflow/taskWorkflow.service.js`, `taskFiles.js` → `components/TaskManagement/Workflow/*` |
| Due dates / reminders | `OfficeManagment/DueDates_Remainders/Duedates.service.js` → `pages/DueDateReminder/*` |
| Compliance calendar | `OfficeManagment/ComplianceCalendar/*`, `gst/compliance-calendar/*` → `pages/Compliance/*` |
| Quotes / invoices / payments / service types | `OfficeManagment/{Quotations,Invoices,Payments,ServiceTypes}/*` → `pages/QuotationAndFees/*`, `pages/Billing/*`, `pages/ServiceTypes/*` |
| Documents & Drive | `OfficeManagment/Documents/Documents.service.js`, `GoogleDrive/googleDrive.service.js` → `pages/Documents/*`, `components/Documents/*` |
| Document requests | `OfficeManagment/DocumentRequests/*`, `ClientPortal/portal.service.js` |
| Appointments (Meet) / enquiries | `OfficeManagment/Communication/*` → `pages/Appointments/*` |
| Reports / HR / dashboards | `OfficeManagment/{Reports,HR,Dashboard}/*` → `pages/{Reports,HR,DashBoard}/*` |
| Notifications (staff) | `OfficeManagment/Notifications/*` → `pages/Notifications/*` |
| Marketplace / My Applications | `OfficeManagment/Marketplace/*`, `shared/services/softwareAccess.service.js` → `pages/MyApplications/*`, `Hooks/useLaunchSoftware.js` |
| Client Portal | `OfficeManagment/{ClientAuth,ClientPortal}/*` → `pages/ClientPortal/*`, `clientPortal/*` |

### GST
| Topic | Source files |
|---|---|
| GST gating & client scoping | `backend/server.js`, `backend/src/middlewares/requireSoftwareSelection.js`, `backend/src/gst/utils/scopeGuard.js` |
| GST clients/GSTIN | `backend/src/gst/gst-client/*` → `frontend/src/gst_Frontend/modules/gst/GSTClient/*` |
| Returns (generate/file/unlock) | `backend/src/gst/gst-return/*` → `gst_Frontend/modules/gst/GSTReturns/*` |
| GSTR-1 sections | `backend/src/gst/GSTR-1/<SECTION>/*` → `gst_Frontend/modules/gst/GSTR1/*` |
| Validation engine | `backend/src/gst/GSTR-1/shared/validationIssues.service.js` (+ `gstinValidation.js`, `documentNumberValidation.js`, `moneyValidation.js`, `zodIssues.util.js`) |
| Excel import | `backend/src/gst/GSTR-1/import/*`, `gst/utils/importRunner.js` → `BulkImportModal.jsx`, `config/socket.js` |
| JSON export | `backend/src/gst/GSTR-1/export/*` |
| GSTR-3B / GSTR-9 | `backend/src/gst/gst-gstr3b.controller.js`, `gst-gstr9.controller.js` → `GSTR3B/`, `GSTR9/` |
| GSTR-7 | `backend/src/gst/gstr7-*` → `gst_Frontend/modules/gst/GSTR7/*` |
| Accounting integration | `backend/src/gst/accounting/*` → `gst_Frontend/api/accountingCompaniesApi.js`, `RequestPeriodModal.jsx` |
| Due-date rules | `backend/src/gst/compliance-calendar/*` |
| Admin overview | `backend/src/gst/admin-overview/*` → `modules/gst/AdminOverview/*` |
| Standalone mode on UI | `frontend/src/gst_Frontend/helpers/gstMode.js`, `routes/GstAuthGuard.jsx`, `pages/gstUser/*` |

### Data model
| Topic | Source |
|---|---|
| Entire schema | `backend/prisma/schema.prisma` |
| Migrations | `backend/prisma/migrations/*` |
| Seeds | `backend/prisma/seed-*.js` |
| Maintenance scripts | `backend/prisma/scripts/*.js` |

### Chatbot / AI
| Topic | Source |
|---|---|
| Chat widget (frontend only) | `frontend/src/office_Managment_Frontent/components/Chat/ChatWidget.jsx`, mounted in `layouts/AppShell.jsx` |
| Socket server | `backend/server.js` (`join-import-room` only) |
| Gemini / LLM | **does not exist** — see [AI_AGENT_DOCUMENTATION.md](AI_AGENT_DOCUMENTATION.md) |

## 3. Frequently asked questions → where the answer is
| Question | Answer location |
|---|---|
| What does the project do? | PROJECT_OVERVIEW §1 |
| What stack is used? | PROJECT_OVERVIEW §4; INTEGRATIONS §5 |
| What port does the API use? | INTEGRATIONS §1 (`PORT`, default 5001) |
| What is the health-check URL? | API §0 (`GET /health`) |
| How do I run the backend/frontend? | BACKEND §7; INTEGRATIONS §4 |
| Which env variables are needed? | INTEGRATIONS §1–2 |
| How does login work? | AUTH §2; API §1 |
| How long do tokens last? | AUTH §1 (access 2d, refresh 7d, client 1d/7d, GST 2d/7d by default) |
| Which roles exist? What can each do? | AUTH §4; GLOSSARY §A |
| How are tenants isolated? | SYSTEM_ARCHITECTURE §3; AUTH §5 |
| What is X-Company-Id? | SYSTEM_ARCHITECTURE §3; API §0 |
| How do I create a task? / task statuses? | BUSINESS_LOGIC §4; API §6 |
| How does task approval work? | BUSINESS_LOGIC §4.2 & §5 |
| Why can't I reassign a task? | BUSINESS_LOGIC §4.3 |
| When do tasks become overdue? Reminder times? | BUSINESS_LOGIC §4.4 |
| How does a software task get completed? | BUSINESS_LOGIC §5; MARKETPLACE §3 |
| What happens when a GST return is filed? | GST §4; BUSINESS_LOGIC §5 |
| Is filing sent to the GST portal? | GST §4, §11 (no — local ARN) |
| How does bulk import work? | GST §5.3 |
| What are BLOCK vs WARN issues? | GST §5.2 |
| Which tables does GSTR-1 JSON export include? | GST §5.4 |
| How is GSTR-3B calculated? | GST §6 |
| How are invoices numbered/created? | BUSINESS_LOGIC §7 |
| How do payments update invoices? | BUSINESS_LOGIC §7 (point 4) |
| How does a client log into the portal? | CLIENT_PORTAL §1–2 |
| How is software access decided? | MARKETPLACE §3 |
| Is there online payment/Razorpay? | MARKETPLACE §1; FEATURES §4 (no) |
| Where are documents stored? | SYSTEM_ARCHITECTURE §8; INTEGRATIONS §3 |
| How is Google Meet created? | BUSINESS_LOGIC §8; INTEGRATIONS §3 |
| How are e-mails/WhatsApp sent? | BACKEND §4; INTEGRATIONS §3 |
| Which schedulers run? | SYSTEM_ARCHITECTURE §6 |
| Is there a Gemini chatbot? Where? | AI_AGENT (no; only a widget) |
| What do the `/workspace/*` pages show? | FRONTEND §10 (placeholders) |
| What does "Dynamic Messaging" do? | FRONTEND §10 (UI mock) |
| Which features are unfinished? | FEATURES §1–10 |
| I get error "<message>" — why? | ERROR_HANDLING §3–7 |
| What is `GSTTask`/`GSTUserProfile`? | DATABASE §7; GST §11 (unused legacy) |

## 4. Retrieval guidance for the chatbot
1. **Identify the area**: office (clients/tasks/billing), GST, portal, platform (auth/access/config).
2. **Prefer specifics**: quote file paths, endpoint paths, model/field names exactly as written here.
3. **Respect scope rules**: multi-tenant, permission and software-access constraints apply to every data question.
4. **State uncertainty**: if a doc marks something **[UNVERIFIED]**, "not implemented", or "placeholder", say so.
5. **Never expose secrets**: this knowledge base has none; never invent keys, passwords or URLs. Seed credentials exist only inside `backend/prisma/seed-admin.js` and are intentionally not reproduced.
6. **Time-sensitivity**: statements describe the repository snapshot on branch `outstrip_Aditi` (last commit seen: `efe9e5c Add DSC software`). Re-generate after significant changes.
