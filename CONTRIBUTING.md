# Contributing to LiquiFlow

Thanks for working on LiquiFlow. This document covers the conventions and guardrails specific to a financial ledger system — read it alongside `CLAUDE.md`, which covers the non-negotiable invariants for any code touching money.

## Before You Start

- Read `SYSTEM_ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, and `PAYMENT_FLOW.md` for any change that touches balances, transactions, or the reserve vault. Small-looking changes to the split math or scheduler logic have wide financial consequences.
- Check `CLAUDE.md`'s invariant list before proposing a change that would update or delete a document in `/transactions`, `/reserve_vault`, or `/system_audit_logs` — these collections are append-only by design, not by oversight.

## Branching & Commits

- Branch naming: `feature/<short-description>`, `fix/<short-description>`, `docs/<short-description>`.
- Commit messages: imperative mood, concise subject line, body explaining *why* for anything non-obvious (especially risk-scoring or settlement logic changes).
- Keep PRs scoped to one concern — don't mix a UI change with a settlement-engine change.

## Code Conventions

### Frontend (`client/`)
- Functional components with hooks only; no class components.
- Local UI state via `useState`/`useReducer`; anything shared across routes goes through a Context provider in `src/context/`, not prop drilling.
- Styling is Tailwind utility classes only — no separate CSS files per component.
- All currency values displayed in the UI must be formatted to exactly 2 decimal places.

### Backend (`server/`)
- Controllers stay thin: validate input, call a service, return a response. Business logic belongs in `src/services/`.
- Any write that touches `/merchant_balances` alongside a ledger collection must be wrapped in `db.runTransaction(...)`, re-reading balances inside the callback.
- Every monetary calculation must normalize with `.toFixed(2)` before it reaches a Firestore write or an API response.
- New endpoints must be documented in `API_DOCUMENTATION.md` in the same PR — endpoint contracts should never drift from the reference doc.

## Testing Expectations

- Any change to the Risk Engine (industry/geo/velocity weights or tier boundaries) needs a test asserting the score-to-tier mapping still matches the table in `PAYMENT_FLOW.md`.
- Any change to the Reserve Engine's maturity sweep needs a test that simulates a capsule crossing its `releaseDate` and confirms the atomic balance move (`lockedEscrow` → `availableLiquid`) is exactly right, including float rounding.
- Refund and chargeback logic changes need a test for the boundary condition (refund exactly equal to `availableLiquid`; chargeback exceeding matured reserve capacity).

## Security-Sensitive Areas — Extra Review Required

- Anything in `src/middleware/` related to JWT verification or the admin credential gate.
- Firestore security rule changes (`docs/FIRESTORE_SECURITY.json`) — a mistake here can break tenant isolation or the append-only guarantee.
- Any code path that could allow a client-supplied value to influence a risk score, balance, or ledger write without server-side revalidation.

Never commit literal credentials (including the admin username/password) — they must always be read from environment variables. If you find a hardcoded credential in the codebase, treat it as a bug and open a fix, don't just work around it.

## Pull Request Checklist

- [ ] No direct update/delete calls against `/transactions`, `/reserve_vault`, or `/system_audit_logs`.
- [ ] Any balance-affecting write is wrapped in an atomic transaction.
- [ ] New/changed endpoints reflected in `API_DOCUMENTATION.md`.
- [ ] New/changed fields reflected in `DATABASE_SCHEMA.md`.
- [ ] No hardcoded credentials or API keys.
- [ ] Currency values normalized to 2 decimals everywhere they're calculated or displayed.

## Reporting Issues

Open an issue describing the observed vs. expected behavior. For anything involving incorrect balance splits, missed reserve releases, or audit log gaps, include the relevant `transactionId`/`vaultId` and timestamps — since the ledger is append-only, the full history needed to diagnose the issue is always recoverable from Firestore.
