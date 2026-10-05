export function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

export function dateOffset(dateKey: string, offset: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function consecutiveStreak(previousStreak: number | null): number {
  return previousStreak === null || previousStreak >= 7 ? 1 : previousStreak + 1;
}

export function secondsUntilLocalMidnight(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const second = Number(parts.find((part) => part.type === "second")?.value ?? "0");
  return Math.max(1, 86_400 - (hour * 3600 + minute * 60 + second));
}

export function secureRandomIntInclusive(min: number, max: number): number {
  const range = max - min + 1;
  if (min > max || range > 256) throw new Error("Invalid secure random range.");
  const limit = Math.floor(256 / range) * range;
  const bytes = new Uint8Array(1);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0] >= limit);
  return min + (bytes[0] % range);
}
