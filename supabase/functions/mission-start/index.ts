import { checkRateLimit, jsonResponse, requireAcceptedTerms, withAuthenticatedUser } from "../_shared/http.ts";
import { configuredValue, getMission } from "../_shared/missions.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { createRedirectToken } from "../_shared/redirect-token.ts";

Deno.serve((request) => withAuthenticatedUser(request, async (context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Metode tidak didukung.", code: "METHOD_NOT_ALLOWED" }, 405);
  }
  const limited = await checkRateLimit(context, "mission-start", 30);
  if (limited) return limited;
  const ageError = requireAcceptedTerms(context);
  if (ageError) return ageError;

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Permintaan tidak valid.", code: "INVALID_BODY" }, 400);
  }
  if (typeof body.code !== "string" || !/^[a-z0-9_]{1,64}$/.test(body.code)) {
    return jsonResponse({ error: "Misi tidak valid.", code: "INVALID_MISSION" }, 400);
  }
  const mission = await getMission(body.code);
  if (!mission) return jsonResponse({ error: "Misi tidak ditemukan.", code: "MISSION_NOT_FOUND" }, 404);

  const { data: start, error } = await getAdminClient().rpc("start_user_mission", {
    p_user_id: context.user.id,
    p_mission_code: mission.code,
  });
  if (error) {
    if (error.message.includes("mission_locked")) {
      return jsonResponse({ error: "Selesaikan misi sebelumnya terlebih dahulu.", code: "MISSION_LOCKED" }, 409);
    }
    if (error.message.includes("use_daily_checkin_endpoint")) {
      return jsonResponse({ error: "Gunakan tombol absen harian untuk menyelesaikan misi ini.", code: "USE_CHECKIN" }, 409);
    }
    if (error.message.includes("age_confirmation_required")) {
      return jsonResponse({ error: "Konfirmasi usia 18+ terlebih dahulu.", code: "AGE_CONFIRMATION_REQUIRED" }, 403);
    }
    throw new Error(`Mission start failed: ${error.message}`);
  }
  const state = start as { status: string; started_at: string | null };
  if (state.status === "done") return jsonResponse({ status: "done" });

  if (mission.kind === "join_channel") {
    const channelUrl = await configuredValue<string>("channel_url", "");
    if (!/^https:\/\/t\.me\/[A-Za-z0-9_]+/.test(channelUrl)) {
      return jsonResponse({ error: "Channel Telegram resmi belum dikonfigurasi.", code: "CHANNEL_NOT_CONFIGURED" }, 503);
    }
    return jsonResponse({ status: "checking", channelUrl });
  }

  if (mission.kind === "visit_link") {
    const redirectUrl = new URL(`${Deno.env.get("SUPABASE_URL")}/functions/v1/go`);
    redirectUrl.searchParams.set("m", mission.code);
    redirectUrl.searchParams.set("t", await createRedirectToken(context.user.id, mission.code));
    return jsonResponse({ status: "checking", redirectUrl: redirectUrl.toString() });
  }

  if (mission.kind === "demo_timer") {
    const pageUrl = await configuredValue<string>("demo_url", "");
    if (!pageUrl || !pageUrl.startsWith("https://")) {
      return jsonResponse({ error: "Tautan demo belum dikonfigurasi.", code: "DEMO_NOT_CONFIGURED" }, 503);
    }
    const configuredMinimum = Number(mission.config.minimum_seconds ?? 60);
    return jsonResponse({
      status: "checking",
      pageUrl,
      minimumSeconds: Math.max(60, configuredMinimum),
    });
  }

  if (mission.kind === "soft_check") {
    const socialLinks = await configuredValue<Record<string, string>>("social_links", {});
    const pageUrl = Object.values(socialLinks).find((value) => typeof value === "string" && value.startsWith("https://"));
    if (!pageUrl) {
      return jsonResponse({ error: "Tautan media sosial resmi belum dikonfigurasi.", code: "SOCIAL_LINK_NOT_CONFIGURED" }, 503);
    }
    return jsonResponse({ status: "checking", pageUrl });
  }

  return jsonResponse({ status: state.status });
}));
