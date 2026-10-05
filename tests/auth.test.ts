import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AuthenticationError, validateTelegramInitData } from "../server/src/telegram-auth.js";

function signInitData(authDate: number, startParam = "group_id") {
  const entries = [
    ["auth_date", String(authDate)],
    ["query_id", "query-test"],
    ["start_param", startParam],
    ["user", JSON.stringify({ id: 101, first_name: "Ayu", username: "ayu_test" })],
  ] as const;
  const dataCheckString = [...entries]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(process.env.BOT_TOKEN!).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const params = new URLSearchParams(entries);
  params.set("hash", hash);
  return params.toString();
}

describe("Telegram initData authentication", () => {
  it("validates Telegram's HMAC and returns the signed identity", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(validateTelegramInitData(signInitData(now), now)).toEqual({
      telegramId: "101",
      firstName: "Ayu",
      username: "ayu_test",
      startParam: "group_id",
    });
  });

  it("rejects data changed after its signature was calculated", () => {
    const now = Math.floor(Date.now() / 1000);
    const signed = signInitData(now);
    const changed = signed.replace("ayu_test", "other_user");
    expect(() => validateTelegramInitData(changed, now)).toThrow(AuthenticationError);
  });

  it("rejects an otherwise valid signature when auth_date is stale", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(() => validateTelegramInitData(signInitData(now - 86_401), now)).toThrow(/expired/i);
  });
});
