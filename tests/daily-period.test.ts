import { describe, expect, it } from "vitest";
import {
  consecutiveStreak,
  dateOffset,
  localDateKey,
  secureRandomIntInclusive,
  secondsUntilLocalMidnight,
} from "../supabase/functions/_shared/daily";

describe("Asia/Jakarta daily boundaries", () => {
  it("uses the configured local date and offsets calendar dates safely", () => {
    expect(localDateKey(new Date("2026-10-05T17:15:00.000Z"), "Asia/Jakarta")).toBe("2026-10-06");
    expect(dateOffset("2026-10-06", -6)).toBe("2026-09-30");
  });

  it("resets the seven-day streak cycle after the bonus milestone", () => {
    expect(consecutiveStreak(null)).toBe(1);
    expect(consecutiveStreak(5)).toBe(6);
    expect(consecutiveStreak(6)).toBe(7);
    expect(consecutiveStreak(7)).toBe(1);
  });

  it("calculates remaining seconds until midnight and returns secure points in range", () => {
    expect(secondsUntilLocalMidnight(new Date("2026-10-05T17:30:00.000Z"), "Asia/Jakarta")).toBe(23 * 3600 + 30 * 60);
    for (let index = 0; index < 100; index += 1) {
      const points = secureRandomIntInclusive(10, 50);
      expect(points).toBeGreaterThanOrEqual(10);
      expect(points).toBeLessThanOrEqual(50);
    }
    expect(() => secureRandomIntInclusive(50, 10)).toThrow("Invalid secure random range.");
  });
});
