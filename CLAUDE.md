# CLAUDE.md

Ground-truth guidance for any AI coding agent (Claude, Copilot, etc.) working in the LiquiFlow repository. Read this before generating code, endpoints, or database logic. It summarizes the invariants defined in the master specification — do not violate them for convenience.

## What This Project Is

LiquiFlow is a post-authorization treasury middleware. It does not process cards itself — it sits behind a payment gateway, scores captured transactions for risk, and splits funds between an instantly available "Liquid Pool" and a time-locked "Reserve Vault." See `PAYMENT_FLOW.md` for the full mechanics.

## Non-Negotiable Invariants

1. **Append-only ledger.** Never write code that updates or deletes documents in `/transactions`, `/reserve_vault`, or `/system_audit_logs`. Every financial change is a new document. Status changes on a transaction (e.g. to `REFUNDED` or `DISPUTED`) are the one exception called out in the spec — those update the status field on the existing document — but the underlying financial history must remain reconstructable and audit fields must never be rewritten.
2. **Atomic balance mutations.** Any code that touches `/merchant_balances` alongside `/transactions` or `/reserve_vault` must run inside a Firestore `runTransaction` block, re-reading balances inside the transaction to avoid race conditions. See the `processTransactionSettlement` reference implementation in `PAYMENT_FLOW.md`.
3. **Two-decimal float discipline.** All monetary values must be normalized with `.toFixed(2)` (then parsed back to a number before storage) at the point of calculation. Do not let raw floating-point arithmetic reach a Firestore write.
4. **Onboarding gate.** Merchants with `accountStatus` other than `ACTIVE` must be blocked from dashboard analytics and sandbox transaction simulation at the route/middleware level, not just hidden in the UI.
5. **Refund liquidity check.** A refund must never be allowed to execute if it exceeds the merchant's current `availableLiquid`. Validate this server-side inside the same atomic transaction that executes the refund, not just client-side.
6. **Chargeback clawback order.** Chargebacks pull from matured reserve capsules first. Only if reserve capacity is insufficient does the system draw from `availableLiquid`, and that balance is allowed to go negative to protect platform solvency — this is intentional, not a bug.
7. **Admin isolation.** Admin auth is a hardcoded credential check against environment variables, entirely separate from Firebase Authentication used for merchants. Do not merge these code paths or store admin credentials in Firestore.
8. **Absolute timestamps for maturity.** Reserve capsule `releaseDate` values are absolute UTC epoch milliseconds, never relative/day-based counters. The release scheduler polls every 60 seconds for `isMatured == false AND releaseDate <= now`.
9. **Risk scoring is additive and capped 0-100.** Score = industry weight + geographic discrepancy flag + velocity multiplier. Do not introduce multiplicative or unbounded scoring without updating `PAYMENT_FLOW.md` and the Risk Engine Configurator UI in tandem.

## Reference Tables (do not hardcode differently elsewhere)

**Risk tiers → reserve split → hold duration:**

| Tier | Score Range | Liquid % | Reserve % | Hold Duration |
| --- | --- | --- | --- | --- |
| Low | 0–30 | 95% | 5% | T+3 days |
| Medium | 31–65 | 85% | 15% | T+5 days |
| High | 66–100 | 70% | 30% | T+7 days |

**Industry vector weights:** GROCERY +0, ELECTRONICS +15, GAMING +25, CRYPTO +40.

**Geographic weight:** match +0, mismatch +20, high-risk region +15 (additive, so a mismatched high-risk region can add +35).

**Velocity weight:** +35 if a card is reused more than 3 times within a 60-second window.

## Codebase Map

- `src/` (repo root) — React/Vite frontend. Merchant and admin views live under `src/pages/merchant` and `src/pages/admin`; shared primitives live in `src/components/common`; `src/routes/navConfig.js` is the single source of truth for both the sidebar and the router — keep them in sync by editing that file, not by hand-adding routes elsewhere.
- `backend/` — Express API. Business logic (risk scoring, reserve engine, settlement, refunds/chargebacks, vault scheduling, admin analytics, AI copilot) lives in `backend/src/services` — implemented, with a matching `*.test.js` per service; see `backend/src/services/README.md` for the full inventory. Route handlers in `backend/src/routes` stay thin: validate input, call a service, return a response.
- `frontend/` — empty leftover directory from an earlier scaffold attempt. Not used by the running app; safe to remove once confirmed unreferenced.
- `firebase/firestore.rules` — the real, already-implemented security rules (stricter than the spec: denies all client writes, not just to ledger collections).
- See `PROJECT_STRUCTURE.md` for the complete tree and a full list of divergences from the spec.

## When Generating Code

- Follow the endpoint contracts in `API_DOCUMENTATION.md` exactly — path, method, and collection access.
- Follow the field names and types in `DATABASE_SCHEMA.md` exactly (`merchantId`, `transactionId`, `availableLiquid`, `lockedEscrow`, etc.) — do not rename fields for style.
- Do not introduce placeholder/stub logic for financial calculations. The spec explicitly requires complete, working implementations