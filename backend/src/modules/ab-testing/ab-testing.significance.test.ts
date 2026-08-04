import { twoProportionZTest, chiSquaredTest, findWinner } from './ab-testing.significance';

describe('twoProportionZTest', () => {
  it('returns a non-significant default result when either total is zero', () => {
    expect(twoProportionZTest(0, 0, 5, 10)).toEqual({
      isSignificant: false,
      pValue: 1,
      zScore: 0,
      confidenceLevel: 0,
      winnerIndex: null,
    });
    expect(twoProportionZTest(5, 10, 0, 0)).toEqual({
      isSignificant: false,
      pValue: 1,
      zScore: 0,
      confidenceLevel: 0,
      winnerIndex: null,
    });
  });

  it('is not significant when both variants have identical conversion rates', () => {
    const result = twoProportionZTest(50, 100, 50, 100);
    expect(result.isSignificant).toBe(false);
    expect(result.pValue).toBeCloseTo(1, 5);
    expect(result.zScore).toBe(0);
    expect(result.winnerIndex).toBeNull();
  });

  it('detects a clearly significant difference and picks the correct winner', () => {
    // A: 900/1000 = 90%, B: 100/1000 = 10% — hugely significant
    const result = twoProportionZTest(900, 1000, 100, 1000);
    expect(result.isSignificant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.winnerIndex).toBe(0);
    expect(result.zScore).toBeGreaterThan(0);
  });

  it('picks variant B as the winner when B outperforms A', () => {
    const result = twoProportionZTest(100, 1000, 900, 1000);
    expect(result.winnerIndex).toBe(1);
    expect(result.zScore).toBeLessThan(0);
  });

  it('is not significant for a small sample with a marginal difference', () => {
    const result = twoProportionZTest(5, 10, 4, 10);
    expect(result.isSignificant).toBe(false);
  });

  it('handles the zero-standard-error tie edge case explicitly (se === 0, pA === pB)', () => {
    // pooled proportion of 0 or 1 with both A and B equal drives se to 0
    const result = twoProportionZTest(0, 5, 0, 5);
    expect(result).toEqual({
      isSignificant: false,
      pValue: 1,
      zScore: 0,
      confidenceLevel: 0,
      winnerIndex: null,
    });
  });

});

describe('chiSquaredTest', () => {
  it('returns a non-significant default result when there are zero total observations', () => {
    const result = chiSquaredTest([
      [0, 0],
      [0, 0],
    ]);
    expect(result).toEqual({
      chiSquared: 0,
      degreesOfFreedom: 1,
      pValue: 1,
      isSignificant: false,
    });
  });

  it('is not significant when all variants have identical rates', () => {
    const result = chiSquaredTest([
      [50, 50],
      [50, 50],
      [50, 50],
    ]);
    expect(result.chiSquared).toBeCloseTo(0, 5);
    expect(result.isSignificant).toBe(false);
    expect(result.degreesOfFreedom).toBe(2);
  });

  it('detects a significant difference across multiple variants', () => {
    const result = chiSquaredTest([
      [900, 100],
      [500, 500],
      [100, 900],
    ]);
    expect(result.isSignificant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.chiSquared).toBeGreaterThan(0);
  });
});

describe('findWinner', () => {
  it('returns null for an empty array', () => {
    expect(findWinner([])).toBeNull();
  });

  it('returns the index of the single highest value', () => {
    expect(findWinner([1, 5, 3])).toBe(1);
  });

  it('returns the first index for a leading maximum', () => {
    expect(findWinner([10, 2, 3])).toBe(0);
  });

  it('returns null when there is a tie for the maximum', () => {
    expect(findWinner([4, 9, 9, 2])).toBeNull();
  });

  it('handles a single-element array', () => {
    expect(findWinner([42])).toBe(0);
  });
});
