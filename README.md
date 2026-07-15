# LiquiFlow

**Post-Auth Treasury Middleware for High-Risk Digital Merchants**

LiquiFlow is a financial routing, clearing, and risk-mitigation layer that sits behind primary payment gateways (Stripe, Adyen, Braintree). It intercepts captured transactions, scores them for risk in real time, and automatically splits every payment into two pipelines: an instantly withdrawable **Liquid Pool** and a time-locked **Reserve Vault**. Reserve funds absorb chargebacks and refunds during a maturity window, then cascade automatically into the merchant's available balance.

## Why LiquiFlow

Traditional acquirers protect themselves from chargeback risk with blunt instruments — sudden rolling reserves of 10-20% held for 30-180 days, or outright account freezes. This breaks cash-flow predictability for high-growth, high-volatility merchants (SaaS, e-commerce, web3, gaming, ed-tech). LiquiFlow replaces that with a transparent, programmatic, per-transaction reserve system so merchants always know exactly what's liquid, what's held, and when it clears.

## How It Works

1. A transaction is captured by the upstream payment gateway.
2. LiquiFlow's **100-Point Risk Scoring Matrix** evaluates industry vertical, geographic mismatch, and card velocity signals.
3. The resulting Risk Tier (Low / Medium / High) determines the liquid/reserve split and the escrow hold duration (T+3, T+5, or T+7 days).
4. The liquid portion is available for payout immediately; the reserve portion locks into a `/reserve_vault` capsule.
5. A background scheduler sweeps matured capsules every 60 seconds and releases funds into the merchant's available balance.
6. Refunds and chargebacks draw from the reserve first, protecting the platform and the merchant's live balance.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React (Vite), Tailwind CSS, Framer Motion, Recharts |
| Backend | Node.js, Express.js |
| Database | Cloud Firestore (NoSQL, append-only) |
| Auth | Firebase Authentication (merchants), hardcoded credential gate (admin) |
| AI | Google Gemini AI SDK (context-aware treasury copilot) |
| Hosting | Vercel (client), Render/Heroku (server) |

## Modules

