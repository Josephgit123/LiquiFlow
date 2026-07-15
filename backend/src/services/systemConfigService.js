// GAP: DATABASE_SCHEMA.md describes /system_configuration only loosely
// ("fields inferred from spec: ... base platform fee percentage ...") —
// it does not define a document ID convention or exact field name. This
// assumes a single config doc at /system_configuration/global with a
// `platformFeePercent` field, and needs confirmation once that collection
// is formally specified.
const SYSTEM_CONFIG_DOC_ID = 'global';
const DEFAULT_PLATFORM_FEE_PERCENT = 2;

// The one place the "default 2%" fallback lives — callers (routes) must
// never hardcode this fee rate themselves.
export async function getPlatformFeePercent(db) {
  const snapshot = await db.collection('system_configuration').doc(SYSTEM_CONFIG_DOC_ID).get();
  if (!snapshot.exists || typeof snapshot.data().platformFeePercent !== 'number') {
    return DEFAULT_PLATFORM_FEE_PERCENT;
  }
  return snapshot.data().platformFeePercent;
}
