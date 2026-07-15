import {
  computeRiskScore,
  getTierForScore,
  resolveEffectiveTier,
  checkVelocity,
} from './riskEngine.js';

const baseInput = {
  industryVector: 'GROCERY',
  cardIssuerCountry: 'US',
  ipCountry: 'US',
  isHighRiskRegion: false,
  velocityFlag: false,
};

describe('computeRiskScore — industry weights', () => {
  test('GROCERY contributes +0', () => {
    expect(computeRiskScore({ ...baseInput, industryVector: 'GROCERY' })).toBe(0);
  });

  test('ELECTRONICS contributes +15', () => {
    expect(computeRiskScore({ ...baseInput, industryVector: 'ELECTRONICS' })).toBe(15);
  });

  test('GAMING contributes +25', () => {
    expect(computeRiskScore({ ...baseInput, industryVector: 'GAMING' })).toBe(25);
  });

  test('CRYPTO contributes +40', () => {
    expect(computeRiskScore({ ...baseInput, industryVector: 'CRYPTO' })).toBe(40);
  });

  test('unrecognized industryVector throws rather than defaulting to 0', () => {
    expect(() =>
      computeRiskScore({ ...baseInput, industryVector: 'FASHION' })
    ).toThrow(/unrecognized industryVector/);
  });

  test('missing industryVector throws', () => {
    expect(() =>
      computeRiskScore({ ...baseInput, industryVector: undefined })
    ).toThrow(/unrecognized industryVector/);
  });
});

describe('computeRiskScore — geographic weight', () => {
  test('matching card issuer / IP country contributes +0', () => {
    const score = computeRiskScore({
      ...baseInput,
      cardIssuerCountry: 'US',
      ipCountry: 'US',
      isHighRiskRegion: false,
    });
    expect(score).toBe(0);
  });

  test('mismatch alone contributes +20', () => {
    const score = computeRiskScore({
      ...baseInput,
      cardIssuerCountry: 'US',
      ipCountry: 'FR',
      isHighRiskRegion: false,
    });
    expect(score).toBe(20);
  });

  test('mismatch + high-risk region STACK to +35 (20 + 15), not either/or', () => {
    const score = computeRiskScore({
      ...baseInput,
      cardIssuerCountry: 'US',
      ipCountry: 'FR',
      isHighRiskRegion: true,
    });
    expect(score).toBe(35);
  });

  test('high-risk region alone (no mismatch) contributes +15', () => {
    const score = computeRiskScore({
      ...baseInput,
      cardIssuerCountry: 'US',
      ipCountry: 'US',
      isHighRiskRegion: true,
    });
    expect(score).toBe(15);
  });
});

describe('computeRiskScore — velocity weight', () => {
  test('velocityFlag false contributes +0', () => {
    expect(computeRiskScore({ ...baseInput, velocityFlag: false })).toBe(0);
  });

  test('velocityFlag true contributes +35', () => {
    expect(computeRiskScore({ ...baseInput, velocityFlag: true })).toBe(35);
  });
});

describe('computeRiskScore — clamping', () => {
  test('worst case (CRYPTO + mismatch + high-risk + velocity = 110 raw) clamps to exactly 100', () => {
    const score = computeRiskScore({
      industryVector: 'CRYPTO',
      cardIssuerCountry: 'US',
      ipCountry: 'FR',
      isHighRiskRegion: true,
      velocityFlag: true,
    });
    expect(score).toBe(100);
  });
});

