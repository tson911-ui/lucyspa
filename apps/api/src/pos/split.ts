/**
 * Phase 6 P6-9 (T18): the ONE proportional-split primitive (design 6.4). Pure, integer VND in `bigint`, no floating point.
 *
 * A total `D` is split over ordered weights `w1..wn` (`W = sum wk`) by CUMULATIVE half-up rounding:
 * `Ck = floor((2 * D * (w1 + .. + wk) + W) / (2 * W))` and `share_k = Ck - C(k-1)`. So the parts always add up to `D` exactly
 * (`Cn = D`), the result is deterministic for a given order, and a zero weight gets zero. The same primitive allocates a shared
 * program between the sides, a side discount to its lines, a payment to the sides and the units of a refund (P6-13).
 *
 * The database has a SQL twin (`lucy_split_pro_rata`), parity-tested, which re-verifies every stored allocation.
 */

/** `Ck` of one prefix: `floor((2 * D * prefix + W) / (2 * W))`; `W > 0` and `0 <= prefix <= W`. */
export function cumulativeShare(total: bigint, prefixWeight: bigint, totalWeight: bigint): bigint {
  return (2n * total * prefixWeight + totalWeight) / (2n * totalWeight);
}

/**
 * Splits `total` over `weights` in order. An empty or all-zero weight list can only split 0 (nothing to be proportional to);
 * a negative total or weight is a programming error.
 */
export function splitProRata(total: bigint, weights: readonly bigint[]): bigint[] {
  if (total < 0n) throw new RangeError('splitProRata: the total cannot be negative');
  let sum = 0n;
  for (const weight of weights) {
    if (weight < 0n) throw new RangeError('splitProRata: a weight cannot be negative');
    sum += weight;
  }
  if (sum === 0n) {
    if (total !== 0n)
      throw new RangeError('splitProRata: nothing to split over (all weights are zero)');
    return weights.map(() => 0n);
  }
  const shares: bigint[] = [];
  let prefix = 0n;
  let previous = 0n;
  for (const weight of weights) {
    prefix += weight;
    const cumulative = cumulativeShare(total, prefix, sum);
    shares.push(cumulative - previous);
    previous = cumulative;
  }
  return shares;
}
