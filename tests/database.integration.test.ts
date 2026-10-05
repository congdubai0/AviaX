import { MissionStatus, PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { createReferralCode } from "../server/src/security.js";
import { getRankings, qualifyReferralIfEligible, recordFlight } from "../server/src/domain.js";

const prisma = new PrismaClient();
const dbDescribe = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip;

async function createTestUser() {
  return prisma.user.create({
    data: {
      telegramId: `test-${crypto.randomUUID()}`,
      firstName: "Test player",
      referralCode: createReferralCode(),
    },
  });
}

dbDescribe("PostgreSQL-backed point and referral transactions", () => {
  it("creates at most one daily flight and ledger award per user/date", async () => {
    const user = await createTestUser();
    const now = new Date();

    const first = await recordFlight(user.id, now);
    const second = await recordFlight(user.id, now);
    const [flightCount, ledgerCount] = await Promise.all([
      prisma.dailyFlight.count({ where: { userId: user.id } }),
      prisma.pointsLedger.count({ where: { userId: user.id, reason: "daily_flight" } }),
    ]);

    expect(first.awarded).toBe(true);
    expect(first.points).toBeGreaterThanOrEqual(10);
    expect(first.points).toBeLessThanOrEqual(50);
    expect(second).toEqual({ awarded: false, points: first.points, bonusPoints: 0 });
    expect(flightCount).toBe(1);
    expect(ledgerCount).toBe(1);
  });

  it("qualifies a referral once after two completed missions", async () => {
    const [referrer, referred] = await Promise.all([createTestUser(), createTestUser()]);
    const [firstMission, secondMission] = await Promise.all([
      prisma.mission.findUniqueOrThrow({ where: { key: "visit_aviax" } }),
      prisma.mission.findUniqueOrThrow({ where: { key: "join_channel" } }),
    ]);
    const now = new Date();
    await prisma.referral.create({
      data: { referrerId: referrer.id, referredId: referred.id },
    });
    await prisma.userMission.createMany({
      data: [firstMission, secondMission].map((mission) => ({
        userId: referred.id,
        missionId: mission.id,
        status: MissionStatus.done,
        startedAt: now,
        completedAt: now,
      })),
    });

    const firstQualification = await prisma.$transaction((tx) =>
      qualifyReferralIfEligible(tx, referred.id, now),
    );
    const replayedQualification = await prisma.$transaction((tx) =>
      qualifyReferralIfEligible(tx, referred.id, now),
    );
    const [referral, rewardCount] = await Promise.all([
      prisma.referral.findUniqueOrThrow({ where: { referredId: referred.id } }),
      prisma.pointsLedger.count({
        where: { userId: referrer.id, reason: "referral_qualified" },
      }),
    ]);

    expect(firstQualification).toBe(true);
    expect(replayedQualification).toBe(false);
    expect(referral.status).toBe("qualified");
    expect(rewardCount).toBe(1);
  });

  it("uses actual ledger totals and earliest score attainment for leaderboard ties", async () => {
    const [earlier, later] = await Promise.all([createTestUser(), createTestUser()]);
    const startsAt = new Date(Date.now() - 60_000);
    const endsAt = new Date(Date.now() + 60_000);
    const firstReachedAt = new Date(Date.now() - 20_000);
    const finalReachedAt = new Date(Date.now() - 10_000);

    await prisma.pointsLedger.createMany({
      data: [
        {
          userId: earlier.id,
          delta: 60,
          reason: "test_score",
          refType: "integration_test",
          refId: crypto.randomUUID(),
          createdAt: firstReachedAt,
        },
        {
          userId: earlier.id,
          delta: 40,
          reason: "test_score",
          refType: "integration_test",
          refId: crypto.randomUUID(),
          createdAt: finalReachedAt,
        },
        {
          userId: later.id,
          delta: 100,
          reason: "test_score",
          refType: "integration_test",
          refId: crypto.randomUUID(),
          createdAt: new Date(finalReachedAt.getTime() + 1000),
        },
      ],
    });

    const rows = await getRankings(startsAt, endsAt);
    const tieRows = rows.filter((row) => [earlier.id, later.id].includes(row.userId));

    expect(tieRows.map(({ userId, points }) => [userId, points])).toEqual([
      [earlier.id, 100],
      [later.id, 100],
    ]);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
