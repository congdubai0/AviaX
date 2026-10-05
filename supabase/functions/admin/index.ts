import { checkRateLimit, jsonResponse, withAuthenticatedUser } from "../_shared/http.ts";
import { getAdminClient, getSetting } from "../_shared/supabase.ts";
import { secureRandomIndex, localDateKey } from "../_shared/daily.ts";
import { isAdminTelegramId } from "../_shared/admin.ts";

type RewardConfiguration = {
  weekly: { weeks: number; total_usd: number; top_1: number; top_2: number; top_3: number; ranks_4_10_each: number };
  daily_draw: { per_day_usd: number; total_usd: number };
  final_week: { top_1: number; top_2: number; top_3: number; total_usd: number };
  total_usd: number;
  TODO?: string;
};

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

async function drawDailyWinner(adminUserId: string): Promise<unknown> {
  const client = getAdminClient();
  const timezone = await getSetting<string>("timezone");
  const today = localDateKey(new Date(), timezone);
  const startUtc = new Date(`${today}T00:00:00`);
  const offsetText = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" })
    .formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value ?? "GMT+07:00";
  const match = offsetText.match(/GMT([+-])(\d{2}):?(\d{2})/);
  const offsetMinutes = match
    ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]))
    : 420;
  const startIso = new Date(startUtc.getTime() - offsetMinutes * 60_000).toISOString();
  const endIso = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000 - offsetMinutes * 60_000).toISOString();
  const { data: existing, error: existingError } = await client
    .from("daily_draws").select("id,draw_date,points,winner_id").eq("draw_date", today).maybeSingle();
  if (existingError) throw new Error(`Existing daily draw lookup failed: ${existingError.message}`);
  if (existing) return { date: today, winnerId: existing.winner_id, alreadyDrawn: true };

  const { data: events, error: eventsError } = await client
    .from("point_events").select("user_id")
    .in("reason", ["mission", "daily_checkin"])
    .gte("created_at", startIso).lt("created_at", endIso);
  if (eventsError) throw new Error(`Daily draw eligibility lookup failed: ${eventsError.message}`);
  const candidates = [...new Set(events.map((event) => event.user_id))];
  if (candidates.length === 0) {
    return { date: today, winnerId: null, alreadyDrawn: false, message: "Belum ada peserta yang memenuhi syarat hari ini." };
  }
  const eligibleRows = await client.from("users").select("id")
    .in("id", candidates).eq("is_banned", false);
  if (eligibleRows.error) throw new Error(`Daily draw user eligibility lookup failed: ${eligibleRows.error.message}`);
  const eligibleIds = eligibleRows.data.map((row) => row.id);
  if (eligibleIds.length === 0) {
    return { date: today, winnerId: null, alreadyDrawn: false, message: "Belum ada peserta yang memenuhi syarat hari ini." };
  }
  const winnerId = eligibleIds[secureRandomIndex(eligibleIds.length)];
  const rewards = await getSetting<RewardConfiguration>("reward_configuration");
  const points = Number(rewards.daily_draw?.per_day_usd ?? 20);
  const { data: draw, error: drawError } = await client.from("daily_draws").insert({
    draw_date: today,
    winner_id: winnerId,
    points,
    drawn_by: adminUserId,
  }).select("id,draw_date,winner_id,points").single();
  if (drawError) {
    if (drawError.code === "23505") {
      const { data: racedDraw, error: racedError } = await client.from("daily_draws")
        .select("id,draw_date,winner_id,points").eq("draw_date", today).single();
      if (racedError) throw new Error(`Concurrent daily draw lookup failed: ${racedError.message}`);
      return { ...racedDraw, alreadyDrawn: true };
    }
    throw new Error(`Daily draw could not be saved: ${drawError.message}`);
  }
  return { ...draw, alreadyDrawn: false };
}