describe('getTierForScore — boundaries', () => {
  test('score 30 is LOW (top of LOW range)', () => {
    expect(getTierForScore(30).tier).toBe('LOW');
  });

  test('score 31 is MEDIUM (bottom of MEDIUM range)', () => {
    expect(getTierForScore(31).tier).toBe('MEDIUM');
  });

  test('score 65 is MEDIUM (top of MEDIUM range)', () => {
    expect(getTierForScore(65).tier).toBe('MEDIUM');
  });

  test('score 66 is HIGH (bottom of HIGH range)', () => {
    expect(getTierForScore(66).tier).toBe('HIGH');
  });

  test('LOW tier returns the correct split/hold-duration table row', () => {
    expect(getTierForScore(0)).toEqual({
      tier: 'LOW',
      liquidPercent: 95,
      reservePercent: 5,
      holdDurationMs: 259200000,
    });
  });

  test('MEDIUM tier returns the correct split/hold-duration table row', () => {
    expect(getTierForScore(50)).toEqual({
      tier: 'MEDIUM',
      liquidPercent: 85,
      reservePercent: 15,
      holdDurationMs: 432000000,
    });
  });

  test('HIGH tier returns the correct split/hold-duration table row', () => {
    expect(getTierForScore(100)).toEqual({
      tier: 'HIGH',
      liquidPercent: 70,
      reservePercent: 30,
      holdDurationMs: 604800000,
    });
  });

  test('throws for score below 0', () => {
    expect(() => getTierForScore(-1)).toThrow(/must be a finite number in \[0, 100\]/);
  });

  test('throws for score above 100', () => {
    expect(() => getTierForScore(101)).toThrow(/must be a finite number in \[0, 100\]/);
  });
});

describe('resolveEffectiveTier', () => {
  test('no override: effective tier equals computed tier, wasOverridden is false', () => {
    const result = resolveEffectiveTier(20, null);
    expect(result).toEqual({
      effectiveTier: 'LOW',
      liquidPercent: 95,
      reservePercent: 5,
      holdDurationMs: 259200000,
      computedScore: 20,
      computedTier: 'LOW',
      wasOverridden: false,
    });
  });

  test('undefined override behaves the same as null', () => {
    const result = resolveEffectiveTier(20, undefined);
    expect(result.wasOverridden).toBe(false);
    expect(result.effectiveTier).toBe('LOW');
  });

  test('override present: effective tier is the override, computedScore/computedTier still correct', () => {
    const result = resolveEffectiveTier(20, 'HIGH');
    expect(result).toEqual({
      effectiveTier: 'HIGH',
      liquidPercent: 70,
      reservePercent: 30,
      holdDurationMs: 604800000,
      computedScore: 20,
      computedTier: 'LOW',
      wasOverridden: true,
    });
  });

  test('unrecognized override tier throws', () => {
    expect(() => resolveEffectiveTier(20, 'EXTREME')).toThrow(/unrecognized merchantOverrideTier/);
  });
});

describe('checkVelocity', () => {
  test('cardFingerprint must be provided', async () => {
    await expect(checkVelocity('', async () => 5)).rejects.toThrow(/cardFingerprint/);
  });

  test('recentTransactionLookupFn must be a function', async () => {
    await expect(checkVelocity('fp_abc123', null)).rejects.toThrow(/recentTransactionLookupFn/);
  });

  test('count of 3 (not strictly greater than 3) returns false', async () => {
    const mockLookup = jest.fn().mockResolvedValue(3);
    const result = await checkVelocity('fp_abc123', mockLookup);
    expect(result).toBe(false);
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  test('count of 4 (strictly greater than 3) returns true', async () => {
    const mockLookup = jest.fn().mockResolvedValue(4);
    const result = await checkVelocity('fp_abc123', mockLookup);
    expect(result).toBe(true);
  });

  test('passes a 60-second window ending at "now" to the lookup function', async () => {
    const mockLookup = jest.fn().mockResolvedValue(0);
    const before = Date.now();
    await checkVelocity('fp_abc123', mockLookup);
    const after = Date.now();

    const [fingerprint, windowStartMs, windowEndMs] = mockLookup.mock.calls[0];
    expect(fingerprint).toBe('fp_abc123');
    expect(windowEndMs - windowStartMs).toBe(60000);
    expect(windowEndMs).toBeGreaterThanOrEqual(before);
    expect(windowEndMs).toBeLessThanOrEqual(after);
  });
});
