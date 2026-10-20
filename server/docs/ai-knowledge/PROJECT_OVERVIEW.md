# Project Overview

> Part of the AI knowledge base in `docs/ai-knowledge/`. Start from [AI_KNOWLEDGE_INDEX.md](AI_KNOWLEDGE_INDEX.md).
> Everything here was derived from the source code in this repository. Items that could not be verified are marked **[UNVERIFIED]**.

## 1. What the project is

The repository (folder name `officeGST`, backend npm package referred to by the git remote as `gst_backend`) is a **multi-tenant practice-management platform for Indian accounting / compliance professionals** (CAs, CSs, CMAs, tax consultants, advocates). It has two big product areas inside one codebase:

1. **Office Management** – the "main" software. A practice owner (the **Admin**) signs up, optionally creates one or more companies/firms, creates staff users (Branch Managers, Employees, HR), onboards clients (12 Indian entity types), assigns tasks, tracks due dates/reminders, raises quotations → invoices → payments, stores documents (Google Drive), schedules appointments (Google Meet), tracks enquiries/leads, HR attendance, reports, a compliance calendar, and a Client Portal where the practice's own clients can log in.
2. **GST Software** (a "module" of Office Management, also available as a **standalone product** with its own user accounts) – GST return preparation and filing workspace: GSTR-1 (all ~29 sections, bulk Excel import with staged validation, GSTN-offline-tool JSON export), GSTR-3B, GSTR-7, GSTR-9, return locking/filing/unlocking, GST due-date rules, a filing-blocker/warning validation engine, and an integration pulling GSTR-1 data from an external "accounting software" API.

Other "software modules" listed in the catalog (TDS, ROC, DSC) exist only as **catalog entries / access permissions** (`use_tds`, `use_roc`, `use_dsc`). There is **no TDS or ROC backend module in this repo**. DSC launches an external URL (see [INTEGRATIONS_AND_CONFIGURATION.md](INTEGRATIONS_AND_CONFIGURATION.md)).

## 2. Who uses it (actors)

| Actor | How they log in | Notes |
|---|---|---|
| Super Admin (`SUPER_ADMIN` @ `SYSTEM` software) | `/login` (staff login) | Platform operator; sees everything; seeded by `backend/prisma/seed-admin.js` |
| Admin (`ADMIN` @ `OFFICE_MANAGEMENT`) | `/login` or Google, or self-signup `/signup` | Practice owner; **every new self-registered user becomes an ADMIN of their own organization** |
| Branch Manager (`BRANCH_MANAGER`) | `/login` | Created by Admin; manages a team |
| Employee (`EMPLOYEE`) | `/login` | Created by Admin / HR / Branch Manager (restricted) |
| HR (`HR`) | `/login` | Sees workforce, attendance; can create Employees and Branch Managers only |
| Custom roles | `/login` | Admin-defined roles with a chosen set of permission keys |
| Client (portal) | `/client-portal/login` | A `Client` row with `portalAccess=true`; separate JWT secret |
| GST standalone user (`GstUser`) | `/gst/login` | Completely separate table, tokens and routes (`/api/gst-user/*`) |

See [AUTHENTICATION_AND_PERMISSIONS.md](AUTHENTICATION_AND_PERMISSIONS.md).

## 3. Main features (implemented, verified in code)

