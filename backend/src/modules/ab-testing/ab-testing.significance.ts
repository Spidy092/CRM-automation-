import { SignificanceResult } from './ab-testing.types';

/**
 * Two-proportion Z-test for comparing two variants.
 *
 * Tests H0: p1 = p2 (no difference) against H1: p1 != p2 (two-tailed).
 *
 * @param successA - Number of successes in variant A
 * @param totalA   - Total trials in variant A
 * @param successB - Number of successes in variant B
 * @param totalB   - Total trials in variant B
 * @returns Z-test result with p-value and significance flag
 */
export function twoProportionZTest(
  successA: number,
  totalA: number,
  successB: number,
  totalB: number,
): SignificanceResult {
  if (totalA === 0 || totalB === 0) {
    return {
      isSignificant: false,
      pValue: 1,
      zScore: 0,
      confidenceLevel: 0,
      winnerIndex: null,
    };
  }

  const pA = successA / totalA;
  const pB = successB / totalB;

  // Pooled proportion under H0
  const pPool = (successA + successB) / (totalA + totalB);

  // Standard error
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / totalA + 1 / totalB));

  if (se === 0) {
    return {
      isSignificant: pA !== pB,
      pValue: pA === pB ? 1 : 0,
      zScore: pA === pB ? 0 : pA > pB ? Infinity : -Infinity,
      confidenceLevel: pA === pB ? 0 : 100,
      winnerIndex: pA === pB ? null : pA > pB ? 0 : 1,
    };
  }

  // Z-statistic
  const z = (pA - pB) / se;

  // Two-tailed p-value using the standard normal CDF approximation
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));

  // Confidence level
  const confidenceLevel = (1 - pValue) * 100;

  return {
    isSignificant: pValue < 0.05, // 95% confidence threshold
    pValue: Math.round(pValue * 10000) / 10000,
    zScore: Math.round(z * 10000) / 10000,
    confidenceLevel: Math.round(confidenceLevel * 100) / 100,
    winnerIndex: pA > pB ? 0 : pB > pA ? 1 : null,
  };
}

/**
 * Chi-squared test for comparing multiple variants (2+).
 *
 * @param observed - Array of [success, failure] pairs for each variant
 * @returns Chi-squared test result
 */
export function chiSquaredTest(observed: Array<[number, number]>): {
  chiSquared: number;
  degreesOfFreedom: number;
  pValue: number;
  isSignificant: boolean;
} {
  const totalSuccess = observed.reduce((sum, [s]) => sum + s, 0);
  const totalFailure = observed.reduce((sum, [, f]) => sum + f, 0);
  const total = totalSuccess + totalFailure;

  if (total === 0) {
    return {
      chiSquared: 0,
      degreesOfFreedom: observed.length - 1,
      pValue: 1,
      isSignificant: false,
    };
  }

  const expectedSuccessRate = totalSuccess / total;
  let chiSquared = 0;

  for (const [success, failure] of observed) {
    const n = success + failure;
    const expectedSuccess = n * expectedSuccessRate;
    const expectedFailure = n * (1 - expectedSuccessRate);

    if (expectedSuccess > 0) {
      chiSquared += Math.pow(success - expectedSuccess, 2) / expectedSuccess;
    }
    if (expectedFailure > 0) {
      chiSquared += Math.pow(failure - expectedFailure, 2) / expectedFailure;
    }
  }

  const df = observed.length - 1;
  const pValue = 1 - chiSquaredCDF(chiSquared, df);

  return {
    chiSquared: Math.round(chiSquared * 10000) / 10000,
    degreesOfFreedom: df,
    pValue: Math.round(pValue * 10000) / 10000,
    isSignificant: pValue < 0.05,
  };
}

/**
 * Determine the winning variant from an array of metric values.
 * Returns the index of the highest-performing variant, or null if tied.
 */
export function findWinner(metrics: number[]): number | null {
  if (metrics.length === 0) return null;

  let maxIdx = 0;
  let maxVal = metrics[0];

  for (let i = 1; i < metrics.length; i++) {
    if (metrics[i] > maxVal) {
      maxVal = metrics[i];
      maxIdx = i;
    }
  }

  // Check for tie
  const tieCount = metrics.filter((m) => m === maxVal).length;
  if (tieCount > 1) return null;

  return maxIdx;
}

// ── Normal Distribution Helpers ───────────────────────────────────────────

/**
 * Approximation of the standard normal CDF using the error function.
 * Accurate to ~7 decimal places.
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x >= 0 ? 1 : -1;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp((-absX * absX) / 2);

  return 0.5 * (1 + sign * y);
}

/**
 * Chi-squared CDF approximation using the regularized gamma function.
 */
function chiSquaredCDF(x: number, k: number): number {
  if (x <= 0) return 0;
  return regularizedGammaP(k / 2, x / 2);
}

/**
 * Regularized incomplete gamma function P(a, x) via series expansion.
 */
function regularizedGammaP(a: number, x: number): number {
  if (x < a + 1) {
    return seriesRepresentation(a, x);
  }
  return 1 - seriesRepresentation(a, x); // Use 1 - Q(a,x) for large x
}

function seriesRepresentation(a: number, x: number): number {
  let sum = 1 / a;
  let term = 1 / a;

  for (let n = 1; n < 200; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < 1e-10) break;
  }

  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/**
 * Stirling's approximation for log(gamma(a)).
 */
function logGamma(a: number): number {
  if (a < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * a)) - logGamma(1 - a);
  }

  a -= 1;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  let x = c[0];
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (a + i);
  }

  const t = a + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (a + 0.5) * Math.log(t) - t + Math.log(x);
}