async function winnersCsv(): Promise<string> {
  const client = getAdminClient();
  const { data: weeks, error: weeksError } = await client.from("weeks")
    .select("id,week_number,is_final,starts_at,ends_at").order("starts_at");
  if (weeksError) throw new Error(`Campaign weeks load failed: ${weeksError.message}`);
  const rows: unknown[][] = [["type", "week_or_date", "rank", "telegram_id", "username", "first_name", "points"]];
  for (const week of weeks) {
    const { data: points, error: pointsError } = await client.from("point_events")
      .select("user_id,points,created_at").eq("week_id", week.id);
    if (pointsError) throw new Error(`Weekly winners load failed: ${pointsError.message}`);
    const userIds = [...new Set(points.map((entry) => entry.user_id))];
    if (userIds.length === 0) continue;
    const { data: users, error: usersError } = await client.from("users")
      .select("id,telegram_id,username,first_name,is_banned")
      .in("id", userIds).eq("is_banned", false);
    if (usersError) throw new Error(`Weekly winners profile load failed: ${usersError.message}`);
    const { data: eligibleMissions, error: missionError } = await client.from("user_missions")
      .select("user_id").eq("mission_code", "join_channel").eq("status", "done").in("user_id", userIds);
    if (missionError) throw new Error(`Weekly winner eligibility load failed: ${missionError.message}`);
    const eligible = new Set(eligibleMissions.map((item) => item.user_id));
    const profileById = new Map(users.map((user) => [user.id, user]));
    const totals = new Map<string, { points: number; reachedAt: string }>();
    for (const entry of points) {
      if (!eligible.has(entry.user_id)) continue;
      const current = totals.get(entry.user_id);
      totals.set(entry.user_id, {
        points: (current?.points ?? 0) + entry.points,
        reachedAt: !current || entry.created_at < current.reachedAt ? entry.created_at : current.reachedAt,
      });
    }
    const ranked = [...totals.entries()]
      .map(([userId, total]) => ({ userId, ...total }))
      .sort((left, right) => right.points - left.points
        || left.reachedAt.localeCompare(right.reachedAt)
        || left.userId.localeCompare(right.userId))
      .slice(0, week.is_final ? 10 : 10);
    for (const [index, entry] of ranked.entries()) {
      const user = profileById.get(entry.userId);
      if (!user) continue;
      rows.push([
        "weekly",
        week.week_number,
        index + 1,
        user.telegram_id,
        user.username,
        user.first_name,
        entry.points,
      ]);
      if (week.is_final && index < 3) {
        rows.push([
          "final_week",
          week.week_number,
          index + 1,
          user.telegram_id,
          user.username,
          user.first_name,
          entry.points,
        ]);
      }
    }
  }
  const { data: draws, error: drawsError } = await client.from("daily_draws")
    .select("draw_date,points,winner:users!daily_draws_winner_id_fkey(telegram_id,username,first_name)")
    .order("draw_date");
  if (drawsError) throw new Error(`Daily draw winners load failed: ${drawsError.message}`);
  for (const draw of draws) {
    const winner = Array.isArray(draw.winner) ? draw.winner[0] : draw.winner;
    rows.push(["daily_draw", draw.draw_date, 1, winner?.telegram_id ?? "", winner?.username ?? "", winner?.first_name ?? "", draw.points]);
  }
  return toCsv(rows);
}

