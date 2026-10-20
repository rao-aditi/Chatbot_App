# Frontend Documentation

> Root: `frontend/` (React 18 + Vite 8, JSX, Tailwind v4). Related: [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) §9, [AUTHENTICATION_AND_PERMISSIONS.md](AUTHENTICATION_AND_PERMISSIONS.md) §6, [GST_MODULE_DOCUMENTATION.md](GST_MODULE_DOCUMENTATION.md) §10, [API_DOCUMENTATION.md](API_DOCUMENTATION.md).
> Folder names contain historical typos: `office_Managment_Frontent` (sic) and `gst_Frontend`. Path alias `@` → `frontend/src`.

## 1. Bootstrap (`src/main.jsx`)
`Provider(store)` → `PersistGate` → `QueryClientProvider(queryClient)` → `BrowserRouter(basename = import.meta.env.BASE_URL)` → `App`. `App` wraps routes with `ThemeProvider` (`helperFunction/ThemeContext.jsx`, light/dark) and `AlertProvider` (`helpers/AlertContent.jsx`, `useAlert().showAlert({type,title,message})`).

Environment variables used (names only): `VITE_API_URL` (API base, default `http://localhost:5001`), `VITE_GOOGLE_CLIENT_ID` (Google sign-in), `import.meta.env.BASE_URL`, `import.meta.env.DEV`. Vite config: alias `@`, React + Tailwind plugins, `server.host=true`, one allowed ngrok host.

## 2. Top-level routes (`src/App.jsx`)

| Path | Component | Notes |
|---|---|---|
| `/` | `Home` | logged-in staff → `/officeManagment_DashBoard`; client session → `/client-portal/dashboard`; else `Landing` |
| `/login`, `/forgot-password`, `/reset-password` | `Login/*` | staff auth (Formik + Yup; Google button) |
| `/signup` | `pages/Public/Signup` | self-signup (also Google) |
| `/client-portal/login` | `ClientPortalLogin` | |
| `/gst/login`, `/gst/register`, `/gst/forgot-password`, `/gst/reset-password` | `gst_Frontend/pages/gstUser/*` | standalone GST auth |
| `/gst/*` | `GstAuthGuard` → `GstReturnRoute` | standalone GST app |
| `/officemanagement/login` etc. | redirects | legacy fallbacks |
| `ProtectedLayout` children: `/gst-return/*` (`GstReturnRoute`), `/companies/new` (`SelectProfession`), `/companies/new/:profession` (`SignupForm`), and `/*` → `AppShell` → `OfficeManagementRoutes` | | requires staff tokens or client session |

`ProtectedLayout` also starts `startProactiveRefresh(kind)` (see §7).

## 3. Office Management routes (`office_Managment_Frontent/routes/AppRoutes.jsx`)

All lazy-loaded; wrapped by `ProtectedRoute` with the permission shown.

