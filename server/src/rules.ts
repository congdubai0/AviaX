export type FlightAward = {
  awarded: boolean;
  points: number;
  bonusPoints: number;
};

export function decideFlightAward(
  alreadyCompletedPoints: number | null,
  points: number,
  consecutiveDays: number,
  streakDays: number,
  streakBonusPoints: number,
): FlightAward {
  if (alreadyCompletedPoints !== null) {
    return { awarded: false, points: alreadyCompletedPoints, bonusPoints: 0 };
  }
  return {
    awarded: true,
    points,
    bonusPoints: consecutiveDays >= streakDays && consecutiveDays % streakDays === 0
      ? streakBonusPoints
      : 0,
  };
}

export function canQualifyReferral(
  completedMissionCount: number,
  status: "pending" | "qualified" | null,
  qualifiedToday: number,
  dailyLimit: number,
): boolean {
  return completedMissionCount >= 2 && status === "pending" && qualifiedToday < dailyLimit;
}

export function secondsRemainingForMinimum(
  startedAt: Date,
  now: Date,
  minimumSeconds: number,
): number {
  return Math.max(0, Math.ceil(minimumSeconds - (now.getTime() - startedAt.getTime()) / 1000));
}

export type RankCandidate = {
  userId: string;
  points: number;
  reachedAt: Date | null;
  rank?: number;
};

export function rankCandidates<T extends RankCandidate>(candidates: T[]): Array<T & { rank: number }> {
  return [...candidates]
    .sort((a, b) =>
      b.points - a.points
      || (a.reachedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.reachedAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
      || a.userId.localeCompare(b.userId),
    )
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
