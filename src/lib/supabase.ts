import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

const launchInitData = (() => {
  const sdkInitData = window.Telegram?.WebApp?.initData;
  if (sdkInitData) return sdkInitData;

  const fragmentInitData = new URLSearchParams(window.location.hash.slice(1)).get("tgWebAppData");
  if (fragmentInitData) return fragmentInitData;

  return new URLSearchParams(window.location.search).get("tgWebAppData") ?? "";
})();

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }

  client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "X-Client-Info": "aviax-mini-app" },
    },
  });
  return client;
}

export function telegramInitData(): string {
  const initData = window.Telegram?.WebApp?.initData || launchInitData;
  if (initData) return initData;

  if (import.meta.env.DEV) {
    return window.Telegram?.WebApp?.mockInitData ?? "";
  }
  return "";
}
