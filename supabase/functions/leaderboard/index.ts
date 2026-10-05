import { checkRateLimit, jsonResponse, requireAcceptedTerms, withAuthenticatedUser } from "../_shared/http.ts";
import { getAdminClient, getSetting } from "../_shared/supabase.ts";

type RewardConfiguration = {
  weekly?: { top_1?: number; top_2?: number; top_3?: number };
  final_week?: { top_1?: number; top_2?: number; top_3?: number };
};

function prizeText(config: RewardConfiguration, isFinal: boolean): string | null {
  const prizes = isFinal ? config.final_week : config.weekly;
  if (!prizes?.top_1 || !prizes.top_2 || !prizes.top_3) return null;
  return `#1 $${prizes.top_1} · #2 $${prizes.top_2} · #3 $${prizes.top_3} USD`;
}

Deno.serve((request) => withAuthenticatedUser(request, async (context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Metode tidak didukung.", code: "METHOD_NOT_ALLOWED" }, 405);
  }
  const limited = await checkRateLimit(context, "leaderboard", 30);
  if (limited) return limited;
  const ageError = requireAcceptedTerms(context);
  if (ageError) return ageError;
  try {
    const body = await request.json() as { action?: unknown };
    if (body.action !== "read") {
      return jsonResponse({ error: "Aksi tidak valid.", code: "INVALID_ACTION" }, 400);
    }
  } catch {
    return jsonResponse({ error: "Permintaan tidak valid.", code: "INVALID_BODY" }, 400);
  }

  const client = getAdminClient();
  const now = new Date();
  const { data: week, error: weekError } = await client
    .from("weeks")
    .select("id,week_number,starts_at,ends_at,is_final")
    .lte("starts_at", now.toISOString())
    .gt("ends_at", now.toISOString())
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (weekError) throw new Error(`Active leaderboard period load failed: ${weekError.message}`);

  const rewards = await getSetting<RewardConfiguration>("reward_configuration");
  if (!week) {
    return jsonResponse({
      entries: [],
      me: { rank: null, points: 0 },
      period: { startsAt: null, endsAt: null, secondsRemaining: 0, configured: false },
      weekNumber: null,
      isFinal: false,
      prizeText: null,
    });
  }

  const { data, error } = await client.rpc("get_week_leaderboard", {
    p_week_id: week.id,
    p_user_id: context.user.id,
  });
  if (error) throw new Error(`Leaderboard query failed: ${error.message}`);
  const rankings = data as {
    entries: Array<{ rank: number; displayName: string; points: number }>;
    me: { rank: number | null; points: number };
  };

  return jsonResponse({
    ...rankings,
    period: {
      startsAt: week.starts_at,
      endsAt: week.ends_at,
      secondsRemaining: Math.max(0, Math.floor((new Date(week.ends_at).getTime() - now.getTime()) / 1000)),
      configured: true,
    },
    weekNumber: week.week_number,
    isFinal: week.is_final,
    prizeText: prizeText(rewards, week.is_final),
  });
}));
