export function isAdminTelegramId(telegramId: string, allowedIds: unknown): boolean {
  return Array.isArray(allowedIds)
    && allowedIds.some((allowedId) =>
      (typeof allowedId === "string" || typeof allowedId === "number")
      && String(allowedId) === telegramId
    );
}
