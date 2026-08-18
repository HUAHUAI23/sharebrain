export type RankedCandidate = {
  id: string;
  rank: number;
};

export function shouldUseAnn(candidateCount: number, threshold = 50_000): boolean {
  return candidateCount >= threshold;
}

export function feedbackMultiplier(upCount: number, downCount: number): number {
  const up = Math.max(0, upCount);
  const down = Math.max(0, downCount);
  const ratio = (up + 1) / (up + down + 2);
  return 0.8 + 0.4 * ratio;
}

export function reciprocalRankFuse(
  rankings: ReadonlyArray<ReadonlyArray<RankedCandidate>>,
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    for (const candidate of ranking) {
      scores.set(candidate.id, (scores.get(candidate.id) ?? 0) + 1 / (k + candidate.rank));
    }
  }
  return scores;
}
