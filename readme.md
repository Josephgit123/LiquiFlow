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

- **Merchant Module** (15 pages): Landing, Login, Registration, Google Auth, Onboarding, Dashboard, Reserve Vault, Settlement Ledger, Transactions, Refund Hub, Support Tickets, Analytics, Notifications, Settings, Developer Sandbox.
- **Admin Module** (12 pages): Admin Login, Dashboard, Merchant Manager, Risk Engine Configurator, Merchant Configuration, Refund Queue, Settlement Engine, Chargeback Simulator, Support Desk, Audit Logs, Analytics, Platform Settings.

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

The frontend lives at the **repository root** (not in a `client/` folder); the API lives in `backend/`.

```bash
git clone <repo-url> liquiflow
cd liquiflow

# Frontend (root)
npm install
npm run dev              # Vite dev server on :5173

# Backend
cd backend && npm install
cp .env.example .env     # fill in Firebase + Gemini + admin credentials
npm run dev              # Express API on :4000
```

See `DEPLOYMENT_GUIDE.md` for production setup and required environment variables, and `PROJECT_STRUCTURE.md` for the full folder layout (which diverges from the original spec's `client/`+`server/` naming).

## Project Status

LiquiFlow is an actively scaffolded reference implementation, currently ahead of the original master specification in some ways (safer admin-auth pattern, JWT-based sessions) and behind it in others (most route handlers are auth-guarded stubs — see `API_DOCUMENTATION.md` for exactly what's implemented versus scaffolded). Live gateway connectivity, multi-currency settlement, and real bank payouts remain out of scope — see `PAYMENT_FLOW.md` for the developer-sandbox simulation model used instead.

## License

Proprietary — internal development and portfolio use only unless otherwise licensed.
