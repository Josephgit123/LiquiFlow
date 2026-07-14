// GAP: this list has no defined source anywhere in the current
// documentation set (CLAUDE.md / PAYMENT_FLOW.md / DATABASE_SCHEMA.md all
// reference a "high-risk region" flag but none define which regions).
// These four are illustrative placeholders only, not a vetted compliance
// or sanctions list — replace with a real source (e.g. a card-network
// high-risk-country list, an internal compliance list) before production use.
export const HIGH_RISK_REGIONS = ['NG', 'RU', 'KP', 'IR'];

export function isHighRiskRegion(cardIssuerCountry, ipCountry) {
  return HIGH_RISK_REGIONS.includes(cardIssuerCountry) || HIGH_RISK_REGIONS.includes(ipCountry);
}
