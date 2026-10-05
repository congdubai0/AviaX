import {
  MissionStatus,
  Prisma,
  ReferralStatus,
} from "@prisma/client";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { addDateKeys, dateFromKey, getLocalWeekStart, localDateKey, localMidnightUtc } from "./time.js";
import { randomFlightPoints } from "./security.js";
import { canQualifyReferral, decideFlightAward, rankCandidates } from "./rules.js";

type TransactionClient = Prisma.TransactionClient;

export async function getSetting<T>(key: string): Promise<T> {
  const setting = await prisma.setting.findUnique({ where: { key } });
  if (!setting) throw new Error(`Required setting "${key}" is missing. Run the seed command.`);
  return setting.value as T;
}

export async function ensureCurrentPeriod(now = new Date()) {
  const activePeriod = await prisma.weeklyPeriod.findFirst({
    where: { startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: { startsAt: "desc" },
  });
  if (activePeriod) return activePeriod;

  const [timezone, periodWeeks] = await Promise.all([
    getSetting<string>("timezone"),
    getSetting<number>("periodWeeks"),
  ]);
  const weeks = Math.max(1, Math.min(12, Math.trunc(periodWeeks)));
  const startKey = getLocalWeekStart(now, timezone);
  const start = localMidnightUtc(startKey, timezone);
  const endKey = addDays(startKey, weeks * 7);
  const endsAt = localMidnightUtc(endKey, timezone);

  return prisma.weeklyPeriod.upsert({
    where: { startsAt_endsAt: { startsAt: start, endsAt } },
    create: { startsAt: start, endsAt },
    update: {},
  });
}

function addDays(key: string, days: number) {
  return addDateKeys(key, days);
}

export type RankingEntry = {
  rank: number;
  userId: string;
  username: string | null;
  firstName: string;
  points: number;
  reachedAt: Date | null;
};

type QueryClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function getRankings(
  startsAt: Date,
  endsAt: Date,
  queryClient: QueryClient = prisma,
): Promise<RankingEntry[]> {
  const rows = await queryClient.$queryRaw<RankingEntry[]>(Prisma.sql`
    WITH ordered_ledger AS (
      SELECT
        user_id,
        created_at,
        SUM(delta) OVER (
          PARTITION BY user_id
          ORDER BY created_at ASC, id ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS running_points
      FROM points_ledger
      WHERE created_at >= ${startsAt} AND created_at < ${endsAt}
    ),
    totals AS (
      SELECT user_id, SUM(delta)::integer AS points
      FROM points_ledger
      WHERE created_at >= ${startsAt} AND created_at < ${endsAt}
      GROUP BY user_id
      HAVING SUM(delta) > 0
    ),
    ranked AS (
      SELECT
        totals.user_id,
        totals.points,
        (
          SELECT MIN(ordered_ledger.created_at)
          FROM ordered_ledger
          WHERE ordered_ledger.user_id = totals.user_id
            AND ordered_ledger.running_points >= totals.points
        ) AS reached_at
      FROM totals
    )
    SELECT
      ROW_NUMBER() OVER (
        ORDER BY ranked.points DESC, ranked.reached_at ASC NULLS LAST, ranked.user_id ASC
      )::integer AS rank,
      users.id AS "userId",
      users.username AS username,
      users.first_name AS "firstName",
      ranked.points AS points,
      ranked.reached_at AS "reachedAt"
    FROM ranked
    JOIN users ON users.id = ranked.user_id
    ORDER BY rank ASC
  `);
  return rankCandidates(rows);
}

export async function completeMission(
  tx: TransactionClient,
  userId: string,
  missionId: string,
  reason = "mission_completed",
) {
  const changed = await tx.userMission.updateMany({
    where: { userId, missionId, status: { not: MissionStatus.done } },
    data: { status: MissionStatus.done, completedAt: new Date() },
  });

  if (changed.count === 0) return false;

  const mission = await tx.mission.findUniqueOrThrow({ where: { id: missionId } });
  await tx.pointsLedger.create({
    data: {
      userId,
      delta: mission.points,
      reason,
      refType: "mission",
      refId: mission.id,
      missionId: mission.id,
    },
  });
  await qualifyReferralIfEligible(tx, userId);
  return true;
}

export async function qualifyReferralIfEligible(
  tx: TransactionClient,
  referredUserId: string,
  now = new Date(),
) {
  const completedMissions = await tx.userMission.count({
    where: { userId: referredUserId, status: MissionStatus.done },
  });
  if (completedMissions < 2) return false;

  const referral = await tx.referral.findUnique({
    where: { referredId: referredUserId },
  });
  if (!referral || referral.status !== ReferralStatus.pending) return false;

  const timezone = await tx.setting.findUnique({ where: { key: "timezone" } });
  const [dailyLimitSetting, rewardSetting] = await Promise.all([
    tx.setting.findUnique({ where: { key: "referralDailyLimit" } }),
    tx.setting.findUnique({ where: { key: "referralRewardPoints" } }),
  ]);
  if (!timezone || !dailyLimitSetting || !rewardSetting) {
    throw new Error("Referral settings are missing. Run the seed command.");
  }
  const timezoneValue = timezone.value as string;
  const today = localDateKey(now, timezoneValue);
  const start = localMidnightUtc(today, timezoneValue);
  const end = localMidnightUtc(addDays(today, 1), timezoneValue);

  await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${referral.referrerId}::uuid FOR UPDATE`);
  const qualifiedToday = await tx.referral.count({
    where: {
      referrerId: referral.referrerId,
      status: ReferralStatus.qualified,
      qualifiedAt: { gte: start, lt: end },
    },
  });
  if (!canQualifyReferral(
    completedMissions,
    referral.status,
    qualifiedToday,
    dailyLimitSetting.value as number,
  )) return false;

  const updated = await tx.referral.updateMany({
    where: { id: referral.id, status: ReferralStatus.pending },
    data: { status: ReferralStatus.qualified, qualifiedAt: now },
  });
  if (updated.count !== 1) return false;

  await tx.pointsLedger.create({
    data: {
      userId: referral.referrerId,
      delta: rewardSetting.value as number,
      reason: "referral_qualified",
      refType: "referral",
      refId: referral.id,
    },
  });
  return true;
}

export async function recordFlight(userId: string, now = new Date(), retryAttempt = 0) {
  const [timezone, streakDays, streakBonusPoints] = await Promise.all([
    getSetting<string>("timezone"),
    getSetting<number>("flightStreakDays"),
    getSetting<number>("flightStreakBonusPoints"),
  ]);
  const todayKey = localDateKey(now, timezone);
  const todayDate = dateFromKey(todayKey);

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.dailyFlight.findUnique({
        where: { userId_dateUtc7: { userId, dateUtc7: todayDate } },
      });
      if (existing) {
        return decideFlightAward(existing.points, 0, 0, streakDays, streakBonusPoints);
      }

      const points = randomFlightPoints();
      const flight = await tx.dailyFlight.create({ data: { userId, dateUtc7: todayDate, points } });
      await tx.pointsLedger.create({
        data: { userId, delta: points, reason: "daily_flight", refType: "daily_flight", refId: todayKey },
      });
      const recentFlights = await tx.dailyFlight.findMany({
        where: {
          userId,
          dateUtc7: { gte: dateFromKey(addDays(todayKey, -366)), lte: todayDate },
        },
        select: { dateUtc7: true },
      });
      const flightDays = new Set(recentFlights.map((item) => item.dateUtc7.toISOString().slice(0, 10)));
      let consecutiveDays = 1;
      for (let offset = 1; offset <= 366; offset += 1) {
        if (!flightDays.has(addDays(todayKey, -offset))) break;
        consecutiveDays += 1;
      }

      const award = decideFlightAward(null, flight.points, consecutiveDays, streakDays, streakBonusPoints);
      if (award.bonusPoints > 0) {
        await tx.pointsLedger.create({
          data: {
            userId,
            delta: award.bonusPoints,
            reason: "weekly_flight_streak",
            refType: "flight_streak",
            refId: todayKey,
          },
        });
      }

      return award;
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)
      || !["P2002", "P2034"].includes(error.code)) {
      throw error;
    }
    const existing = await prisma.dailyFlight.findUnique({
      where: { userId_dateUtc7: { userId, dateUtc7: todayDate } },
    });
    if (existing) {
      return decideFlightAward(existing.points, 0, 0, streakDays, streakBonusPoints);
    }
    if (error.code === "P2034" && retryAttempt < 2) {
      return recordFlight(userId, now, retryAttempt + 1);
    }
    throw error;
  }
}

export async function getFlightStatus(userId: string, now = new Date()) {
  const [timezone, streakTarget, streakBonusPoints] = await Promise.all([
    getSetting<string>("timezone"),
    getSetting<number>("flightStreakDays"),
    getSetting<number>("flightStreakBonusPoints"),
  ]);
  const todayKey = localDateKey(now, timezone);
  const todayDate = dateFromKey(todayKey);
  const startKey = addDays(todayKey, -366);
  const flights = await prisma.dailyFlight.findMany({
    where: {
      userId,
      dateUtc7: { gte: dateFromKey(startKey), lte: todayDate },
    },
    orderBy: { dateUtc7: "asc" },
  });
  const flightByDay = new Map(flights.map((flight) => [flight.dateUtc7.toISOString().slice(0, 10), flight]));
  let streak = 0;
  const streakStart = flightByDay.has(todayKey) ? 0 : 1;
  for (let offset = streakStart; offset <= 366; offset += 1) {
    if (!flightByDay.has(addDays(todayKey, -offset))) break;
    streak += 1;
  }

  const nextFlightAt = localMidnightUtc(addDays(todayKey, 1), timezone);
  return {
    today: flightByDay.has(todayKey)
      ? { completed: true, points: flightByDay.get(todayKey)?.points ?? 0 }
      : { completed: false, points: null },
    streak,
    streakTarget,
    streakBonusPoints,
    days: Array.from({ length: 7 }, (_, index) => {
      const key = addDays(todayKey, index - 6);
      return { date: key, completed: flightByDay.has(key) };
    }),
    nextFlightAt: nextFlightAt.toISOString(),
    secondsUntilNext: Math.max(0, Math.ceil((nextFlightAt.getTime() - now.getTime()) / 1000)),
  };
}

export async function getCurrentPeriod() {
  const period = await ensureCurrentPeriod();
  return {
    period,
    secondsRemaining: Math.max(0, Math.ceil((period.endsAt.getTime() - Date.now()) / 1000)),
  };
}

export async function recordPeriodResults(now = new Date()) {
  const closedPeriods = await prisma.weeklyPeriod.findMany({
    where: { endsAt: { lte: now }, closedAt: null },
  });
  for (const period of closedPeriods) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM weekly_periods WHERE id = ${period.id}::uuid FOR UPDATE`);
      const locked = await tx.weeklyPeriod.findUniqueOrThrow({
        where: { id: period.id },
      });
      if (locked.closedAt) return;
      const rankings = await getRankings(period.startsAt, period.endsAt, tx);
      await tx.periodResult.createMany({
        data: rankings.slice(0, 3).map((entry) => ({
          periodId: period.id,
          userId: entry.userId,
          rank: entry.rank,
          points: entry.points,
          reachedAt: entry.reachedAt,
        })),
        skipDuplicates: true,
      });
      await tx.weeklyPeriod.update({
        where: { id: period.id },
        data: { closedAt: now },
      });
    });
  }
}

export async function qualifyPendingReferrals() {
  const referrals = await prisma.referral.findMany({
    where: { status: ReferralStatus.pending },
    select: { referredId: true },
  });
  for (const referral of referrals) {
    await prisma.$transaction((tx) =>
      qualifyReferralIfEligible(tx, referral.referredId),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

export function referralUrl(referralCode: string) {
  return `https://t.me/${env.BOT_USERNAME}/${env.MINI_APP_SHORT_NAME}?startapp=ref_${referralCode}`;
}

export async function totalPoints(userId: string) {
  const result = await prisma.pointsLedger.aggregate({
    where: { userId },
    _sum: { delta: true },
  });
  return result._sum.delta ?? 0;
}

export async function totalPointsForPeriod(startsAt: Date, endsAt: Date, userId: string) {
  const result = await prisma.pointsLedger.aggregate({
    where: { userId, createdAt: { gte: startsAt, lt: endsAt } },
    _sum: { delta: true },
  });
  return result._sum.delta ?? 0;
}
