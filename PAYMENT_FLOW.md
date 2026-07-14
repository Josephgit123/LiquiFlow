# Payment Flow

## Overview

LiquiFlow is a **post-authorization** engine: it does not process cards. In the current build, a developer sandbox simulates inbound webhooks using randomized values matching real payment-network payload shapes. Every captured transaction is scored, split, and ledgered through the same pipeline described below.

```
[Customer Checkout] -> [API Gateway Intercept] -> [Validate Merchant Profile]
        |
        v
[Split Escrow Allocation] <-- [Run Risk Matrix Engine] <-- [Check Velocity Matrix]
        |
        v
[Write Append-Only Transaction Ledger Document]
        |
        v
[Simulate Cryptographic Verification Receipt Ingestion]
        |
        v
[Increment Liquid Pool Matrix] -> [Update Display Metrics Panels]
```

## Dynamic Risk Engine

Every transaction gets an integer risk score from 0 (fully secure) to 100 (high risk).

**Score = Industry Weight + Geographic Discrepancy Flag + Velocity Multiplier**

| Factor | Condition | Points |
| --- | --- | --- |
| Industry | `GROCERY` | +0 |
| Industry | `ELECTRONICS` | +15 |
| Industry | `GAMING` | +25 |
| Industry | `CRYPTO` | +40 |
| Geography | Card-issuer country matches IP country | +0 |
| Geography | Mismatch | +20 |
| Geography | High-risk region | +15 (stacks with mismatch) |
| Velocity | Same card seen >3 times in a 60-second window | +35 |

**Risk tiers and resulting split:**

| Tier | Score | Liquid % | Reserve % | Hold Duration |
| --- | --- | --- | --- | --- |
| Low | 0–30 | 95% | 5% | T+3 days (259,200s) |
| Medium | 31–65 | 85% | 15% | T+5 days (432,000s) |
| High | 66–100 | 70% | 30% | T+7 days (604,800s) |

Admins can manually override a merchant's tier from the Risk Engine Configurator, forcing all future transactions for that tenant into the chosen split regardless of computed score.

**Split formulas:**

```
Split Liquid Amount  = Gross Amount × ((100 − Y) / 100) − Platform Operating Fees
Split Reserve Amount = Gross Amount × (Y / 100)
```

## Rolling Reserve Engine

**Creation:** When a transaction settles, the reserve portion is written as a new document in `/reserve_vault` with `isMatured: false` and an absolute `releaseDate` (current time + tier hold duration, in epoch milliseconds).

**Release:** A scheduler runs every 60 seconds, querying for capsules where `isMatured == false AND releaseDate <= now`. For each match, an atomic transaction:
1. Sets `isMatured` to `true`.
2. Reads the merchant's balance document.
3. Moves the capsule value from `lockedEscrow` to `availableLiquid`.

Timestamps use absolute UTC epoch milliseconds (not relative/daily clocks) to avoid daylight-saving or timezone drift.

## Reference Implementation: Transaction Settlement

