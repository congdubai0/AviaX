import { describe, expect, it } from "vitest";
import { buildReferralUrl, maskReferralName } from "../supabase/functions/_shared/referral";

describe("referral links and masked names", () => {
  it("creates the configured Telegram Mini App deep link", () => {
    expect(buildReferralUrl("@aviax_bot", "aviaxapp", "AB12CD34"))
      .toBe("https://t.me/aviax_bot/aviaxapp?startapp=ref_AB12CD34");
  });

  it("does not produce a broken invite URL for missing configuration", () => {
    expect(buildReferralUrl("", "aviaxapp", "AB12CD34")).toBe("");
    expect(buildReferralUrl("aviax_bot", "x", "AB12CD34")).toBe("");
    expect(buildReferralUrl("aviax_bot", "aviaxapp", "invalid code")).toBe("");
  });

  it("masks both Telegram usernames and first names", () => {
    expect(maskReferralName("user_name", "Ayu")).toBe("@us***");
    expect(maskReferralName("x", "Ayu")).toBe("@x***");
    expect(maskReferralName(null, "Ayu Santoso")).toBe("Ay***");
  });
});