| Route | Page | Permission(s) |
|---|---|---|
| `/officeManagment_DashBoard` | role dashboard: admin → `PracticeDashboard`, branch_manager → `ManagerDashboard`, employee → `EmployeeDashboard`, hr → `HRDashboard`, client → `ClientPortalDashboard` | — |
| `/profile`, `/notifications` | `ProfilePage`, `NotificationsPage` | — |
| `/my-applications` | `MyApplicationsPage` (software cards + Open) | `view_my_applications` |
| `/software-marketplace`, `/select-software` | redirect → `/my-applications` | |
| `/clients-CRM`, `/clients-CRM/onboarding`, `/clients/:id` | `ClientList`, `ClientOnboarding`, `ClientDetail` | `view_all_clients` or `view_assigned_clients` |
| `/office-users`, `/users/new`, `/users/:id/edit` | `officeUserList`, `OfficeUserForm` | `list_users`/`create_user` |
| `/roles-permissions` | `RolesPermissionsPage` | `manage_roles` |
| `/tasks`, `/tasks/:id` | `TaskList`, `TaskDetail` | `view_all_tasks` or `view_own_tasks` |
| `/assign-task` | `AssignTask` (uses `TaskForm`) | `create_task` |
| `/task-completion` | `TaskCompletion` | `mark_task_complete`/`update_task_status` |
| `/reassign-summary` | `ReassignSummary` | `reassign_task`/`reassign_task_within_team` |
| `/due-date-reminder` | `DueDateReminder` | view tasks / due-date permissions |
| `/quotation`, `/invoice`, `/invoices/:id`, `/billing` | `QuotationList`, `InvoiceList`, `InvoiceDetails`, `Billing` | `create_quotation`/`view_quotation`; `generate_invoice` |
| `/service-types` | `ServiceTypeMaster` | `create_service_type`/`update_service_type`/`create_change_fees` |
| `/documents` | `DocumentCenter` | `upload_documents`/`delete_documents` |
| `/dynamic-messaging`, `/notification-link` | `DynamicMessaging`, `NotificationLink` | `send_client_messages` |
| `/settings/permissions` | `PermissionMatrix` | `view_audit_logs` |
| `/reports/:type` | `ReportsPage` | `view_all_reports`/`view_operational_reports`/`view_own_reports` (types: tasks, overdue, clients, fees, invoices, payments, staff-performance) |
| `/workspace/ca-tax`, `/workspace/cs`, `/workspace/cma`, `/workspace/advocate` | `CaTaxWorkspace`, `CsWorkspace`, `CmaWorkspace`, `AdvocateWorkspace` | task permissions + `PracticeRoute` (company profession) |
| `/compliance-calendar` | `ComplianceCalendar` (calendar / list / year views) | `view_compliance_calendar` |
| `/appointments`, `/enquiries` | `AppointmentList` (+ `AppointmentForm`), `EnquiryList` | `view_communication` |
| `/hr`, `/hr/calendar`, `/hr/employee-performance/:userId` | `HRManagement`, `AttendanceCalendar`, `EmployeePerformanceDetail` | `view_all_reports`/`view_operational_reports`/`view_hr_workforce` |
| Client session only: `/client-portal/dashboard|services|documents|assignments|deadlines|appointments|payments|notifications|profile` | `ClientPortal*` pages | invoices/quotations URLs redirect to `payments` |
| `*` | redirect to `/` | |

`ProtectedRoute` denies → `<Navigate to="/dashboard">` (which then falls to `*` → `/`).

### Shell
- `layouts/AppShell.jsx`: `Header` + `SideBar` + `<Outlet context={{userRole}}/>`; blocks users without an `OFFICE_MANAGEMENT` software role; renders `ChatWidget` for staff (not in client mode).
- `components/SideBar/SideBar.jsx`: menu built from permission keys (Dashboard, Clients & CRM, User Management → Users/Roles & Permissions/Employee & HR, Due Date Reminder, Task Management → My/All Tasks, Task Completion, Reassign Summary, Communication → Appointments/Enquiries & Leads, Service Fees, Billing, Reports → 6–7 reports, Compliance Calendar, Notifications, "Services" workspaces by profession, My Applications). HR gets a dedicated menu (Overview, Employee Attendance, Notifications). Client sessions get the 9-item portal menu.
- `components/Header/Header.jsx` + `CompanySwitcher.jsx` (switch company → `activeCompanyId` in localStorage + `X-Company-Id` header), `Notification.jsx`, theme switcher (`ThemeSwitcher`), user menu with profile and logout (`reqToUserLogout`); client sessions use `clearClientSession`. Profile settings: `Login/ProfileSettingsModal.jsx` and `pages/profile/ProfilePage.jsx`.

## 4. Feature areas and how they call the backend

