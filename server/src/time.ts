function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function localDateKey(date: Date, timeZone: string): string {
  const parts = localParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function addDateKeys(key: string, days: number): string {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function localMidnightUtc(dateKey: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const desiredLocalAsUtc = Date.UTC(year, month - 1, day);
  let result = desiredLocalAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shown = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(result));
    const values = Object.fromEntries(shown.map((part) => [part.type, Number(part.value)]));
    const shownAsUtc = Date.UTC(
      values.year,
      values.month - 1,
      values.day,
      values.hour,
      values.minute,
      values.second,
    );
    result += desiredLocalAsUtc - shownAsUtc;
  }

  return new Date(result);
}

export function getLocalWeekStart(date: Date, timeZone: string): string {
  const current = localDateKey(date, timeZone);
  const weekday = dateFromKey(current).getUTCDay();
  return addDateKeys(current, -((weekday + 6) % 7));
}
