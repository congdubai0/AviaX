import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

let adminClient: SupabaseClient | undefined;

export function getAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = getServerKey();
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server configuration is incomplete.");
  }
  adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

function getServerKey(): string | undefined {
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) return legacyKey;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secretKeys) return undefined;

  let parsedKeys: Record<string, unknown>;
  try {
    parsedKeys = JSON.parse(secretKeys) as Record<string, unknown>;
  } catch (error) {
    throw new Error("Supabase secret keys configuration is invalid.", { cause: error });
  }

  const defaultKey = parsedKeys.default;
  if (typeof defaultKey !== "string" || defaultKey.length === 0) {
    throw new Error('Supabase secret keys configuration has no "default" key.');
  }
  return defaultKey;
}

export async function getSetting<T>(key: string): Promise<T> {
  const { data, error } = await getAdminClient()
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`Could not read setting "${key}": ${error.message}`);
  if (!data) throw new Error(`Required setting "${key}" is missing.`);
  return data.value as T;
}