| Area | Main files | Backend |
|---|---|---|
| Auth | `Login/*`, `store/slice/auth/authSlice.js` (`reqToUserLogin`, `reqToUserRegister`, `reqToGoogleAuth`, `reqToUserLogout`, `fetchUserPermissions`, `fetchMyCompanies`, `reqToSetOfficeStructure`, `reqToCreateCompany`, `reqToSetCompanyProfessions`, `reqToCompleteOnboarding`, `saveProfile`, `changeOwnPassword`, `getEnums`) | `/api/auth/*`, `/api/permissions`, `/api/companies/*`, `POST /api/getEnums` |
| Clients | `pages/ClientManagement/*`, `onboarding/*` (`MasterDataModule`, `AddClientFormModal`, entity `form-sections/*`, `config/entityEndpoints.js`), `api/clientApi.js`, `onboarding/api/clientsApi.js`, React Query `useClientsQuery`, `onboarding/api/queries/useMasterDataQuery` | `/api/client/*`, entity routes, `/api/clients` |
| Client detail tabs | `ClientDetail.jsx`: Overview, Contact & Tax, Services, Assignments, Documents, Quotations, Invoices (Payments), History, Notes/Activity (+ `DocumentRequestsTab`, `ShareClientModals`) | tasks, documents, document-requests, quotations, invoices |
| Tasks | `pages/TaskManagement/*`, `components/TaskManagement/*` (`ChecklistSection`, `RemindersSection`, `StatusHistorySection`, `TaskDocumentsSection`, `TaskDocumentRequestsSection`, `TaskAttributesSection`, `TaskDetailTabs`, `RequestDocumentModal`, `EditClientModal`), `Workflow/*` (`TaskWorkflowPanel`, `EvidenceForm`, `FilePicker`, `FilePreviewModal`, `SubmissionCard`, `ReviewSection`), `api/taskApi.js`, `api/taskWorkflowApi.js`, `api/dueDateApi.js`, slices `task`, `dueDate`; hooks `useTaskEnums`, `useTasksQuery`, `useTaskWorkflowQuery`, `useAssigneesQuery` | `/api/task/*`, `/api/due-dates/*` |
| Software launch | `Hooks/useLaunchSoftware.js`, `helpers/softwareUi.js`, `components/Marketplace/*`, `MyApplicationsPage.jsx`, `api/marketplaceApi.js` | `/api/marketplace/*` |
| Billing | `QuotationAndFees/*`, `ServiceTypes/*`, `Billing/Billing.jsx`; slices `quotation`, `payment`, `serviceType`; APIs `quotationApi`, `invoiceApi`, `paymentApi`, `serviceTypeApi` | `/api/quotation`, `/api/invoice`, `/api/payment`, `/api/service-type` |
| Documents | `pages/Documents/DocumentCenter.jsx`, `UploadModal.jsx`, `components/Documents/*`, `helpers/documentPreview.js`, `api/documentApi.js`, `api/googleDriveApi.js`; slices `document`, `googleDrive` | `/api/documents`, `/api/google-drive` |
| Roles | `pages/RolesPermissions/*` (`RolesPermissionsPage`, `AddEditRoleModal`, `permissionsCatalog.js`), `pages/Settings/PermissionMatrix.jsx`, `api/rolesApi.js`; slice `permission` | `/api/permissions/*` |
| Users | `pages/UserManagement/*`, `modules/user-management/api/officeUsersApi.js`, `store/officeUsers/officeUsersSlice.js`, `api/queries/useOfficeUsersQuery.js` | `/api/user-management/office-users` |
| Communication | `pages/Appointments/*`, `api/appointmentsApi.js`, `api/enquiriesApi.js`, `Hooks/useAppointmentStatuses.js` | `/api/appointments`, `/api/enquiries` |
| Compliance | `pages/Compliance/*` + `api/complianceCalendarApi.js` + React Query hooks (`useComplianceEventsQuery`, `useComplianceSummaryQuery`, `useOfficeHolidaysQuery`, `useMarkComplianceCompleteMutation`) | `/api/compliance-calendar/*` |
| HR | `pages/HR/*`, `api/hrApi.js`, `helpers/staffPerformanceHelpers.js`, `components/StaffPerformance/MetricCard.jsx` | `/api/hr/*`, `/api/reports/staff-performance` |
| Reports | `pages/Reports/ReportsPage.jsx`, `components/Reports/*`, `helpers/exportUtils.js` (xlsx/pdf export via `xlsx`, `jspdf`, `jspdf-autotable`), slice `reports` | `/api/reports/*` |
| Dashboards | `pages/DashBoard/*`, `api/dashboardApi.js`, `usePracticeDashboardQuery`, `useDueDateDashboardQuery`, `common/RevenueTrendChart.jsx` (recharts) | `/api/dashboard/practice`, `/api/due-dates/dueDate_dashboard` |
| Notifications | `pages/Notifications/NotificationsPage.jsx`, `components/Notification.jsx`, `api/notificationApi.js`, `useNotificationsQuery` | `/api/notifications/*` |
| Client Portal | `pages/ClientPortal/*` (thin wrappers: `ClientPortalPage` verifies the session then renders a section from `clientPortal/pages/Client*.jsx`), `clientPortal/clientSession.js`, `api/clientPortalApi.js`, `useClientPortalQuery` | `/api/client-portal/*` |
| Chat widget | `components/Chat/ChatWidget.jsx` | **no matching backend** (see AI_AGENT_DOCUMENTATION) |

