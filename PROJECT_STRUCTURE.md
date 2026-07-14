# Project Structure

This describes the **actual folder layout on disk**, not the idealized monorepo diagram in the original master specification. The real project diverges from that spec in naming and layout — this file is the ground truth for navigating the codebase.

```
Liqiflow/
├── src/                        # <-- the real frontend app (Vite + React), lives at repo ROOT
│   ├── assets/
│   ├── components/
│   │   ├── ai/
│   │   │   └── AiCopilotDrawer.jsx
│   │   └── common/
│   │       ├── GlassCard.jsx
│   │       ├── PageStub.jsx
│   │       ├── Sidebar.jsx
│   │       ├── ThemeToggle.jsx
│   │       └── Topbar.jsx
│   ├── context/
│   │   ├── AuthContext.jsx
│   │   └── ThemeContext.jsx
│   ├── hooks/
│   ├── layouts/
│   │   ├── AdminLayout.jsx
│   │   ├── AuthLayout.jsx
│   │   ├── MerchantLayout.jsx
│   │   └── PublicLayout.jsx
│   ├── pages/
│   │   ├── admin/            # 11 admin views
│   │   ├── merchant/         # 11 merchant views
│   │   └── public/           # 5 public views
│   ├── routes/
│   │   ├── navConfig.js       # single source of truth for sidebar + router paths
│   │   └── router.jsx
│   ├── styles/tokens.js
│   ├── index.css
│   └── main.jsx
├── index.html
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json               # name: "liquiflow-frontend"
│
├── backend/                    # Express API server (separate package)
│   ├── src/
│   │   ├── config/
│   │   │   ├── env.js          # centralized, validated process.env access
│   │   │   └── firebaseAdmin.js
│   │   ├── controllers/        # currently empty — logic lives inline in routes for now
│   │   ├── middleware/
│   │   │   ├── authMiddleware.js  # requireMerchantAuth (Firebase ID token) + requireAdminAuth (JWT)
│   │   │   └── errorHandler.js
│   │   ├── routes/
│   │   │   ├── index.js        # mounts all sub-routers under /api
│   │   │   ├── authRoutes.js
│   │   │   ├── adminRoutes.js
│   │   │   ├── merchantRoutes.js
│   │   │   ├── transactionRoutes.js
│   │   │   ├── vaultRoutes.js
│   │   │   ├── aiRoutes.js
│   │   │   ├── webhookRoutes.js
│   │   │   └── healthRoutes.js
│   │   ├── services/           # currently empty — risk engine / vault sweep logic not yet implemented
│   │   ├── utils/
│   │   │   └── currency.js
│   │   └── server.js
│   ├── scripts/
│   ├── .env.example
│   └── package.json            # name: "liquiflow-backend"
│
├── firebase/
│   ├── firebase.json
│   ├── firestore.rules          # append-only + tenant isolation, enforced at the rules layer
│   ├── firestore.indexes.json
│   └── .firebaserc.example
│
├── frontend/                    # ⚠ leftover/duplicate scaffold — currently empty, superseded by root src/
│
├── readme.md                     # pre-existing project readme (see note below)
└── (this documentation set: README.md, CLAUDE.md, PROJECT_STRUCTURE.md, API_DOCUMENTATION.md,
     DATABASE_SCHEMA.md, PAYMENT_FLOW.md, SYSTEM_ARCHITECTURE.md, DEPLOYMENT_GUIDE.md, CONTRIBUTING.md)
```

## Notes on Divergence from the Master Specification

The master specification describes a `client/` + `server/` monorepo with specific page names ("Reserve Vault", "Settlement Ledger", "Refund Hub", etc.) and `/api/v1/...` endpoints. The actual implementation instead:

- Puts the frontend at the **repository root**, not in a `client/` subfolder.
- Uses a flatter `backend/` API under plain `/api/...` paths (no `/v1` version segment).
- Organizes navigation around 11 merchant views and 11 admin views (see `src/routes/navConfig.js`), with different names than the spec's 15/12-page breakdown — e.g. "Core Command Dashboard", "Maturity Vault Interface", "Risk Profile Monitor", "Refund Lifecycle Hub", "Linked Funding Settings", "API Keys & Webhooks", "System Health Status" on the merchant side, and "Global Systems Master", "Risk Matrix Configurator", "Compliance Verification", "Tiering Allocation Control", "Webhook Dispatch Registry", "Fee Structure Panel", "Database Backup Dashboard" on the admin side.
- Replaces the spec's hardcoded `Pandiabi`/`Pandiabi123` string check with an `accessId`/`accessToken` pair read from `ROOT_ADMIN_ACCESS_ID` / `ROOT_ADMIN_ACCESS_TOKEN` environment variables and a signed JWT — a meaningfully better pattern than the spec's literal string match (see `CLAUDE.md` for the one remaining issue: insecure fallback defaults for those variables).
- 