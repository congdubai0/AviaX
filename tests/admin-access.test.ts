import { describe, expect, it } from "vitest";
import { isAdminTelegramId } from "../supabase/functions/_shared/admin";

describe("Telegram administrator allowlist", () => {
  it("compares Telegram identifiers as exact strings", () => {
    expect(isAdminTelegramId("123456789", ["123456789"])).toBe(true);
    expect(isAdminTelegramId("123456789", [123456789])).toBe(true);
    expect(isAdminTelegramId("123456789", ["12345678"])).toBe(false);
  });

  it("denies empty and malformed allowlists", () => {
    expect(isAdminTelegramId("123456789", [])).toBe(false);
    expect(isAdminTelegramId("123456789", null)).toBe(false);
    expect(isAdminTelegramId("123456789", ["<ADMIN_TELEGRAM_ID>"])).toBe(false);
  });
});
