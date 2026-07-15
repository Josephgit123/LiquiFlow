import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { computeAdminAnalytics } from './adminAnalyticsService.js';

// Merchant context shape is the EXACT compileAiContextPayload reference
// function from SYSTEM_ARCHITECTURE.md's AI Architecture section — field
// names (systemContextTelemetry, activeWithdrawableLiquidPool, etc.) are
// copied verbatim, not renamed for style, since this is spec'd ground
// truth the model prompt depends on.
async function compileMerchantContext(db, merchantId) {
  const balanceDoc = await db.collection('merchant_balances').doc(merchantId).get();
  const recentTxSnapshot = await db
    .collection('transactions')
    .where('merchantId', '==', merchantId)
    .orderBy('timestamp', 'desc')
    .limit(5)
    .get();

  const balanceData = balanceDoc.data() || {};
  const transactionSummary = [];
  recentTxSnapshot.forEach((doc) => {
    const data = doc.data();
    transactionSummary.push({
      id: data.transactionId,
      gross: data.amountGross,
      risk: data.riskScoreCalculated,
      status: data.status,
      time: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : null,
    });
  });

  return {
    systemContextTelemetry: {
      activeWithdrawableLiquidPool: balanceData.availableLiquid,
      activeEscrowReserveHoldings: balanceData.lockedEscrow,
      systemBaseCurrencyDenomination: balanceData.currency,
      recentOperationalProcessingHistory: transactionSummary,
    },
  };
}

// No spec exists for an admin-side copilot context (SYSTEM_ARCHITECTURE.md
// only defines the merchant one) — this mirrors its shape/naming
// convention for consistency, built from the already-real
// computeAdminAnalytics (adminAnalyticsService.js), not a second
// aggregation implementation.
async function compileAdminContext(db) {
  const analytics = await computeAdminAnalytics(db);
  return {
    platformContextTelemetry: {
      totalPlatformVolume: analytics.totalVolume,
      totalActiveTransactionCount: analytics.totalTransactions,
      totalOnboardedMerchantCount: analytics.totalMerchants,
      riskTierDistribution: analytics.riskScoreDistribution,
      totalReserveCurrentlyLocked: analytics.totalReserveLocked,
      merchantCountByIndustry: analytics.merchantsByIndustry,
    },
  };
}

/**
 * Compiles the grounding context for whichever caller type is asking —
 * a merchant's own balance/recent-transaction snapshot, or an admin's
 * platform-wide analytics snapshot. Exactly one of merchantId/isAdmin
 * branches is exercised per call; never both.
 */
export async function compileAiContextPayload(db, { merchantId, isAdmin }) {
  return isAdmin ? compileAdminContext(db) : compileMerchantContext(db, merchantId);
}

const SYSTEM_PREAMBLE = `You are the LiquiFlow AI Copilot, embedded in a post-authorization treasury
platform. You help the current user understand their own account state and
LiquiFlow's mechanics (risk scoring, the Liquid Pool / Reserve Vault split,
chargeback clawback order, settlement timing). A JSON context snapshot of
their current real data is provided below — ground every specific number
you cite in that snapshot, never invent figures. If the snapshot doesn't
contain what's being asked, say so plainly rather than guessing. Keep
answers concise and factual; this is a financial tool, not a general
chatbot.`;

let client = null;
function getClient() {
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY === 'REPLACE_WITH_REAL_GEMINI_KEY') {
    return null;
  }
  if (!client) {
    client = new GoogleGenerativeAI(env.GOOGLE_GENERATIVE_AI_API_KEY);
  }
  return client;
}

/**
 * `history` is the prior turns of this conversation ([{role: 'user'|'model', content}]),
 * kept entirely client-side and replayed each call — there is no server-side
 * conversation store (matches this app's stateless-API convention elsewhere).
 */
export async function generateCopilotReply(db, { message, history = [], merchantId, isAdmin }) {
  const genAI = getClient();
  if (!genAI) {
    const err = new Error(
      'AI Copilot is not configured — GOOGLE_GENERATIVE_AI_API_KEY in backend/.env is missing or still the placeholder value. Add a real key from https://aistudio.google.com/apikey.'
    );
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }

  const context = await compileAiContextPayload(db, { merchantId, isAdmin });

  const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });
  const chat = model.startChat({
    history: [
      { role: 'user', parts: [{ text: SYSTEM_PREAMBLE }] },
      { role: 'model', parts: [{ text: 'Understood — I will ground my answers in the provided context snapshot.' }] },
      { role: 'user', parts: [{ text: `Context snapshot:\n${JSON.stringify(context)}` }] },
      { role: 'model', parts: [{ text: 'Context received.' }] },
      ...history.map((turn) => ({ role: turn.role === 'model' ? 'model' : 'user', parts: [{ text: turn.content }] })),
    ],
  });

  const result = await chat.sendMessage(message);
  return { reply: result.response.text(), context };
}
