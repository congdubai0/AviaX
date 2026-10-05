import { getAdminClient } from "./supabase.ts";
import { TelegramAuthError, validateTelegramInitData, type TelegramIdentity } from "./telegram.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-telegram-init-data, x-device-fingerprint",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export type AuthenticatedUser = {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string;
  referral_code: string;
  group_code: string | null;
  accepted_terms_at: string | null;
  is_flagged: boolean;
  is_banned: boolean;
};

export type RequestContext = {
  identity: TelegramIdentity;
  user: AuthenticatedUser;
  ipHash: string;
};

export async function checkRateLimit(
  context: RequestContext,
  action: string,
  maxRequests = 40,
): Promise<Response | null> {
  const { data, error } = await getAdminClient().rpc("consume_rate_limit", {
    p_bucket_key: `${context.user.id}:${action}`,
    p_max_requests: maxRequests,
    p_window_seconds: 60,
  });
  if (error) throw new Error(`Rate limit check failed: ${error.message}`);
  return data ? null : jsonResponse({ error: "Terlalu banyak permintaan. Coba lagi sebentar.", code: "RATE_LIMITED" }, 429);
}

export function requireAcceptedTerms(context: RequestContext): Response | null {
  return context.user.accepted_terms_at
    ? null
    : jsonResponse({ error: "Konfirmasi usia 18+ dan syarat terlebih dahulu.", code: "AGE_CONFIRMATION_REQUIRED" }, 403);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof TelegramAuthError) {
    return jsonResponse({ error: error.message, code: error.code }, error.status);
  }
  console.error("Supabase Edge Function failed", error);
  return jsonResponse({ error: "Terjadi kendala pada server. Coba lagi nanti.", code: "INTERNAL_ERROR" }, 500);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createReferralCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("").toUpperCase();
}

export async function authenticate(request: Request): Promise<RequestContext> {
  const initData = request.headers.get("X-Telegram-Init-Data") ?? "";
  const botToken = Deno.env.get("BOT_TOKEN");
  if (!botToken) throw new Error("BOT_TOKEN is not configured in Supabase secrets.");
  const maxAge = Number(Deno.env.get("TELEGRAM_INIT_DATA_MAX_AGE_SECONDS") ?? "86400");
  const identity = await validateTelegramInitData(initData, botToken, maxAge);

  const ip = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  const salt = Deno.env.get("IP_HASH_SALT");
  if (!salt) throw new Error("IP_HASH_SALT is not configured in Supabase secrets.");
  const ipHash = await sha256(`${salt}:${ip}`);
  const deviceFingerprint = request.headers.get("X-Device-Fingerprint");
  const deviceHash = deviceFingerprint ? await sha256(`${salt}:${deviceFingerprint.slice(0, 256)}`) : null;

  const referralCode = createReferralCode();
  const { data: user, error } = await getAdminClient()
    .rpc("bootstrap_telegram_user", {
      p_telegram_id: identity.telegramId,
      p_username: identity.username,
      p_first_name: identity.firstName,
      p_start_param: identity.startParam,
      p_referral_code: referralCode,
      p_ip_hash: ipHash,
      p_device_hash: deviceHash,
    })
    .single();
  if (error) throw new Error(`Telegram user bootstrap failed: ${error.message}`);
  const profile = user as AuthenticatedUser;
  if (profile.is_banned) {
    throw new TelegramAuthError("Akun ini tidak dapat mengakses AviaX.", "USER_BANNED");
  }
  const { data: withinLimit, error: limitError } = await getAdminClient().rpc("consume_rate_limit", {
    p_bucket_key: `${profile.id}:authenticated-api`,
    p_max_requests: 120,
    p_window_seconds: 60,
  });
  if (limitError) throw new Error(`Authentication rate limit failed: ${limitError.message}`);
  if (!withinLimit) {
    throw new TelegramAuthError("Terlalu banyak permintaan. Coba lagi sebentar.", "RATE_LIMITED", 429);
  }
  return { identity, user: profile, ipHash };
}

export async function withAuthenticatedUser(
  request: Request,
  handler: (context: RequestContext) => Promise<Response>,
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    return await handler(await authenticate(request));
  } catch (error) {
    return errorResponse(error);
  }
}