```javascript
/**
 * Atomic transaction sequence processing the operational settlement distribution split logic.
 * Enforces the Append-Only Ledger Rule by generating fresh transaction documents.
 */
async function processTransactionSettlement(db, transactionPayload) {
  const balanceRef = db.collection('merchant_balances').doc(transactionPayload.merchantId);
  const txRef = db.collection('transactions').doc();
  const vaultRef = db.collection('reserve_vault').doc();

  return db.runTransaction(async (transaction) => {
    const balanceDoc = await transaction.get(balanceRef);
    if (!balanceDoc.exists) {
      throw new Error("Target merchant balance profile not initialized.");
    }

    const currentBalances = balanceDoc.data();
    const gross = transactionPayload.amountGross;
    const holdbackRate = transactionPayload.computedReserveRate; // e.g. 0.15 for 15%
    const feeRate = 0.02; // Standard 2% operational platform fee

    const feeDeduction = parseFloat((gross * feeRate).toFixed(2));
    const reserveAllocation = parseFloat((gross * holdbackRate).toFixed(2));
    const liquidAllocation = parseFloat((gross - reserveAllocation - feeDeduction).toFixed(2));

    transaction.update(balanceRef, {
      availableLiquid: parseFloat((currentBalances.availableLiquid + liquidAllocation).toFixed(2)),
      lockedEscrow: parseFloat((currentBalances.lockedEscrow + reserveAllocation).toFixed(2)),
      lastUpdated: new Date()
    });

    transaction.set(txRef, {
      transactionId: txRef.id,
      merchantId: transactionPayload.merchantId,
      amountGross: gross,
      riskScoreCalculated: transactionPayload.riskScore,
      splitLiquidAmount: liquidAllocation,
      splitReserveAmount: reserveAllocation,
      platformFeeDeduction: feeDeduction,
      status: "CAPTURED",
      receiptHash: "tx_hash_" + Math.random().toString(36).substring(2, 15),
      timestamp: new Date()
    });

    transaction.set(vaultRef, {
      vaultId: vaultRef.id,
      merchantId: transactionPayload.merchantId,
      associatedTransactionId: txRef.id,
      amountLocked: reserveAllocation,
      releaseDate: new Date(Date.now() + transactionPayload.holdDurationMs),
      isMatured: false,
      createdAt: new Date()
    });

    return { txId: txRef.id, liquid: liquidAllocation, escrow: reserveAllocation };
  });
}
```

## Refund Workflow

1. Merchant opens the Refund Hub and triggers a refund on a target transaction.
2. System checks `availableLiquid` on `/merchant_balances` can cover the full refund.
3. If it passes, an atomic transaction re-verifies balances (to avoid race conditions), writes a new `/transactions` row with status `REFUNDED`, and subtracts the amount from `availableLiquid`.
4. UI and dashboard metrics update to reflect the new state.

**Rule:** a refund can never be executed if it exceeds `availableLiquid` — this must be enforced server-side, not just in the UI.

## Chargeback Workflow

1. Admin logs an incoming dispute via the Chargeback Simulator, submitting a target transaction ID.
2. System locates the transaction and flips its status to `DISPUTED`.
3. System looks up the merchant's matured reserve capsules to cover the dispute amount.
4. Atomic clawback: deducts the dispute value from reserve capsules first; if mature capsules can't cover the full amount, draws the remainder from `availableLiquid` — allowing that balance to go negative if necessary to protect the platform.
5. The clawback action is logged to `/system_audit_logs`, recording exactly which assets moved.

## Support Ticket Workflow

1. Merchant creates a ticket (subject, priority, description) → written to `/tickets` with status `OPEN`.
2. Admin panel triage queue updates via event hook.
3. Admin and merchant exchange responses; status moves between `PENDING` and `RESOLVED`. Both sides see updates in real time via live listeners.

## Notification Workflow

1. Internal engines fire events on key state changes (vault maturity, high-risk flag, etc.).
2. A new `/notifications` document is written with `read: false`.
3. Real-time listeners push the alert to the relevant dashboard.
4. Viewing the panel flips `read` to `true`, clearing the badge.

## Audit Log Workflow

1. Administrative actions (risk config changes, account overrides) are intercepted.
2. A structured log object captures actor identity, timestamp, action type, target ID, and before/after state.
3. The object is written to the append-only `/system_audit_logs` collection; Firestore security rules block any modification or deletion.

## Complete Lifecycle (End to End)

```
[Merchant Sign-up] -> [Wizard Risk Extraction] -> [Account Status Activated]
        |
        v
[Liquid Assets Increment] <-- [Matrix Split Routine] <-- [Inbound Sandbox Purchase]
        |
        v
[Escrow Capsule Creation Lifecycle]
        |
        v
[Automatic Chronometer Scan Validation]
        |
        v
[Capsule Expiration Reached] -> [Balance Payout Cleared] -> [Corporate Bank Extraction]
```