- **Public Module**: Landing page → "Get Started" leads to a role chooser (Merchant vs. Administrator), each routing to its own login — the two auth paths never share a page or a code path (see CLAUDE.md invariant #7).
- **Merchant Module** (15 pages): Login, Registration, Google Auth, Onboarding, Dashboard, Reserve Vault, Settlement Ledger, Transactions, Refund Hub, Support Tickets, Analytics, Notifications, Settings, Developer Sandbox. New merchants land in Onboarding immediately after registration — completing it (Business, Entity Type, Industry, Volume, Currency) is a one-shot gate before the Dashboard and any sandbox transaction simulation become reachable (CLAUDE.md invariant #4).
- **Admin Module** (12 pages): Admin Login, Dashboard, Merchant Manager, Risk Engine Configurator, Merchant Configuration, Refund Queue, Settlement Engine, Chargeback Simulator, Support Desk, Audit Logs, Analytics, Platform Settings. Admin login is a hardcoded credential check against `ROOT_ADMIN_ACCESS_ID`/`ROOT_ADMIN_ACCESS_TOKEN` (backend `.env`) — there is no admin registration flow and no Firebase Auth involved.
- **AI Copilot**: a slide-in drawer (bottom-right trigger) available on every authenticated merchant and admin page. Answers are grounded in a real snapshot of the caller's own data (a merchant only ever sees their own balance/transactions; an admin sees platform-wide analytics) via the Gemini API. Without `GOOGLE_GENERATIVE_AI_API_KEY` configured, it responds with a clear "not configured" message instead of erroring — every other part of the app works fine without this key.

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — ground-truth rules for AI coding agents working in this repo
- [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md) — monorepo folder layout
- [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md) — frontend/backend/data/auth/AI/security architecture
- [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) — Firestore collections and fields
- [`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md) — full REST endpoint reference
- [`PAYMENT_FLOW.md`](./PAYMENT_FLOW.md) — risk engine, reserve engine, transaction/refund/chargeback lifecycles
- [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md) — deployment steps and environment configuration
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — contribution workflow and coding conventions

## Getting Started

The frontend lives at the **repository root** (not in a `client/` folder); the API lives in `backend/`. Both must be running for ANY login (merchant or admin) to work — the frontend alone cannot authenticate against anything.

```bash
git clone <repo-url> liquiflow
cd liquiflow

# Frontend (root)
npm install
npm run dev              # Vite dev server on :5173

# Backend
cd backend && npm install
cp .env.example .env     # then fill it in — see below, every value has a comment explaining where it comes from
npm run dev              # Express API on :4000
```

### Filling in `backend/.env`

`backend/.env` is gitignored and does not exist until you create it — the server fails fast at startup (before it binds to a port) if any of `ROOT_ADMIN_ACCESS_ID`, `ROOT_ADMIN_ACCESS_TOKEN`, `JWT_SECRET`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, or `FIREBASE_PRIVATE_KEY` is missing, by design (`backend/src/config/env.js`) — there is no safe default for admin/JWT secrets. Every variable in `backend/.env.example` has a comment explaining exactly where its value comes from; in short:

1. **Firebase Admin SDK credentials** — Firebase Console → Project Settings → Service Accounts → *Generate new private key*. Downloads a JSON file; copy its `client_email` and `private_key` fields into `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` (keep the private key's `\n` sequences literal, wrapped in quotes).
2. **Admin credentials + JWT secret** — generate your own random values, e.g. `openssl rand -hex 24` for `ROOT_ADMIN_ACCESS_ID`/`ROOT_ADMIN_ACCESS_TOKEN` and `openssl rand -hex 32` for `JWT_SECRET`. These are the *only* admin login (separate from Firebase Auth) — whatever you set here is what you type into the admin login page.
3. **Gemini API key** — optional. Get one from https://aistudio.google.com/apikey for the AI Copilot to give real answers; without it, the Copilot responds with a clear "not configured" message instead of an error, and everything else in the app works normally.
4. **`CORS_ORIGIN`** — must exactly match the origin the frontend is actually served from (protocol + host + port). If Vite falls back to a different port because 5173 is already in use, either free port 5173 or update this to match.

### Deploying Firestore rules & indexes

`firebase/firestore.rules` and `firebase/firestore.indexes.json` are the real, already-implemented rules and query indexes this app depends on — a freshly created Firestore database does **not** pick these up automatically. Skipping this step doesn't fail loudly at startup; it surfaces later as permission-denied reads or `FAILED_PRECONDITION: The query requires an index` errors in the browser console once you start clicking around.

```bash
npm install -g firebase-tools   # if not already installed
firebase login
cd firebase
firebase deploy --only firestore:rules,firestore:indexes
```

(`firebase/.firebaserc` already points at the `liquiflow` project; pass `--project <id>` instead if you're deploying against a different Firebase project.)

### Troubleshooting: "NetworkError when attempting to fetch resource" on login

This means the frontend is up but the backend never started — almost always because `backend/.env` is missing or incomplete (see above). Check the terminal running `npm run dev` inside `backend/`: if it printed `[env] Missing required environment variable(s): ...` and exited instead of `liquiflow-backend listening on port 4000`, that's the fix. Once the backend is actually listening, retry the login.

See `DEPLOYMENT_GUIDE.md` for production setup and the full environment variable reference, and `PROJECT_STRUCTURE.md` for the full folder layout (which diverges from the original spec's `client/`+`server/` naming).

## Project Status

LiquiFlow's core treasury logic is implemented, not stubbed: risk scoring, the atomic liquid/reserve settlement split, the reserve maturity scheduler, refunds, chargeback clawback, onboarding, and an AI Copilot all have real service-layer implementations under `backend/src/services` (see that folder's `README.md` for the full inventory) with accompanying tests. It's ahead of the original master specification in some ways too (safer admin-auth pattern, JWT-based sessions). Live gateway connectivity, multi-currency settlement, and real bank payouts remain out of scope by design — see `PAYMENT_FLOW.md` for the developer-sandbox simulation model used instead, and `API_DOCUMENTATION.md` for the endpoint-by-endpoint reference.

## License

Proprietary — internal development and portfolio use only unless otherwise licensed.
