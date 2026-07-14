import { updateRiskConfig, validateRiskConfigBody } from './riskConfigService.js';
import { computeRiskScore } from './riskEngine.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

function validConfigParams(overrides = {}) {
  return {
    industryWeights: { GROCERY: 0, ELECTRONICS: 15, GAMING: 25, CRYPTO: 40 },
    geoWeights: { mismatch: 20, highRiskRegion: 15 },
    velocityWeight: 35,
    tierBoundaries: { lowMax: 30, mediumMax: 65 },
    actorId: 'ADMIN',
    ...overrides,
  };
}

describe('updateRiskConfig — persistence', () => {
  test('writes the config to /system_configuration/riskWeights and logs the change', async () => {
    const db = new FakeFirestore();

    const result = await updateRiskConfig(db, validConfigParams({ industryWeights: { GROCERY: 0, ELECTRONICS: 15, GAMING: 50, CRYPTO: 40 } }));

    expect(result.industryWeights.GAMING).toBe(50);

    const snap = await db.collection('system_configuration').doc('riskWeights').get();
    expect(snap.exists).toBe(true);
    expect(snap.data().industryWeights.GAMING).toBe(50);

    const logsSnap = await db.collection('system_audit_logs').get();
    expect(logsSnap.docs).toHaveLength(1);
    expect(logsSnap.docs[0].data().actionType).toBe('ADMIN_RISK_CONFIG_UPDATE');
  });
});

describe('updateRiskConfig — CRITICAL: persisting config has ZERO effect on live scoring', () => {
  test('riskEngine.computeRiskScore for GAMING is unchanged after writing a drastically different GAMING weight', async () => {
    const db = new FakeFirestore();

    const scoreBefore = computeRiskScore({
      industryVector: 'GAMING',
      cardIssuerCountry: 'US',
      ipCountry: 'US',
      isHighRiskRegion: false,
      velocityFlag: false,
    });
    expect(scoreBefore).toBe(25); // riskEngine.js's hardcoded GAMING weight

    // Persist a config that claims GAMING should now score 99.
    await updateRiskConfig(db, validConfigParams({ industryWeights: { GROCERY: 0, ELECTRONICS: 15, GAMING: 99, CRYPTO: 40 } }));

    const scoreAfter = computeRiskScore({
      industryVector: 'GAMING',
      cardIssuerCountry: 'US',
      ipCountry: 'US',
      isHighRiskRegion: false,
      velocityFlag: false,
    });

    // Proves the flagged limitation is real, not just a comment:
    // riskEngine.js is untouched and still uses its own hardcoded weight.
    expect(scoreAfter).toBe(25);
    expect(scoreAfter).toBe(scoreBefore);
  });
});

describe('validateRiskConfigBody — rejects nonsensical weights', () => {
  test('rejects a negative weight', () => {
    const errors = validateRiskConfigBody({
      industryWeights: { GROCERY: -5, ELECTRONICS: 15, GAMING: 25, CRYPTO: 40 },
      geoWeights: { mismatch: 20, highRiskRegion: 15 },
      velocityWeight: 35,
      tierBoundaries: { lowMax: 30, mediumMax: 65 },
    });
    expect(errors.some((e) => e.field === 'industryWeights.GROCERY')).toBe(true);
  });

  test('rejects a single factor exceeding 100', () => {
    const errors = validateRiskConfigBody({
      industryWeights: { GROCERY: 0, ELECTRONICS: 15, GAMING: 25, CRYPTO: 150 },
      geoWeights: { mismatch: 20, highRiskRegion: 15 },
      velocityWeight: 35,
      tierBoundaries: { lowMax: 30, mediumMax: 65 },
    });
    expect(errors.some((e) => e.field === 'industryWeights.CRYPTO')).toBe(true);
  });

  test('accepts a well-formed config', () => {
    const errors = validateRiskConfigBody(validConfigParams());
    expect(errors).toEqual([]);
  });
});
