import { checkRateLimit, jsonResponse, requireAcceptedTerms, withAuthenticatedUser } from "../_shared/http.ts";
import { getAdminClient } from "../_shared/supabase.ts";

const typeByKind: Record<string, string> = {
  join_channel: "JOIN_CHANNEL",
  visit_link: "VISIT_LINK",
  demo_timer: "DEMO_TIMER",
  soft_check: "SOFT_CHECK",
  daily_checkin: "SOFT_CHECK",
  open_app: "SOFT_CHECK",
};

Deno.serve((request) => withAuthenticatedUser(request, async (context) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ error: "Metode tidak didukung.", code: "METHOD_NOT_ALLOWED" }, 405);
  }
  const limited = await checkRateLimit(context, "missions", 60);
  if (limited) return limited;
  const ageError = requireAcceptedTerms(context);
  if (ageError) return ageError;

  const client = getAdminClient();
  const [missions, states] = await Promise.all([
    client.from("missions")
      .select("code,title_id,points,kind,requires,sort_order")
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    client.from("user_missions").select("mission_code,status")
      .eq("user_id", context.user.id),
  ]);
  if (missions.error) throw new Error(`Mission list load failed: ${missions.error.message}`);
  if (states.error) throw new Error(`Mission progress load failed: ${states.error.message}`);

  const stateByCode = new Map(states.data.map((item) => [item.mission_code, item.status]));
  const completed = new Set(states.data.filter((item) => item.status === "done").map((item) => item.mission_code));
  return jsonResponse({
    missions: missions.data.map((mission) => ({
      id: mission.code,
      key: mission.code,
      title: mission.title_id,
      points: mission.points,
      type: typeByKind[mission.kind] ?? "SOFT_CHECK",
      status: stateByCode.get(mission.code) ?? "not_started",
      locked: Boolean(mission.requires && !completed.has(mission.requires)),
    })),
  });
}));