## 5. GST frontend (`src/gst_Frontend/`)
- `GstReturnRoute` = `GstAppShell` (layout/sidebar/header, `ClientDashboardLayout`) + `GSTRoutes`.
- `GstLayout` routes: index landing (`GstLanding`: Admin → `GstReturnOverview`; others/standalone → `GSTClientsList`), `:clientId` & `:clientId/registrations` → redirect to filing, `:clientId/returns-filing` | `filing-history` | `warning-log` → `GSTClientWorkspace`.
- `GSTRoutes`: `gstr1/:returnId` (`GSTR1EditForm`), `gstr1/:returnId/view-all` and `/tab/:tabKey` (`GSTR1ViewAll`), `gstr7/:returnId` (`GSTR7EditForm`), each inside `ReturnDataGate` (loads return data before rendering).
- Modules: `GSTClient/` (`GSTClientsList`, `GSTClientWorkspace`, `RequestPeriodModal` for accounting period requests), `GSTR1/` (`GSTR1EditForm`, `GSTR1ViewAll`, `GSTR1SidePanel`, `BulkImportModal` (Excel stage/commit with Socket.IO progress), `GSTR1ModuleAddEdit/*` grid entry & invoice modals, `gstr1ModuleConfig.js` = per-section endpoint + field list), `GSTR3B/GSTR3BEditForm`, `GSTR7/*`, `GSTR9/GSTR9EditForm`, `GSTReturns/*` (`GSTReturnsPanel`, `ViewReturnsModal`, `GSTWarningLogPanel`, `GSTDuplicateResolutionModal`), `AdminOverview/*` (Admin return overview with FY and return-type selects).
- APIs: `gstClientsApi`, `gstReturnsApi`, `gstr1Api`, `gstr7Api`, `gstUserApi`, `accountingCompaniesApi`, `gstAdminOverviewApi`; all go through the shared axios instance (`gst_Frontend/api/axiosConfig.js` re-exports Office `axiosConfig`). `gstUserAxiosClient.js` hosts `isGstUserLoggedIn()` etc.
- Redux slices: `gstClients` (`ClientSlice`), `gstReturns`, `gstr1`, `gstr3b`, `gstr7`, `gstr9`.
- `helpers/gstMode.js`: `isStandaloneGst()` = path starts with `/gst`; `gstBase()` → `/gst` or `/gst-return`; `applyStandaloneRouting` rewrites `api/gst/…` → `api/gst-user/gst/…`, `api/getEnums|getGstEnums` → `api/gst-user/getGstEnums`, `api/gstr1|gstr7/…` → `api/gst-user/gstr1|gstr7/…`, replaces the Authorization header with the GstUser token and drops `X-Company-Id`.
- `config/socket.js`: `getSocket()` singleton `io(VITE_API_URL || "http://localhost:5001")`; `BulkImportModal.jsx` emits `join-import-room` with its `importId`, listens for the `import-progress` event, and falls back to polling `api/gstr1/import-progress/:importId` if no live event arrives within a timeout (the server also emits `import-complete`; the modal code reviewed only subscribes to `import-progress`).
- Template download: `/templates/GSTR1_Excel_Workbook_Template_V2.0.xlsx`.

## 6. State management
- `store/rootReducer.js` combines: `auth` (persisted via redux-persist whitelist `["auth"]`), `clients`, `officeUsers`, `tasks`, `dueDates`, `permission`, `serviceTypes`, `quotations`, `payments`, `documents`, `googleDrive`, `reports`, `gstClients`, `gstReturns`, `gstr3b`, `gstr9`, `gstr7`, `gstr1`.
- React Query (`core/query/queryClient.js`): `staleTime 30 s`, `gcTime 5 min`, `refetchOnWindowFocus false`, `refetchOnReconnect false`, `retry 1` (mutations 0). Query keys in `core/query/queryKeys.js`; per-feature hooks in `office_Managment_Frontent/api/queries/`.
- `localStorage` is the source for tokens (see sessionKeys) and `activeCompanyId`.

