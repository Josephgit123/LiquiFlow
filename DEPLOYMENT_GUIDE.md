# Deployment Guide

## Environments

| Component | Host | Notes |
| --- | --- | --- |
| Client (React/Vite) | Vercel | Static build served from the edge network, content caching enabled. |
| Server (Node/Express) | Render or Heroku | Containerized runtime; must support sticky sessions for WebSocket connections. |
| Database | Cloud Firestore | Multi-region configuration for durability and automatic failover. |
| AI | Google Generative AI (Gemini) | Accessed via API key from the server only — never expose this key to the client. |

## Prerequisites

- Firebase project with Authentication (Email/Password + Google provider) and Firestore enabled.
- Google Generative AI API key with access to `gemini-1.5-flash` (or another current Gemini model — set via `GEMINI_MODEL`). Optional: the AI Copilot degrades to a 503 with an explanatory message if this is unset, everything else in the app works without it.
- Vercel account (client) and Render/Heroku account (server).

## Environment Variables

These match the real variable names read in `backend/src/config/env.js` — use these, not generic placeholder names, when configuring the deployment.

### `backend/.env`

```
PORT=4000
NODE_ENV=production
CORS_ORIGIN=https://your-client-domain.vercel.app

# Firebase Admin SDK — client_email + private_key from a downloaded
# service-account JSON (Firebase Console > Project Settings > Service
# Accounts > Generate new private key). There is no service-account
# *file path* variable — firebaseAdmin.js builds credentials from these
# three values directly.
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# Admin console gate — do NOT rely on the fallback defaults in env.js;
# always set these explicitly in production, and change them from the
# repo's current default values (see CLAUDE.md).
ROOT_ADMIN_ACCESS_ID=
ROOT_ADMIN_ACCESS_TOKEN=

# JWT signing — must be set to a long random value; never ship the
# 'liquiflow-dev-secret-change-me' default to production.
JWT_SECRET=
JWT_EXPIRES_IN=12h

# AI Copilot
GOOGLE_GENERATIVE_AI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash

# Reserve engine default
DEFAULT_VAULT_MATURITY_DAYS=3
```

### Root `.env` (frontend — Vite reads `VITE_*` only)

```
VITE_API_BASE_URL=https://your-server-domain.onrender.com/api
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
```

Note the API base URL has no `/v1` segment — the real backend mounts routes directly under `/api` (see `API_DOCUMENTATION.md`).

## Firestore Setup

Collections are created implicitly on first write (via the backend's Admin SDK) — there is no separate "create the collection" step. What does need an explicit step is deploying the two files in `firebase/`, which are the real, already-implemented rules and indexes for this project (there is no separate `docs/FIRESTORE_SECURITY.json` — that was an early-spec placeholder name that never matched the actual repo layout):

- **`firebase/firestore.rules`** — denies ALL direct client writes (stricter than tenant-isolation-only: every mutation goes through the Express backend's Admin SDK, which bypasses these rules entirely). Enforces per-merchant read isolation on `users`, `merchants`, `merchant_balances`, `transactions`, `reserve_vault`, and `tickets`.
- **`firebase/firestore.indexes.json`** — composite indexes for the filtered/sorted queries the app actually issues (transaction history by merchant + timestamp, reserve capsule maturity sweeps, ticket threads, merchant directory filters). A missing index here doesn't fail silently — Firestore returns `FAILED_PRECONDITION` with a console link to auto-create the specific index, visible directly in the browser console/network tab when it happens.

Deploy both with the Firebase CLI from the `firebase/` directory:

```bash
npm install -g firebase-tools   # if not already installed
firebase login
cd firebase
firebase deploy --only firestore:rules,firestore:indexes --project <your-firebase-project-id>
```

Composite index builds can take several minutes on a live project — re-check the Firestore console's Indexes tab if a query still 500s right after deploying.

## Backend Deployment (Render/Heroku)

1. Push the `backend/` directory as the deploy root (configure it as a monorepo subdirectory build — the repo root is the frontend, not the API).
2. Set all environment variables listed above in the platform's config/secrets panel.
3. Ensure the deployment plan supports long-lived connections (sticky sessions) for the WebSocket layer used to push live dashboard updates.
4. Confirm the 60-second reserve-maturity scheduler starts on boot (`server.js`) and only ever runs once per instance — if you scale to multiple server instances, gate the scheduler behind a leader-election or single-worker mechanism to avoid duplicate release transactions.
5. Verify HSTS and TLS 1.3 are enforced at the platform/proxy layer.

## Frontend Deployment (Vercel)

1. Connect the repository; the project root is the repo root itself (there is no `client/` subfolder — `package.json`, `vite.config.js`, and `index.html` all live at the top level).
2. Set the `VITE_*` environment variables in the Vercel project settings.
3. Build command: `npm run build`; output directory: `dist`.
4. Configure the CORS-allowed origin on the server to match the deployed Vercel domain exactly (including protocol).

## Post-Deploy Checklist

- [ ] Merchant registration and login flow works end to end against production Firebase Auth.
- [ ] Google OAuth callback redirect URI matches the deployed domain in Firebase console settings.
- [ ] Admin login works and admin credentials are not present anywhere in client-side bundles or logs — `ROOT_ADMIN_ACCESS_ID`/`ROOT_ADMIN_ACCESS_TOKEN` live only in the server's environment config.
- [ ] `firebase deploy --only firestore:rules,firestore:indexes` has been run against the production project — a fresh Firestore database does not pick these up automatically, and the app will otherwise fail with permission-denied reads or `FAILED_PRECONDITION` index errors.
- [ ] AI Copilot responds with real answers (not the 503 "not configured" message) if `GOOGLE_GENERATIVE_AI_API_KEY` is meant to be live in this environment.