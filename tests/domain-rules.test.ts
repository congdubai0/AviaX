import { describe, expect, it } from "vitest";
import {
  canQualifyReferral,
  decideFlightAward,
  rankCandidates,
  secondsRemainingForMinimum,
} from "../server/src/rules.js";

describe("daily flight idempotency", () => {
  it("does not award another score or streak bonus for an existing daily flight", () => {
    expect(decideFlightAward(37, 50, 7, 7, 100)).toEqual({
      awarded: false,
      points: 37,
      bonusPoints: 0,
    });
  });

  it("grants the configured streak bonus only at a streak milestone", () => {
    expect(decideFlightAward(null, 24, 7, 7, 100)).toEqual({
      awarded: true,
      points: 24,
      bonusPoints: 100,
    });
    expect(decideFlightAward(null, 24, 8, 7, 100).bonusPoints).toBe(0);
  });
});

describe("referral qualification", () => {
  it("requires two completed missions and a pending referral within the daily cap", () => {
    expect(canQualifyReferral(1, "pending", 0, 10)).toBe(false);
    expect(canQualifyReferral(2, "pending", 9, 10)).toBe(true);
    expect(canQualifyReferral(2, "pending", 10, 10)).toBe(false);
    expect(canQualifyReferral(2, "qualified", 0, 10)).toBe(false);
  });
});

describe("leaderboard ranking", () => {
  it("orders by score, then the earliest time the score was reached", () => {
    const ranked = rankCandidates([
      { userId: "late", points: 150, reachedAt: new Date("2026-01-01T00:00:20Z") },
      { userId: "lower", points: 149, reachedAt: new Date("2026-01-01T00:00:01Z") },
      { userId: "early", points: 150, reachedAt: new Date("2026-01-01T00:00:10Z") },
    ]);
    expect(ranked.map(({ userId, rank }) => [userId, rank])).toEqual([
      ["early", 1],
      ["late", 2],
      ["lower", 3],
    ]);
  });
});

describe("server-side demo timer", () => {
  it("does not complete before 60 seconds and allows completion at 60 seconds", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    expect(secondsRemainingForMinimum(
      startedAt,
      new Date("2026-01-01T00:00:59.001Z"),
      60,
    )).toBe(1);
    expect(secondsRemainingForMinimum(
      startedAt,
      new Date("2026-01-01T00:01:00.000Z"),
      60,
    )).toBe(0);
  });
});
