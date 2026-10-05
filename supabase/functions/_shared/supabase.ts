import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

let adminClient: SupabaseClient | undefined;

export function getAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server configuration is incomplete.");
  }
  adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
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
