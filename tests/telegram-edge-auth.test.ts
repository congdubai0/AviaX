import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TelegramAuthError, validateTelegramInitData } from "../supabase/functions/_shared/telegram";

async function signInitData(botToken: string, authDate: number, user = { id: 101, first_name: "Ayu" }) {
  const params = new URLSearchParams([
    ["auth_date", String(authDate)],
    ["query_id", "query-test"],
    ["start_param", "ref_AB12CD34"],
    ["user", JSON.stringify(user)],
  ]);
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

describe("Supabase Telegram initData validation", () => {
  it("validates signed identity and start parameter", async () => {
    const now = Math.floor(Date.now() / 1000);
    const initData = await signInitData("test-bot-token", now);
    await expect(validateTelegramInitData(initData, "test-bot-token", 86_400, now)).resolves.toEqual({
      telegramId: "101",
      firstName: "Ayu",
      username: null,
      startParam: "ref_AB12CD34",
    });
  });

  it("rejects tampered data and stale auth dates", async () => {
    const now = Math.floor(Date.now() / 1000);
    const valid = await signInitData("test-bot-token", now);
    await expect(validateTelegramInitData(valid.replace("Ayu", "Budi"), "test-bot-token", 86_400, now))
      .rejects.toBeInstanceOf(TelegramAuthError);
    const stale = await signInitData("test-bot-token", now - 86_401);
    await expect(validateTelegramInitData(stale, "test-bot-token", 86_400, now))
      .rejects.toMatchObject({ code: "EXPIRED_INIT_DATA" });
  });
});
