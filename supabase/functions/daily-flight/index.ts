import { checkRateLimit, jsonResponse, requireAcceptedTerms, withAuthenticatedUser } from "../_shared/http.ts";
import { dateOffset, localDateKey, secureRandomIntInclusive, secondsUntilLocalMidnight } from "../_shared/daily.ts";
import { getAdminClient, getSetting } from "../_shared/supabase.ts";

type CheckinResult = {
  awarded: boolean;
  points: number;
  bonusPoints: number;
  date: string;
  streak: number;
};

async function getStatus(userId: string) {
  const client = getAdminClient();
  const timezone = await getSetting<string>("timezone");
  const streakTarget = await getSetting<number>("streak_days");
  const streakBonusPoints = await getSetting<number>("streak_bonus_points");
  const today = localDateKey(new Date(), timezone);
  const weekAgo = dateOffset(today, -6);
  const [flight, checkins] = await Promise.all([
    client.from("daily_flights").select("points,flight_date")
      .eq("user_id", userId).eq("flight_date", today).maybeSingle(),
    client.from("checkins").select("checkin_date,streak")
      .eq("user_id", userId).gte("checkin_date", weekAgo).lte("checkin_date", today)
      .order("checkin_date", { ascending: false }),
  ]);
  if (flight.error) throw new Error(`Daily flight status load failed: ${flight.error.message}`);
  if (checkins.error) throw new Error(`Check-in streak load failed: ${checkins.error.message}`);

  const checkinsByDate = new Map(checkins.data.map((item) => [item.checkin_date, item]));
  const yesterday = dateOffset(today, -1);
  const latest = checkins.data[0];
  const streak = latest && (latest.checkin_date === today || latest.checkin_date === yesterday)
    ? latest.streak
    : 0;
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = dateOffset(today, index - 6);
    return { date, completed: checkinsByDate.has(date) };
  });

  const secondsUntilNext = secondsUntilLocalMidnight(new Date(), timezone);
  const nextFlightAt = new Date(Date.now() + secondsUntilNext * 1000).toISOString();

  return {
    today: { completed: Boolean(flight.data), points: flight.data?.points ?? null },
    streak,
    streakTarget,
    streakBonusPoints,
    days,
    nextFlightAt,
    secondsUntilNext,
  };
}

Deno.serve((request) => withAuthenticatedUser(request, async (context) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ error: "Metode tidak didukung.", code: "METHOD_NOT_ALLOWED" }, 405);
  }
  const limited = await checkRateLimit(context, "daily-flight", 12);
  if (limited) return limited;
  const ageError = requireAcceptedTerms(context);
  if (ageError) return ageError;

  let action = "status";
  if (request.method === "POST") {
    try {
      const body = await request.json() as { action?: unknown };
      if (body.action === "fly" || body.action === "checkin") action = body.action;
      else return jsonResponse({ error: "Aksi tidak valid.", code: "INVALID_ACTION" }, 400);
    } catch {
      return jsonResponse({ error: "Permintaan tidak valid.", code: "INVALID_BODY" }, 400);
    }
  }

  const client = getAdminClient();
  if (action === "checkin") {
    const { data, error } = await client.rpc("record_daily_checkin", { p_user_id: context.user.id });
    if (error) {
      if (error.message.includes("campaign_week_not_configured")) {
        return jsonResponse({ error: "Periode kampanye belum dikonfigurasi.", code: "CAMPAIGN_NOT_CONFIGURED" }, 503);
      }
      if (error.message.includes("age_confirmation_required")) {
        return jsonResponse({ error: "Konfirmasi usia 18+ terlebih dahulu.", code: "AGE_CONFIRMATION_REQUIRED" }, 403);
      }
      throw new Error(`Daily check-in failed: ${error.message}`);
    }
    const result = data as CheckinResult;
    return jsonResponse({
      ...result,
      status: "done",
      message: result.awarded
        ? `Absen berhasil. +${result.points + result.bonusPoints} poin.`
        : "Kamu sudah absen hari ini.",
    });
  }

  if (action === "fly") {
    const min = await getSetting<number>("flight_min_points");
    const max = await getSetting<number>("flight_max_points");
    const points = secureRandomIntInclusive(min, max);
    const { data, error } = await client.rpc("record_daily_flight", {
      p_user_id: context.user.id,
      p_points: points,
    });
    if (error) {
      if (error.message.includes("campaign_week_not_configured")) {
        return jsonResponse({ error: "Periode kampanye belum dikonfigurasi.", code: "CAMPAIGN_NOT_CONFIGURED" }, 503);
      }
      if (error.message.includes("age_confirmation_required")) {
        return jsonResponse({ error: "Konfirmasi usia 18+ terlebih dahulu.", code: "AGE_CONFIRMATION_REQUIRED" }, 403);
      }
      throw new Error(`Daily flight could not be recorded: ${error.message}`);
    }
    const result = data as { awarded: boolean; points: number; bonusPoints: number };
    return jsonResponse({
      ...result,
      flight: await getStatus(context.user.id),
    });
  }

  return jsonResponse(await getStatus(context.user.id));
}));
