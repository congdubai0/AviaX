import { configuredValue } from "./missions.ts";

export async function checkChannelMembership(telegramId: string): Promise<{ isMember: boolean; configured: boolean }> {
  const [channelUsername, channelUrl] = await Promise.all([
    configuredValue<string>("channel_username", ""),
    configuredValue<string>("channel_url", "https://t.me/"),
  ]);
  const channelFromUrl = channelUrl.match(/^https:\/\/t\.me\/([A-Za-z0-9_]+)/)?.[1] ?? "";
  const channel = channelUsername || channelFromUrl;
  if (!channel) return { isMember: false, configured: false };

  const botToken = Deno.env.get("BOT_TOKEN");
  if (!botToken) throw new Error("BOT_TOKEN is not configured in Supabase secrets.");
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: channel.startsWith("@") ? channel : `@${channel}`,
        user_id: telegramId,
      }),
    });
  } catch (error) {
    throw new Error(`Telegram membership check request failed: ${error instanceof Error ? error.message : "network error"}`);
  }
  if (!response.ok) throw new Error(`Telegram membership check returned HTTP ${response.status}.`);
  const payload = await response.json() as {
    ok: boolean;
    result?: { status?: string; is_member?: boolean };
    description?: string;
  };
  if (!payload.ok) {
    throw new Error(`Telegram membership check failed: ${payload.description ?? "unknown Telegram API error"}`);
  }
  const status = payload.result?.status;
  const isMember = ["member", "administrator", "creator"].includes(status ?? "")
    || (status === "restricted" && payload.result?.is_member === true);
  return { isMember, configured: true };
}
