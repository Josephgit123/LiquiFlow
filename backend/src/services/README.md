# services/

Business logic lives here, not in route handlers. Route handlers in
`backend/src/routes` should stay thin: validate input, call a service,
return a response.

This directory moved past the empty project-skeleton phase — the
services below are implemented, each with a matching `*.test.js`:

**Risk & onboarding**
- `riskEngine.js` — 100-Point Risk Scoring Matrix (industry weight +
  geographic discrepancy + velocity multiplier). See `PAYMENT_FLOW.md`
  and CLAUDE.md invariant #9.
- `riskConfigService.js` — admin-side risk weight configuration (Risk
  Engine Configurator).
- `onboardingService.js` — one-shot merchant onboarding (rejects a
  second attempt with 409); backs `OnboardingWizard.jsx`.
- `velocityLogService.js` — card-reuse tracking for the risk engine's
  velocity multiplier (60-second window, CLAUDE.md's velocity weight
  table).

**Settlement & transactions**
- `settlementService.js` — the atomic liquid/reserve split on capture
  (`processTransactionSettlement` reference in `PAYMENT_FLOW.md`), refund
  liquidity checks (invariant #5), and chargeback clawback ordering
  (invariant #6). All balance mutations here run inside a Firestore
  `runTransaction` per CLAUDE.md invariant #2.
- `settlementBatchService.js` — admin-side settlement batch views.
- `transactionQueryService.js` — filtered/paginated transaction history
  reads.

**Reserve vault**
- `vaultService.js` — reserve capsule creation and matured-capsule
  release. See CLAUDE.md invariant #8 (absolute UTC epoch timestamps).
- `vaultQueryService.js` — capsule reads for the merchant Maturity Vault
  view.
- `vaultScheduler.js` / `schedulerLock.js` — the 60-second maturity sweep
  and its single-instance lock (see `DEPLOYMENT_GUIDE.md` on scaling to
  multiple server instances).

**Refunds & chargebacks**
- `refundService.js` — refund execution, gated by the same-transaction
  liquidity check (invariant #5).
- `refundQueueService.js` — admin-side refund queue.
- `chargebackService.js` — clawback ordering: matured reserve first, then
  `availableLiquid` (allowed to go negative — invariant #6).

**Support, notifications & admin**
- `ticketService.js` — support ticket + threaded message reads/writes.
- `notificationService.js` — per-merchant and role-wide broadcast
  notifications.
- `merchantAdminService.js` — admin merchant directory/management.
- `adminAnalyticsService.js` — platform-wide analytics aggregation (also
  the source for the AI Copilot's admin context, see below).
- `platformSettingsService.js` / `systemConfigService.js` — platform-wide
  configuration.
- `auditLogService.js` — `system_audit_logs` reads (append-only, see
  invariant #1).

**AI**
- `aiCopilotService.js` — compiles a per-caller context snapshot
  (merchant's own balance/recent transactions, or an admin's platform
  analytics) and calls the Gemini API. Returns a clear "not configured"
  error if `GOOGLE_GENERATIVE_AI_API_KEY` is unset rather than throwing.
