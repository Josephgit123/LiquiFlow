# services/

Business logic lives here, not in route handlers. Route handlers in
`backend/src/routes` should stay thin: validate input, call a service,
return a response.

This directory is intentionally empty as of the project-skeleton phase.
Later phases will add:

- `riskEngine.js` — 100-Point Risk Scoring Matrix (industry weight +
  geographic discrepancy + velocity multiplier). See `PAYMENT_FLOW.md`
  and CLAUDE.md invariant #9.
- `vaultService.js` — reserve capsule creation, the 60-second maturity
  sweep, and matured-capsule release. See CLAUDE.md invariant #8.
- `settlementService.js` — the atomic liquid/reserve split on capture
  (`processTransactionSettlement` reference in `PAYMENT_FLOW.md`), refund
  liquidity checks (invariant #5), and chargeback clawback ordering
  (invariant #6). All balance mutations here must run inside a Firestore
  `runTransaction` per CLAUDE.md invariant #2.