Deno.serve((request) => withAuthenticatedUser(request, async (context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Metode tidak didukung.", code: "METHOD_NOT_ALLOWED" }, 405);
  }
  const limited = await checkRateLimit(context, "admin", 30);
  if (limited) return limited;
  const client = getAdminClient();
  const { data: ids, error: idsError } = await client.from("settings")
    .select("value").eq("key", "admin_telegram_ids").maybeSingle();
  if (idsError) throw new Error(`Admin access list load failed: ${idsError.message}`);
  if (!isAdminTelegramId(context.identity.telegramId, ids?.value)) {
    return jsonResponse({ error: "Akses admin ditolak.", code: "ADMIN_FORBIDDEN" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Permintaan tidak valid.", code: "INVALID_BODY" }, 400);
  }
  const action = body.action;
  if (action === "metrics") {
    const [summary, weeks, missions, rewardConfiguration, timezone] = await Promise.all([
      client.rpc("admin_dashboard_metrics"),
      client.from("weeks").select("id,week_number,is_final,starts_at,ends_at").order("starts_at"),
      client.from("missions").select("code,title_id,points,active,kind,config").order("sort_order"),
      getSetting<RewardConfiguration>("reward_configuration"),
      getSetting<string>("timezone"),
    ]);
    if (summary.error) throw new Error(`Admin dashboard summary failed: ${summary.error.message}`);
    if (weeks.error) throw new Error(`Admin campaign weeks failed: ${weeks.error.message}`);
    if (missions.error) throw new Error(`Admin missions load failed: ${missions.error.message}`);
    const weekRanks = await Promise.all((weeks.data ?? []).map(async (week) => {
      const { data, error } = await client.rpc("get_week_leaderboard", {
        p_week_id: week.id,
        p_user_id: context.user.id,
      });
      if (error) throw new Error(`Admin weekly ranking failed: ${error.message}`);
      const result = data as { entries: Array<{ rank: number; displayName: string; points: number }> };
      return { weekNumber: week.week_number, isFinal: week.is_final, entries: result.entries };
    }));
    return jsonResponse({
      ...(summary.data as Record<string, unknown>),
      weeks: weekRanks,
      missions: (missions.data ?? []).map((mission) => ({
        id: mission.code,
        key: mission.code,
        title: mission.title_id,
        points: mission.points,
        active: mission.active,
        type: mission.kind,
        config: mission.config,
      })),
      rewardConfiguration,
      timezone,
    });
  }

  if (action === "daily_draw") {
    return jsonResponse(await drawDailyWinner(context.user.id));
  }
  if (action === "export_csv") {
    return jsonResponse(await winnersCsv());
  }
  if (action === "update_user") {
    if (typeof body.telegramId !== "string" || !/^\d+$/.test(body.telegramId) || typeof body.flagged !== "boolean") {
      return jsonResponse({ error: "Data akun tidak valid.", code: "INVALID_USER_UPDATE" }, 400);
    }
    const values: { is_flagged: boolean; is_banned?: boolean } = { is_flagged: body.flagged };
    if (typeof body.banned === "boolean") values.is_banned = body.banned;
    const { error } = await client.from("users")
      .update(values)
      .eq("telegram_id", body.telegramId);
    if (error) throw new Error(`User moderation update failed: ${error.message}`);
    return jsonResponse({ saved: true });
  }
  if (action === "save_settings") {
    if (typeof body.timezone !== "string" || !/^[A-Za-z_]+\/[A-Za-z_+-]+$/.test(body.timezone)) {
      return jsonResponse({ error: "Zona waktu tidak valid.", code: "INVALID_TIMEZONE" }, 400);
    }
    const { error } = await client.from("settings").upsert({
      key: "timezone",
      value: JSON.stringify(body.timezone),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Timezone setting update failed: ${error.message}`);
    return jsonResponse({ saved: true });
  }
  if (action === "update_mission") {
    return jsonResponse({ error: "Konfigurasi misi diatur melalui settings Supabase.", code: "MISSION_SETTINGS_READ_ONLY" }, 409);
  }
  if (action === "save_campaign_start") {
    if (typeof body.startsAt !== "string" || Number.isNaN(Date.parse(body.startsAt))) {
      return jsonResponse({ error: "Tanggal mulai kampanye tidak valid.", code: "INVALID_CAMPAIGN_START" }, 400);
    }
    const { count, error: countError } = await client.from("seasons")
      .select("id", { count: "exact", head: true });
    if (countError) throw new Error(`Campaign state lookup failed: ${countError.message}`);
    if ((count ?? 0) > 0) {
      return jsonResponse({ error: "Kampanye sudah dibuat dan tidak dapat diganti di panel ini.", code: "CAMPAIGN_ALREADY_CREATED" }, 409);
    }
    const { data, error } = await client.rpc("create_campaign_weeks", {
      p_starts_at: new Date(body.startsAt).toISOString(),
    });
    if (error) throw new Error(`Campaign setup failed: ${error.message}`);
    return jsonResponse({ saved: true, seasonId: data });
  }

  return jsonResponse({ error: "Aksi tidak dikenal.", code: "UNKNOWN_ADMIN_ACTION" }, 400);
}));
