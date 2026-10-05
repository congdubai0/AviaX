import { checkRateLimit, jsonResponse, requireAcceptedTerms, withAuthenticatedUser } from "../_shared/http.ts";
import { completeMission, getMission } from "../_shared/missions.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve((request) => withAuthenticatedUser(request, async (context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Metode tidak didukung.", code: "METHOD_NOT_ALLOWED" }, 405);
  }
  const limited = await checkRateLimit(context, "mission-complete", 30);
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
  if (mission.kind === "join_channel") {
    return jsonResponse({ error: "Gunakan pemeriksaan channel Telegram.", code: "USE_CHANNEL_CHECK" }, 400);
  }
  if (mission.kind === "visit_link") {
    return jsonResponse({ status: "checking", retry: true, message: "Buka tautan resmi melalui tombol misi terlebih dahulu." });
  }

  const { data: userMission, error: stateError } = await getAdminClient()
    .from("user_missions")
    .select("status,started_at")
    .eq("user_id", context.user.id)
    .eq("mission_code", mission.code)
    .maybeSingle();
  if (stateError) throw new Error(`Mission state load failed: ${stateError.message}`);
  if (userMission?.status === "done") return jsonResponse({ status: "done" });
  if (!userMission?.started_at) {
    return jsonResponse({ error: "Mulai misi terlebih dahulu.", code: "MISSION_NOT_STARTED" }, 409);
  }

  const minimumSeconds = mission.kind === "demo_timer"
    ? Math.max(60, Number(mission.config.minimum_seconds ?? 60))
    : Math.max(0, Number(mission.config.minimum_seconds ?? 5));
  const remaining = Math.max(0, Math.ceil(
    minimumSeconds - (Date.now() - new Date(userMission.started_at).getTime()) / 1000,
  ));
  if (remaining > 0) {
    return jsonResponse({
      status: "checking",
      retryAfterSeconds: remaining,
      message: "Tunggu sampai penghitung waktu selesai sebelum verifikasi.",
    });
  }

  try {
    return jsonResponse(await completeMission(context.user.id, mission.code));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("campaign_week_not_configured")) {
      return jsonResponse({ error: "Periode kampanye belum dikonfigurasi.", code: "CAMPAIGN_NOT_CONFIGURED" }, 503);
    }
    if (message.includes("mission_locked")) {
      return jsonResponse({ error: "Selesaikan misi sebelumnya terlebih dahulu.", code: "MISSION_LOCKED" }, 409);
    }
    if (message.includes("demo_timer_incomplete")) {
      return jsonResponse({ status: "checking", retryAfterSeconds: 1 });
    }
    throw error;
  }
}));