## 7. Networking layer
`office_Managment_Frontent/api/axiosConfig.js` (single axios instance, timeout 50 s, `ngrok-skip-browser-warning` header):
- **Request interceptor:** FormData → drops JSON content type; standalone GST path → `applyStandaloneRouting`; client token present → client session; else staff token + `X-Company-Id`; GST API calls add `X-Task-Id` from `?taskId=` in the page URL. Each request is tagged `__sessionKind` (`staff|client|standalone`).
- **Response interceptor:** on 401 → `retryWithFreshToken` (refresh via the right endpoint, replay); on 403 containing "requested company" with `X-Company-Id` → clears `activeCompanyId` and reloads; timeout message "Request timed out. Check that the API is running at <BASE_URL>".
- `core/auth/tokenRefresh.js`: `SESSION_KINDS` (refresh paths `/api/auth/refresh`, `/api/gst-user/auth/refresh`, `/api/client-portal/auth/refresh`; login paths; public paths that must never be force-redirected), `isAuthEndpoint` regex (login/register/refresh/google/forgot/reset never trigger refresh), `startProactiveRefresh(kind)`.
- Error text helper: `helpers/apiError.js#getApiErrorMessage`.

## 8. UI building blocks
`components/ui/*` (Button, Card, Badge, Modal, TextInput, SelectInput, DatePicker, PhoneInput, Checkbox, ToggleButton, Tooltip, MoreActionsMenu, GoogleAuthButton), `components/common/*` (Datatable, CustomTable, StatusBadge, StatTile, PageHeader, SearchInput, DateRangeFilter, EmptyState, ApproveRejectModel, StatusChangeModel, RevenueTrendChart), `components/Loader`, `Model/ModalPortal`. GST app has its own copies under `gst_Frontend/components`. Styling = Tailwind classes with CSS variables (e.g. `--color-brand`).

## 9. Key user workflows (frontend → backend)
1. **Sign up → dashboard**: `/signup` → `reqToUserRegister` → `POST /api/auth/register` → `/officeManagment_DashBoard`; Admin chooses SOLO/MULTIPLE and professions (`ChooseOfficeStructureModal` and `ProfessionModal`, opened from `ProfilePage.jsx` / company flows), then selects software in My Applications (`SelectSoftwareModal`).
2. **Create client**: Clients & CRM → `ClientOnboarding`/`MasterDataModule` → pick entity type → `AddClientFormModal` (Yup validation) → `POST` entity endpoint → optional Portal Access toggle e-mails credentials.
3. **Assign task**: `/assign-task` → `TaskForm` loads assignees (`GET /api/task/assignees`), assignee's clients (`/assignees/:id/clients`), software options (`/api/marketplace/task-software-options`), service types → `POST /api/task/create_Task`.
4. **Do a software task**: `TaskDetail` → `TaskWorkflowPanel` → Start → Open Software (`launch-software`) → (GST) file the return → Submit evidence (`EvidenceForm`) → approver `ReviewSection` → approve/reject/request corrections.
5. **File a GST return**: `/gst-return` → client → `returns-filing` → generate returns → open GSTR-1 → add records / bulk import → resolve warnings → File → Download JSON.
6. **Client portal**: `/client-portal/login` → dashboard of own services, tasks, deadlines, documents (upload / download), document requests (submit), invoices/quotations (read), appointments, notifications.

## 10. Placeholder / mock UI (verified — NOT connected to a backend)

| File | Reality |
|---|---|
| `pages/Workspaces/CaTaxWorkspace.jsx`, `CsWorkspace.jsx`, `CmaWorkspace.jsx`, `AdvocateWorkspace.jsx` (20 lines each) | Render `PageHeader` + `EmptyState` "No data available — This workspace isn't connected to a backend yet". Routes, permissions and profession gating are real; the content is not |
| `pages/Messaging/DynamicMessaging.jsx` | Form only; `handleSend` shows a success alert ("Update dispatched to all client portals.") and clears the textbox — **no API call**, no SMS/WhatsApp broadcast exists |
| `pages/Messaging/NotificationLink.jsx` | Generates a random fake link (`https://caoffice.com/secure/request/req-NNNNNN`) client-side and copies it — no backend |
| `pages/ClientManagement/components/NotesActivityTab.jsx` | Static text: notes/CRM activity "aren't tracked as structured data in this system yet" |