- Self-signup, email/password login, Google sign-in (OAuth code flow), forgot/reset password by email (30-minute token), refresh-token rotation, logout / logout-all.
- Organizations: single-office ("SOLO") or multi-company ("MULTIPLE") structure; company switcher via `X-Company-Id` header; profession selection (CA, CS, CMA, TAX_CONSULTANT, ADVOCATE) that drives sidebar "workspaces".
- Role & permission management (built-in roles + Admin-owned custom roles, permission matrix).
- User management for office staff and for Super Admin (`/api/user-management/*`).
- Client master data for 12 entity types (Individual, HUF, Firm, AOP, Trust, Body of Individuals, Artificial Juridical Person, Cooperative Society, Public Company (interested / not interested), Private Company, Local Authority); client codes; sharing clients across companies; Client Portal access with e-mailed generated credentials.
- Task management with maker/approver workflow, checklists, reminders, due-date changes, reassignment, status history, activity log, document requests to clients.
- "Software tasks" (tasks that require GST/TDS/ROC/DSC software): launch software from a task, submit completion evidence, approver reviews (approve / reject / request corrections).
- Software marketplace / "My Applications": organizations *select* software for free (provider value `SELECTION`); per-user authorization for each software; Super-Admin revocation; expiry sweeper.
- Quotations → Invoices → Payments (with automatic invoice status sync), service-type master (fees, tax rate, discount flag).
- Documents (Google Drive for staff uploads; local `backend/uploads/client-portal/...` for client uploads), document requests, document types.
- Appointments (Google Calendar/Meet integration) and Enquiries/Leads pipeline.
- Notifications: in-app + email (SMTP via nodemailer) + WhatsApp (Vonage) for task events, reminders, document events.
- Compliance calendar (tasks + GST due dates + appointments + office holidays) and GST due-date rule/override engine.
- HR attendance (auto check-in on login for Employees/Branch Managers), staff-performance reports.
- Reports (tasks, overdue, clients, fees, invoices, payments, staff-performance) with export helpers on the frontend.
- Practice / role dashboards.
- GST module: client (GSTIN) management, return generation, GSTR-1 sections CRUD, import via Excel with staging + duplicate resolution, validation issues (BLOCK/WARN), GSTR-1 JSON preview/download, GSTR-3B calculation, GSTR-9 summary, GSTR-7 (deductee, amendments, cash ledger, summary, Excel import), filing/lock/unlock, accounting-software access requests and automatic GSTR-1 import, Real-time import progress over Socket.IO.

## 4. Technology stack

### Backend (`backend/`)
- Node.js, **Express 5** (`express@^5.2.1`), CommonJS modules.
- **Prisma 6** ORM on **PostgreSQL** (Supabase pooler referenced in `backend/src/shared/prisma.js` comments).
- Auth: `jsonwebtoken`, `bcryptjs`; validation: `express-validator` and `zod`.
- `socket.io` (import-progress rooms only), `node-cron` (schedulers), `nodemailer` (email), `@vonage/server-sdk` + `@vonage/messages` (WhatsApp), `googleapis` (Google OAuth/Drive/Calendar), `multer` (uploads), `xlsx` (Excel import), `axios` (accounting API), `express-rate-limit`, `compression`, `cookie-parser`, `cors`, `dotenv`.
- Dev: `nodemon`.

### Frontend (`frontend/`)
- **React 18** + **Vite 8**, JavaScript (JSX), `react-router-dom` v7.
- State: **Redux Toolkit** + `redux-persist` (only the `auth` slice is persisted) and **TanStack React Query v5**.
- UI: Tailwind CSS v4 (`@tailwindcss/vite`), MUI (`@mui/material`), `lucide-react`, `react-icons`, `recharts`, `react-big-calendar`, `react-data-grid`, `gsap`, `lenis`.
- Forms: `formik` + `yup`. Other: `axios`, `socket.io-client`, `xlsx`, `jspdf` + `jspdf-autotable`, `html2canvas`, `html-to-image`, `date-fns`, `react-phone-number-input`.
- Deployment config: `frontend/vercel.json` (SPA rewrite to `/index.html`).

### Root
- Root `package.json` only lists `clsx`, `socket.io-client`, `tailwind-merge` (no scripts).

## 5. Deployment hints found in code
- Backend comments repeatedly reference **cPanel "Setup Node.js App" / Passenger** (`PORT` is assigned by the host; `backend/.env.example`). `app.set("trust proxy", 1)` is enabled.
- CORS default allow-list (dev) in `backend/server.js` includes `localhost:5173/5174`, dev tunnels, a Vercel URL and the `outstripinfotech.com` domain; production should set `CORS_ORIGINS`.
- Frontend is configured for Vercel (SPA rewrites).
- Health endpoint: `GET /health` → `{ ok: true }`.

## 6. AI agent / chatbot status

**No AI agent, Gemini integration or LLM code exists in this repository** (verified by searching the whole tree for `gemini`, `genai`, `openai`, `chatbot`). A **frontend chat widget exists** (`frontend/src/office_Managment_Frontent/components/Chat/ChatWidget.jsx`) that expects a Socket.IO + REST chat backend which is **not implemented in the backend here**. Details: [AI_AGENT_DOCUMENTATION.md](AI_AGENT_DOCUMENTATION.md).

## 7. Where to read next
- Layout of files: [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)
- How the pieces connect: [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)
- Feature status table: [FEATURES_AND_IMPLEMENTATION_STATUS.md](FEATURES_AND_IMPLEMENTATION_STATUS.md)
