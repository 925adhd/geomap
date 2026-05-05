// Visibility score = "% of customer attention captured vs. a competitor
// that ranks #1 at every point". Weights are CTR estimates for the
// local pack: rank 1 dominates, ranks 2-3 split most of the rest, and
// anything 11+ gets effectively zero clicks. Used by both the public
// report and the admin sidebar so the two numbers can never disagree.
const CTR_WEIGHT: Record<number, number> = {
  1: 100,
  2: 55,
  3: 35,
  4: 18,
  5: 12,
  6: 8,
  7: 5,
  8: 3,
  9: 2,
  10: 1,
};

export function ctrWeight(rank: number | null): number {
  if (rank === null) return 0;
  return CTR_WEIGHT[rank] ?? 0;
}

export function computeVisibilityScore(
  points: { rank: number | null; error?: string }[]
): number {
  const valid = points.filter((p) => !p.error);
  if (valid.length === 0) return 0;
  return Math.round(
    valid.reduce((s, p) => s + ctrWeight(p.rank), 0) / valid.length
  );
}
