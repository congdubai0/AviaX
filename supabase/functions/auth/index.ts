import { withAuthenticatedUser, jsonResponse } from "../_shared/http.ts";
import { getAdminClient, getSetting } from "../_shared/supabase.ts";

type TermsBody = { action?: "bootstrap" | "accept_terms"; confirm?: boolean };

function settingValue<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object" && "value" in value) {
    return (value as { value: T }).value;
  }
  return value === null || value === undefined ? fallback : value as T;
}

Deno.serve((request) => withAuthenticatedUser(request, async ({ user }) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ error: "Metode tidak didukung.", code: "METHOD_NOT_ALLOWED" }, 405);
  }

  let body: TermsBody = {};
  if (request.method === "POST") {
    try {
      body = await request.json() as TermsBody;
    } catch {
      return jsonResponse({ error: "Permintaan tidak valid.", code: "INVALID_BODY" }, 400);
    }
  }

  if (body.action === "accept_terms") {
    if (body.confirm !== true) {
      return jsonResponse({ error: "Konfirmasi usia dan syarat diperlukan.", code: "TERMS_REQUIRED" }, 400);
    }
    const client = getAdminClient();
    const { error: updateError } = await client
      .from("users")
      .update({ accepted_terms_at: new Date().toISOString() })
      .eq("id", user.id)
      .is("accepted_terms_at", null);
    if (updateError) throw new Error(`Terms acceptance could not be saved: ${updateError.message}`);

    const { error: awardError } = await client.rpc("complete_user_mission", {
      p_user_id: user.id,
      p_mission_code: "open_app",
      p_ref_id: "terms_v1",
    });
    if (awardError) {
      if (awardError.message.includes("campaign_week_not_configured")) {
        return jsonResponse({
          error: "Periode kampanye belum dikonfigurasi. Silakan coba lagi nanti.",
          code: "CAMPAIGN_NOT_CONFIGURED",
        }, 503);
      }
      throw new Error(`Welcome mission could not be completed: ${awardError.message}`);
    }
  }

  const client = getAdminClient();
  const [ledger, currentWeek, rewardConfig, timezone, botUsername, appShortName] = await Promise.all([
    client.from("point_events").select("points").eq("user_id", user.id),
    client.from("weeks").select("starts_at,ends_at").lte("starts_at", new Date().toISOString())
      .gt("ends_at", new Date().toISOString()).order("starts_at", { ascending: false }).limit(1).maybeSingle(),
    getSetting<Record<string, unknown>>("reward_configuration"),
    getSetting<unknown>("timezone"),
    getSetting<unknown>("bot_username"),
    getSetting<unknown>("app_short_name"),
  ]);
  if (ledger.error) throw new Error(`Points could not be loaded: ${ledger.error.message}`);
  if (currentWeek.error) throw new Error(`Campaign period could not be loaded: ${currentWeek.error.message}`);

  const points = ledger.data.reduce((sum, entry) => sum + entry.points, 0);
  const week = currentWeek.data;
  const rewardObject = rewardConfig.weekly as { top_1?: number } | undefined;
  const prizeText = rewardObject?.top_1
    ? `Hadiah utama mingguan: $${rewardObject.top_1} USD`
    : null;
  const bot = settingValue<string>(botUsername, "");
  const shortName = settingValue<string>(appShortName, "");
  const referralUrl = bot && shortName
    ? `https://t.me/${bot}/${shortName}?startapp=ref_${user.referral_code}`
    : "";
  const now = Date.now();
  const endsAt = week?.ends_at ?? null;

  return jsonResponse({
    user: {
      firstName: user.first_name,
      username: user.username,
      points,
      ageConfirmed: Boolean(user.accepted_terms_at) || body.action === "accept_terms",
      referralUrl,
    },
    prizeText,
    period: {
      startsAt: week?.starts_at ?? null,
      endsAt,
      secondsRemaining: endsAt ? Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 1000)) : 0,
      timezone: settingValue<string>(timezone, "Asia/Jakarta"),
      configured: Boolean(week),
    },
  });
}));
