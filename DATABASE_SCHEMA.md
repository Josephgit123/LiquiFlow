# Database Schema

LiquiFlow runs on **Cloud Firestore** (NoSQL document store). Relationships are modeled through cross-referenced string keys rather than joins. The system enforces a strict **Append-Only Ledger Rule**: `/transactions`, `/reserve_vault`, and `/system_audit_logs` cannot be updated or deleted at the security-rule level — every financial event becomes a new document.

## Entity Relationship Overview

```
[ /users ]
 (uid [PK])
   |
   | 1:1 Authentication Target
   v
[ /merchants ]
 (merchantId [PK])
   |
   +-------------------+-------------------+
   | 1:1               | 1:N               | 1:N
   v                   v                   v
[ /merchant_balances ] [ /transactions ]   [ /reserve_vault ]
 (merchantId [FK])      (transactionId [PK])  (vaultId [PK])
                         (merchantId [FK])     (merchantId [FK])
                                               (associatedTransactionId [FK])
```

## `/users`

| Field | Type | Notes |
| --- | --- | --- |
| `uid` | STRING (PK) | Matches Firebase Auth identity. |
| `email` | STRING | User email. |
| `role` | STRING | `MERCHANT` or `ADMIN`. |
| `createdAt` | TIMESTAMP | Record creation date. |

## `/merchants`

| Field | Type | Notes |
| --- | --- | --- |
| `merchantId` | STRING (PK) | Unique merchant identifier. |
| `businessName` | STRING | Registered corporate name. |
| `entityType` | STRING | `LLC`, `C_CORP`, `SOLE_PROP`. |
| `industryVector` | STRING | `GROCERY`, `ELECTRONICS`, `CRYPTO`, `GAMING`. |
| `targetVolume` | STRING | Self-declared processing volume range. |
| `currentRiskTier` | STRING | `LOW`, `MEDIUM`, `HIGH`. |
| `accumulatedRiskPoints` | NUMBER | Running total from the scoring engine. |
| `accountStatus` | STRING | `PENDING`, `ACTIVE`, `SUSPENDED`. |

## `/merchant_balances`

| Field | Type | Notes |
| --- | --- | --- |
| `merchantId` | STRING (FK) | Points to parent merchant. |
| `availableLiquid` | NUMBER | Instantly withdrawable capital. Can go negative during a chargeback clawback if reserves are insufficient. |
| `lockedEscrow` | NUMBER | Assets currently held in reserve capsules. |
| `totalWithdrawn` | NUMBER | Historical cumulative withdrawals. |
| `currency` | STRING | `USD`, `EUR`, `INR`. |
| `lastUpdated` | TIMESTAMP | Last balance mutation. |

This is the one non-transaction/non-audit collection that is mutated in place — it represents current state, not history, and every mutation must happen atomically alongside the ledger write that caused it.

## `/transactions` (append-only)

| Field | Type | Notes |
| --- | --- | --- |
| `transactionId` | STRING (PK) | Unique entry ID. |
| `merchantId` | STRING (FK) | Owning merchant. |
| `amountGross` | NUMBER | Total captured amount. |
| `riskScoreCalculated` | NUMBER | 0–100 integer. |
| `splitLiquidAmount` | NUMBER | Portion routed to liquid pool. |
| `splitReserveAmount` | NUMBER | Portion routed to reserve vault. |
| `platformFeeDeduction` | NUMBER | Platform operating fee taken. |
| `status` | STRING | `CAPTURED`, `REFUNDED`, `DISPUTED`. |
| `receiptHash` | STRING | Cryptographic integrity hash. |
| `timestamp` | TIMESTAMP | Execution time. |

Status transitions (`CAPTURED` → `REFUNDED`/`DISPUTED`) are the sole permitted field update on this collection; all other fields are immutable once written.

## `/reserve_vault` (append-only)

| Field | Type | Notes |
| --- | --- | --- |
| `vaultId` | STRING (PK) | Unique capsule ID. |
| `merchantId` | STRING (FK) | Owning merchant. |
| `associatedTransactionId` | STRING (FK) | Source transaction. |
| `amountLocked` | NUMBER | Value held in escrow. |
| `releaseDate` | TIMESTAMP | Absolute UTC epoch-ms maturity boundary. |
| `isMatured` | BOOLEAN | Flips to `true` once released. |
| `createdAt` | TIMESTAMP | Capsule creation time. |

## `/tickets`

Fields inferred from workflow spec: `ticketId`, `merchantId`, `subject`, `priority`, `description`, `status` (`OPEN` / `PENDING` / `RESOLVED`), `messages[]` (thread), `createdAt`, `updatedAt`.

## `/notifications`

Fields inferred from workflow spec: `notificationId`, `targetRole`/`merchantId`, `message`, `category`, `read` (BOOLEAN, defaults `false`), `createdAt`. Auto-purged after 30 days.

## `/system_configuration`

Fields inferred from spec: global risk weight tables (industry/geo/velocity), default vault hold durations per tier, base platform fee percentage, maintenance-mode flag.

## `/system_audit_logs` (append-only)

Fields inferred from workflow spec: `logId`, `actorId`, `actionType`, `targetId`, `beforeState`, `afterState`, `timestamp`. Firestore security rules block all update/delete operations against this collection.

## Data Integrity Rules

1. **Append-only enforcement** is implemented at the Firestore security-rules layer (`firebase/firestore.rules` in this repo — not `docs/FIRESTORE_SECURITY.json`, which was the spec's proposed filename), not just in application code — this is a hard database-level guarantee, not a convention.
2. **Cross-tenant isolation:** security rules scope every read/write to the requesting merchant's own `merchantId`, except for admin-elevated sessions.
3. **Two-decimal normalization:** every NUMBER field representing currency m