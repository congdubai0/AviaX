import { checkRateLimit, jsonResponse, requireAcceptedTerms, withAuthenticatedUser } from "../_shared/http.ts";
import { getAdminClient, getSetting } from "../_shared/supabase.ts";
import { buildReferralUrl, maskReferralName } from "../_shared/referral.ts";

Deno.serve((request) => withAuthenticatedUser(request, async (context) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Metode tidak didukung.", code: "METHOD_NOT_ALLOWED" }, 405);
  }
  const limited = await checkRateLimit(context, "referral", 30);
  if (limited) return limited;
  const ageError = requireAcceptedTerms(context);
  if (ageError) return ageError;

  let body: { action?: unknown; offset?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Permintaan tidak valid.", code: "INVALID_BODY" }, 400);
  }
  if (body.action !== "list") {
    return jsonResponse({ error: "Aksi tidak valid.", code: "INVALID_ACTION" }, 400);
  }
  const offset = typeof body.offset === "number" && Number.isSafeInteger(body.offset)
    ? Math.max(0, Math.min(100_000, body.offset))
    : 0;

  const client = getAdminClient();
  const timezone = await getSetting<string>("timezone");
  const botUsernameValue = await getSetting<unknown>("bot_username");
  const appShortNameValue = await getSetting<unknown>("app_short_name");
  const unwrap = (value: unknown): string => {
    if (value && typeof value === "object" && "value" in value) {
      const nested: unknown = (value as { value: unknown }).value;
      return typeof nested === "string" ? nested : "";
    }
    return typeof value === "string" ? value : "";
  };
  const botUsername = unwrap(botUsernameValue).replace(/^@/, "");
  const appShortName = unwrap(appShortNameValue);
  const referralUrl = buildReferralUrl(botUsername, appShortName, context.user.referral_code);

  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const today = `${dateParts.find((part) => part.type === "year")?.value}-${dateParts.find((part) => part.type === "month")?.value}-${dateParts.find((part) => part.type === "day")?.value}`;
  const dayStart = new Date(`${today}T00:00:00`);
  const localOffset = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  }).formatToParts(now).find((part) => part.type === "timeZoneName")?.value ?? "GMT+07:00";
  const offsetMatch = localOffset.match(/GMT([+-])(\d{2}):?(\d{2})/);
  const offsetMinutes = offsetMatch
    ? (offsetMatch[1] === "+" ? 1 : -1) * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]))
    : 420;
  const startUtc = new Date(dayStart.getTime() - offsetMinutes * 60_000).toISOString();
  const endUtc = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000 - offsetMinutes * 60_000).toISOString();

  const [todayCount, dailyLimit, totalCount, referrals] = await Promise.all([
    client.from("referrals").select("id", { count: "exact", head: true })
      .eq("inviter_id", context.user.id).gte("created_at", startUtc).lt("created_at", endUtc),
    getSetting<number>("referral_daily_limit"),
    client.from("referrals").select("id", { count: "exact", head: true })
      .eq("inviter_id", context.user.id),
    client.from("referrals")
      .select("created_at,rewarded,completed_missions,invitee:users!referrals_invitee_id_fkey(username,first_name)")
      .eq("inviter_id", context.user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + 19),
  ]);
  if (todayCount.error) throw new Error(`Today's referral count load failed: ${todayCount.error.message}`);
  if (totalCount.error) throw new Error(`Total referral count load failed: ${totalCount.error.message}`);
  if (referrals.error) throw new Error(`Referral list load failed: ${referrals.error.message}`);
  const total = totalCount.count ?? 0;
  const nextOffset = offset + referrals.data.length < total ? offset + referrals.data.length : null;

  return jsonResponse({
    referralUrl,
    joinedToday: todayCount.count ?? 0,
    dailyLimit,
    totalFriends: total,
    nextOffset,
    friends: referrals.data.map((item) => {
      const invitee = Array.isArray(item.invitee) ? item.invitee[0] : item.invitee;
      return {
        displayName: maskReferralName(invitee?.username ?? null, invitee?.first_name ?? ""),
        status: item.rewarded ? "qualified" : "joined",
        joinedAt: item.created_at,
      };
    }),
  });
}));
