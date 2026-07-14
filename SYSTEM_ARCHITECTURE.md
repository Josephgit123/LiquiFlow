# System Architecture

## High-Level Pattern

LiquiFlow is a decoupled client-server system. The presentation tier talks to the application tier exclusively through a stateless REST API plus real-time WebSocket subscriptions for live dashboard updates. All mutations route into Cloud Firestore, a distributed document store.

```
+-----------------------------------------------------------+
|                    PRESENTATION TIER                       |
|   +-----------------------+   +-----------------------+   |
|   |   Merchant Frontend    |   |    Admin Frontend      |   |
|   +-----------------------+   +-----------------------+   |
|             |                            |                 |
+-------------|----------------------------|-----------------+
        HTTPS / WSS                  HTTPS / WSS
+-------------v----------------------------v-----------------+
|                  APPLICATION SERVICE TIER                   |
|   +-----------------------------------------------------+  |
|   |               Express API Gateway                     |  |
|   +-----------------------------------------------------+  |
|         |                  |                  |             |
|   +-----v------+   +-------v------+   +-------v------+     |
|   | Risk Engine|   |Reserve Engine|   |  AI Copilot   |     |
|   +------------+   +--------------+   +---------------+    |
+---------|------------------|------------------|-------------+
          |                  |                  |
+---------v------------------v------------------v-------------+
|                     DATA PERSISTENCE                         |
|   +-----------------------------------------------------+   |
|   |               Cloud Firestore Store                   |   |
|   +-----------------------------------------------------+   |
+---------------------------------------------------------------+
```

## Frontend Architecture

- **Core framework:** React, bootstrapped with Vite for fast HMR and small bundles.
- **State management:** Local UI state via `useState`/`useReducer`; cross-cutting state (theme, auth/session, live dashboard data) via React Context providers.
- **Visual layer:** Tailwind CSS for layout/utility styling; Framer Motion for hardware-accelerated transitions, drawers, and page mounts.
- **Analytics rendering:** Recharts, bound to sanitized data from the API.

## Backend Architecture

- **Runtime:** Node.js (LTS), non-blocking event-driven I/O — well suited to high-frequency payment event handling.
- **Framework:** Express.js with isolated routing controllers, a unified error-interceptor middleware, and request validation stacks.
- **Data integration:** Firebase Admin SDK provides the server-side path into Firestore and Firebase Auth.

## Database Architecture

- **Engine:** Cloud Firestore, NoSQL document-graph model.
- **Topology:** Flat, isolated document collections. Relationships are modeled via explicit string foreign keys (`merchantId`, `transactionId`) rather than joins.
- **Mutation rule:** Append-Only Ledger Rule — historical balance, transaction, and audit documents cannot be updated or deleted; the security layer blocks it structurally. Adjustments are always new documents.

## Authentication Architecture

- **Merchants:** Firebase Authentication handles registration, token signing, session lifecycle, and federated OAuth (Google).
- **Admins:** A separate, simpler gate — credentials are checked against environment-configured constants rather than going through Firebase Auth. This is an intentional isolation choice (see Security Architecture below) but the literal values must never be hardcoded in source; they belong in environment variables (`ADMIN_USERNAME`, `ADMIN_PASSWORD`).

## AI Architecture

- **Model:** Google Generative AI SDK, `gemini-pro`.
- **Context injection pattern:** Before forwarding a user's prompt to the model, the backend compiles a snapshot of the merchant's current balances and recent transactions into a structured JSON object and prepends it to the prompt. This gives the AI Copilot grounded, contextual answers without the user needing to paste data manually. See the `compileAiContextPayload` reference function in `PAYMENT_FLOW.md`'s companion code or below.

```javascript
/**
 * Aggregates database state and packages it as context for the AI Copilot.
 */
async function compileAiContextPayload(db, merchantId) {
  const balanceDoc = await db.collection('merchant_balances').doc(merchantId).get();
  const recentTxSnapshot = await db.collection('transactions')
    .where('merchantId', '==', merchantId)
    .orderBy('timestamp', 'desc')
    .limit(5)
    .get();

  const balanceData = balanceDoc.data();
  const transactionSummary = [];
  recentTxSnapshot.forEach(doc => {
    const data = doc.data();
    transactionSummary.push({
      id: data.transactionId,
      gross: data.amountGross,
      risk: data.riskScoreCalculated,
      status: data.status,
      time: data.timestamp.toDate().toISOString()
    });
  });

  return {
    systemContextTelemetry: {
      activeWithdrawableLiquidPool: balanceData.availableLiquid,
      activeEscrowReserveHoldings: balanceData.lockedEscrow,
      systemBaseCurrencyDenomination: balanceData.currency,
      recentOperationalProcessingHistory: transactionSummary
    }
  };
}
```

## Payment Architecture

LiquiFlow is a post-auth engine, not a card processor. In place of a live gateway connection, a developer sandbox simulates inbound webhooks with cryptographically randomized values shaped like real payment-network payloads. See `PAYMENT_FLOW.md` for the full pipeline.

## Deployment Architecture

- **Client:** Vercel edge network.
- **Server:** Containerized deployment on Render or Heroku, with sticky sessions to support WebSocket connections.
- See `DEPLOYMENT_GUIDE.md` for full setup steps.

## Security Architecture

- **Transport:** HSTS enforced globally; TLS 1.3 validated on all connections.
- **CORS:** Restricted to validated client domains only.
- **JWT integrity:** Merchant tokens are signed with asymmetric cryptography; claims are verified on every request.
- **Firestore rules:** Block cross-tenant reads and any update/delete against `/transactions` and `/system_audit_logs`.
- **Input validation:** Express middleware sanitizes inbound payloads to neutralize SQL injection and XSS vectors (note: Firestore is not a SQL database, so the primary practical risk here is XSS/NoSQL-injection-style query manipulation and malformed payloads, not classic SQL injection — validation should be scoped accordingly).

## Core Architectural Decisions

- **NoSQL over relational:** chosen so merchant data models can evolve without migrations that would disrupt transaction tracking.
- **Strict append-only enforcement:** prevents balance-tampering; every change is a new, auditable entry.
- **Isolated admin access:** a hardcoded-environment-token approach was chosen specifically to keep global platform controls outside the same attack surface as tenant-facing database queries.

## Known Architecture Caveats

A few points in the original specification are worth flagging before implementation, since they affect correctness rather than just style:

1. **Admin credentials as literal strings.** The spec repeatedly writes the admin credentials as bare text (`Pandiabi` / `Pandiabi123`). These must be treated as illustrative placeholders only. In real code they belong exclusively in environment variables, never in source control, logs, or client-side bundles. A single shared admin login also means there's no per-admin accountability in the audit log (see item 4 in `CONTRIBUTING.md` review notes) — worth reconsidering if more than one admin operator is expected.
2. **"SQL injection" reference.** The spec's security section mentions SQL injection protection, but the database is Firestore (NoSQL). The real equivalent risks are NoSQL query injection and XSS; documentation and validation logic should be worded and scoped accordingly.
3. **Negative `availableLiquid` by design.** The spec explicitly allows `availableLiquid` to go negative during a chargeback clawback that exceeds reserve capacity. This is a deliberate business rule (protect the platform first), but it means downstream code must handle negative balances gracefully everywhere they're displayed or used in further calculations — it is not an edge case to guard against, it's expected behavior.
4. **Single-tenant admin model.** All admin actions currently authenticate against one shared credential pair rather than individual admin identities, which limits the audit trail's ability to attribute actions to a specific person. This is flagged as an area for future hardening in `CONTRIBUTING.md`.
