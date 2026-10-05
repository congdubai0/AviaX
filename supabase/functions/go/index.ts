import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { configuredValue } from "../_shared/missions.ts";
import { verifyRedirectToken } from "../_shared/redirect-token.ts";

async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get("IP_HASH_SALT");
  if (!salt) throw new Error("IP_HASH_SALT is not configured in Supabase secrets.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const requestUrl = new URL(request.url);
  const missionCode = requestUrl.searchParams.get("m");
  const token = requestUrl.searchParams.get("t");
  if (missionCode !== "visit_aviax" || !token) {
    return new Response("Tautan tidak valid.", { status: 400 });
  }

  if (!Deno.env.get("REDIRECT_SIGNING_SECRET")) {
    return new Response("Layanan pengalihan belum dikonfigurasi.", { status: 503 });
  }
  let verified: { userId: string; code: string };
  try {
    verified = await verifyRedirectToken(token);
  } catch (error) {
    console.warn("AviaX redirect token rejected", error);
    return new Response("Tautan tidak valid atau sudah kedaluwarsa.", { status: 403 });
  }

  const { userId, code } = verified;
  const client = getAdminClient();
  const { data: allowed, error: limitError } = await client.rpc("consume_rate_limit", {
    p_bucket_key: `${userId}:go`,
    p_max_requests: 20,
    p_window_seconds: 60,
  });
  if (limitError) throw new Error(`Redirect rate limit failed: ${limitError.message}`);
  if (!allowed) return new Response("Terlalu banyak permintaan. Coba lagi nanti.", { status: 429 });

  const target = await configuredValue<string>("aviax_redirect_url", "");
  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("Tujuan AviaX belum dikonfigurasi.", { status: 503 });
  }
  if (targetUrl.protocol !== "https:") {
    return new Response("Tujuan AviaX harus menggunakan HTTPS.", { status: 503 });
  }
  targetUrl.searchParams.set("utm_source", "telegram");
  targetUrl.searchParams.set("utm_medium", "mini_app");
  targetUrl.searchParams.set("utm_campaign", "aviax_missions");

  const ip = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  const { error: logError } = await client.from("click_logs").insert({
    user_id: userId,
    mission_code: code,
    user_agent: request.headers.get("user-agent")?.slice(0, 512) ?? null,
    ip_hash: await hashIp(ip),
  });
  if (logError) throw new Error(`Click tracking failed: ${logError.message}`);

  const { error: awardError } = await client.rpc("complete_user_mission", {
    p_user_id: userId,
    p_mission_code: code,
    p_ref_id: `${code}:v1`,
  });
  if (awardError) {
    if (awardError.message.includes("campaign_week_not_configured")) {
      return new Response("Periode kampanye belum dikonfigurasi.", { status: 503 });
    }
    throw new Error(`Visit mission completion failed: ${awardError.message}`);
  }

  return new Response(null, {
    status: 302,
    headers: { Location: targetUrl.toString(), "Cache-Control": "no-store" },
  });
});
