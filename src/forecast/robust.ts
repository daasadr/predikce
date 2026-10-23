// Robust statistics for IRLS: weighted median, MAD scale and Huber weights.

/** Consistency constant: 1.4826 · MAD estimates the standard deviation of normal data. */
export const MAD_TO_SD = 1.4826;
/** Huber tuning constant with 95 % efficiency for normal errors. */
export const HUBER_C = 1.345;

/** Weighted median; entries with non-positive weight are ignored. Returns 0 for no data. */
export function weightedMedian(values: number[], weights: number[]): number {
  const items = values
    .map((value, i) => ({ value, weight: weights[i] }))
    .filter((item) => item.weight > 0 && Number.isFinite(item.value))
    .sort((a, b) => a.value - b.value);
  const total = items.reduce((s, item) => s + item.weight, 0);
  if (items.length === 0 || total <= 0) return 0;
  let cumulative = 0;
  for (const item of items) {
    cumulative += item.weight;
    if (cumulative >= total / 2) return item.value;
  }
  return items[items.length - 1].value;
}

/** Robust standard deviation of residuals: 1.4826 · weighted median of |r| (residuals centred at 0). */
export function robustScale(residuals: number[], weights: number[]): number {
  return (
    MAD_TO_SD *
    weightedMedian(
      residuals.map((r) => Math.abs(r)),
      weights,
    )
  );
}

/** Huber weight for a standardised residual u. */
export function huberWeight(u: number, c = HUBER_C): number {
  const a = Math.abs(u);
  return a <= c ? 1 : c / a;
}
