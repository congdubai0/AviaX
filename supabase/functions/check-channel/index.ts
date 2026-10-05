import { checkChannelMembership } from "../_shared/channel.ts";
import { checkRateLimit, jsonResponse, requireAcceptedTerms, withAuthenticatedUser } from "../_shared/http.ts";
import { completeMission } from "../_shared/missions.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve((request) => withAuthenticatedUser(request, async (context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Metode tidak didukung.", code: "METHOD_NOT_ALLOWED" }, 405);
  }
  const limited = await checkRateLimit(context, "check-channel", 20);
  if (limited) return limited;
  const ageError = requireAcceptedTerms(context);
  if (ageError) return ageError;

  const { data: state, error: stateError } = await getAdminClient()
    .from("user_missions")
    .select("status")
    .eq("user_id", context.user.id)
    .eq("mission_code", "join_channel")
    .maybeSingle();
  if (stateError) throw new Error(`Channel mission state load failed: ${stateError.message}`);
  if (state?.status === "done") return jsonResponse({ status: "done" });
  if (!state) {
    return jsonResponse({ error: "Mulai misi channel terlebih dahulu.", code: "MISSION_NOT_STARTED" }, 409);
  }

  const membership = await checkChannelMembership(context.identity.telegramId);
  if (!membership.configured) {
    return jsonResponse({ error: "Channel Telegram resmi belum dikonfigurasi.", code: "CHANNEL_NOT_CONFIGURED" }, 503);
  }
  if (!membership.isMember) {
    return jsonResponse({
      status: "checking",
      retry: true,
      message: "Keanggotaan belum terdeteksi. Gabung channel lalu coba lagi.",
    });
  }

  try {
    return jsonResponse(await completeMission(context.user.id, "join_channel"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("campaign_week_not_configured")) {
      return jsonResponse({ error: "Periode kampanye belum dikonfigurasi.", code: "CAMPAIGN_NOT_CONFIGURED" }, 503);
    }
    throw error;
  }
}));
